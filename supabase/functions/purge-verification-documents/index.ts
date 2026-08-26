// Supabase Edge Function: purge verification documents
// Deploy with: supabase functions deploy purge-verification-documents
// Scheduled by supabase/migrations/20260825000001_verification_document_purge.sql
// (pg_cron + pg_net, same pattern as 20260531000001_pg_cron_schedules.sql.)
//
// Aviso de Privacidad §15 promises the DOCUMENTS are deleted once the
// verification is resolved. The seller_verification ROW is kept on purpose:
// it is the record that the verification happened. Only the three *_url
// columns and the stored objects go away.
//
// Two passes:
//   1. resolved -- rows with status IN ('approved','rejected') that still
//      carry any *_url. Clears the URLs, then deletes the objects.
//   2. sweep over every prefix in the bucket, which lands in one of three
//      buckets:
//        - still in use  -- the row is pending / NULL status, or still has
//                           URLs. Skipped.
//        - leftover      -- the row is resolved and its URLs are already
//                           NULL, but files remain. Deleted immediately, no
//                           age threshold.
//        - orphan        -- no row at all. Deleted once older than
//                           ORPHAN_MAX_AGE_DAYS.
//
// ORDER IS LOAD-BEARING IN PASS 1. The URL columns are set to NULL BEFORE the
// storage objects are removed. Storage and Postgres cannot share a
// transaction, so one side has to go first, and only this order fails safe:
//
//   NULL-then-remove (what we do): a crash in between leaves objects with no
//     URL pointing at them. The leftover branch of pass 2 reaps them on a
//     later run -- note that it keys off "resolved row whose URLs are already
//     NULL", NOT off "no row exists", because the row very much still exists
//     in this situation. Nothing in the app breaks meanwhile, because nothing
//     reads those objects any more.
//
//   remove-then-NULL (never do this): a crash in between leaves URLs pointing
//     at deleted objects. verification-upload.tsx:62-90 builds `existingDocs`
//     straight from those columns and calls createSignedUrl() without ever
//     looking at `status`, so the seller's verification page would try to
//     render documents that no longer exist.
//
// Idempotent: pass 1 selects on "some url IS NOT NULL", which it just cleared,
// so a second run finds nothing. Pass 2 re-lists prefixes it already emptied
// and finds zero files. Pass 1 always logs the rows it cleared (the URL
// release is itself the §15 event); pass 2 logs only actual deletions. Either
// way a second consecutive run adds no new log rows.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const BUCKET = "verification-documents";
const ORPHAN_MAX_AGE_DAYS = 90;
const LIST_PAGE = 100;
const MAX_ROWS_PER_RUN = 200;
// storage.list() emits this zero-byte marker for an otherwise empty folder.
// It is not a document and must never be counted as one.
const EMPTY_FOLDER_PLACEHOLDER = ".emptyFolderPlaceholder";
const URL_NOT_NULL_FILTER = "ine_front_url.not.is.null,ine_back_url.not.is.null,selfie_url.not.is.null";
// verification_status is an enum of ('pending','approved','rejected') and is
// NULLABLE (20260320000012_verification.sql:5 -- DEFAULT 'pending', no NOT
// NULL). Only these two values count as resolved; 'pending' and NULL do not.
const RESOLVED_STATUSES = [
  "approved",
  "rejected"
];
function isResolved(status) {
  return status !== null && RESOLVED_STATUSES.includes(status);
}
function hasUrls(row) {
  return row.ine_front_url !== null || row.ine_back_url !== null || row.selfie_url !== null;
}
function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json"
    }
  });
}
/**
 * List every entry directly under `prefix`, paging past the 100-row default.
 * Passing "" lists the top level, where each user_id folder comes back as an
 * entry with id === null.
 */ async function listAll(supabase, prefix) {
  const out = [];
  for(let offset = 0;; offset += LIST_PAGE){
    const { data, error } = await supabase.storage.from(BUCKET).list(prefix, {
      limit: LIST_PAGE,
      offset
    });
    if (error) throw new Error('list("' + prefix + '"): ' + error.message);
    if (!data || data.length === 0) break;
    out.push(...data);
    if (data.length < LIST_PAGE) break;
  }
  return out;
}
/** Real documents under a user prefix -- folders and placeholders excluded. */ function documentsOf(entries) {
  return entries.filter((e)=>e.id !== null && e.name !== EMPTY_FOLDER_PLACEHOLDER);
}
/**
 * Same shape as delete-account/index.ts:83-91: list the user's folder, then
 * remove every path it returned. Returns the paths actually handed to
 * .remove() so the log records what was targeted even if the call errored.
 */ async function removePrefix(supabase, prefix) {
  let entries;
  try {
    entries = await listAll(supabase, prefix);
  } catch (err) {
    return {
      paths: [],
      error: err.message
    };
  }
  // The placeholder is removed alongside the documents so the folder itself
  // disappears and pass 2 stops re-examining it every hour.
  const paths = entries.filter((e)=>e.id !== null).map((e)=>prefix + "/" + e.name);
  if (paths.length === 0) return {
    paths: [],
    error: null
  };
  const { error } = await supabase.storage.from(BUCKET).remove(paths);
  return {
    paths,
    error: error ? error.message : null
  };
}
function documentPaths(paths) {
  return paths.filter((p)=>!p.endsWith(EMPTY_FOLDER_PLACEHOLDER));
}
Deno.serve(async (req)=>{
  // Defense in depth (mirrors expire-confirmations/index.ts:12-27): pg_cron
  // drives this from inside the same project, but reject anything without the
  // shared CRON_SECRET bearer so the endpoint is not publicly invocable.
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) {
    return jsonResponse({
      ok: false,
      error: "CRON_SECRET not configured"
    }, 500);
  }
  const auth = req.headers.get("authorization") ?? "";
  if (auth !== "Bearer " + expected) {
    return jsonResponse({
      ok: false,
      error: "unauthorized"
    }, 401);
  }
  const supabase = createClient(Deno.env.get("SUPABASE_URL"), Deno.env.get("SB_SECRET_KEY"));
  // dry_run lets an operator see exactly what an unattended run would delete
  // without deleting it. The body is optional so pg_cron's '{}' works as-is.
  let dryRun = false;
  try {
    const body = await req.json();
    dryRun = body?.dry_run === true;
  } catch  {
    dryRun = false;
  }
  const logRows = [];
  const startedAt = new Date().toISOString();
  let orphansSkippedTooNew = 0;
  try {
    // ===================================================================
    // Pass 1 -- resolved verifications that still hold documents.
    // ===================================================================
    // status is nullable: 20260320000012_verification.sql:5 declares it
    // DEFAULT 'pending' with no NOT NULL. A NULL status is not provably
    // resolved, so it is treated like 'pending' and left alone -- destroying
    // a seller's documents while their review might still be open is the one
    // mistake here that cannot be undone. Those rows are counted and returned
    // instead, because they are a data-quality problem worth seeing.
    const { data: resolved, error: resolvedErr } = await supabase.from("seller_verification").select("id, user_id, status, ine_front_url, ine_back_url, selfie_url").in("status", RESOLVED_STATUSES).or(URL_NOT_NULL_FILTER)// Cap the batch so a large backlog cannot run the function past the
    // Edge Function wall clock. The job is hourly and idempotent, so a
    // backlog drains over successive runs instead of timing out mid-sweep.
    .limit(MAX_ROWS_PER_RUN);
    if (resolvedErr) throw new Error("select resolved: " + resolvedErr.message);
    const { count: nullStatusWithDocs } = await supabase.from("seller_verification").select("user_id", {
      count: "exact",
      head: true
    }).is("status", null).or(URL_NOT_NULL_FILTER);
    // seller_verification.user_id is NOT unique -- 20260320000012 gives it a
    // plain index (idx_seller_verification_user), no UNIQUE constraint -- so
    // one user can own several rows. A seller who was rejected and then
    // re-submitted has an old 'rejected' row AND a live 'pending' row, and
    // both point into the SAME {user_id}/ prefix (more so now that the upload
    // path is deterministic and a re-submission overwrites the same objects).
    //
    // Two consequences, both load-bearing:
    //   - the URL clearing targets the row by `id`, never by user_id, or
    //     purging the old row would blank the live one's columns too;
    //   - the prefix is only deleted once NO row of that user still needs it.
    // Getting this wrong destroys the documents of a verification that is
    // still under review.
    // Cast once. Without generated DB types, supabase-js infers a loose shape
    // for `.select()`, and every downstream use would otherwise re-cast.
    const resolvedRows = resolved ?? [];
    const affectedUsers = [
      ...new Set(resolvedRows.map((r)=>r.user_id))
    ];
    const siblingsByUser = new Map();
    if (affectedUsers.length > 0) {
      const { data: siblings, error: sibErr } = await supabase.from("seller_verification").select("id, user_id, status, ine_front_url, ine_back_url, selfie_url").in("user_id", affectedUsers);
      if (sibErr) throw new Error("select siblings: " + sibErr.message);
      for (const s of siblings ?? []){
        const list = siblingsByUser.get(s.user_id) ?? [];
        list.push(s);
        siblingsByUser.set(s.user_id, list);
      }
    }
    // Step 1: clear the URLs, row by row. See the ORDER IS LOAD-BEARING note.
    const clearedIds = new Set();
    for (const row of resolvedRows){
      if (dryRun) {
        clearedIds.add(row.id);
        continue;
      }
      const { error: updateErr } = await supabase.from("seller_verification").update({
        ine_front_url: null,
        ine_back_url: null,
        selfie_url: null
      }).eq("id", row.id);
      if (updateErr) {
        // Nothing nulled and nothing deleted -- this row is untouched and the
        // next run retries it. Recorded so one bad row cannot silently stall
        // the sweep. Deliberately NOT added to clearedIds, so it also blocks
        // its own prefix from being emptied below.
        logRows.push({
          phase: "resolved",
          user_id: row.user_id,
          storage_prefix: row.user_id,
          deleted_paths: [],
          deleted_count: 0,
          verification_status: row.status,
          error: "url nulling failed, storage left intact: " + updateErr.message
        });
        continue;
      }
      clearedIds.add(row.id);
    }
    // Step 2: now the objects -- once per user, and only for users where no
    // remaining row still needs the prefix.
    for (const userId of affectedUsers){
      const siblings = siblingsByUser.get(userId) ?? [];
      // A sibling blocks the delete if it was not cleared on this run AND it
      // still needs its documents: either it is unresolved (pending / NULL
      // status), or it is resolved but still carries URLs that a later batch
      // will handle.
      const blocker = siblings.find((s)=>!clearedIds.has(s.id) && (hasUrls(s) || !isResolved(s.status)));
      const batchRow = resolvedRows.find((r)=>r.user_id === userId);
      const status = batchRow ? batchRow.status : null;
      if (blocker) {
        // The URLs of the resolved row are already cleared, which is what §15
        // actually promises. The bytes stay until the sibling resolves too,
        // because they are the sibling's live documents.
        logRows.push({
          phase: "resolved",
          user_id: userId,
          storage_prefix: userId,
          deleted_paths: [],
          deleted_count: 0,
          verification_status: status,
          error: "urls cleared; files kept, prefix still in use by row " + blocker.id + " (status=" + String(blocker.status) + ")"
        });
        continue;
      }
      // A row whose clearing failed is covered by `blocker` above: it is not
      // in clearedIds, and `siblings` is the pre-clear snapshot so it still
      // reads as having URLs. Reaching here means the prefix is genuinely
      // unreferenced.
      if (dryRun) {
        const docs = documentsOf(await listAll(supabase, userId).catch(()=>[]));
        logRows.push({
          phase: "resolved",
          user_id: userId,
          storage_prefix: userId,
          deleted_paths: docs.map((e)=>userId + "/" + e.name),
          deleted_count: docs.length,
          verification_status: status,
          error: null
        });
        continue;
      }
      const { paths, error: removeErr } = await removePrefix(supabase, userId);
      const docs = documentPaths(paths);
      // Always logged, even when zero files were found. The rows were selected
      // precisely because they still carried URLs, and those URLs are now
      // cleared -- that release IS the §15 event worth proving, whether or not
      // any bytes were still in the bucket. No duplication risk: the next run
      // no longer selects these rows.
      logRows.push({
        phase: "resolved",
        user_id: userId,
        storage_prefix: userId,
        deleted_paths: docs,
        deleted_count: removeErr ? 0 : docs.length,
        verification_status: status,
        error: removeErr ? "urls cleared but storage remove failed, leftover pass will reap: " + removeErr : null
      });
    }
    // ===================================================================
    // Pass 2 -- orphan prefixes with no seller_verification row at all.
    // ===================================================================
    // Without this, a prefix whose account is gone from auth.users is not
    // reachable from any row and stays forever (an April-2026 prefix did
    // exactly that).
    const rootEntries = await listAll(supabase, "");
    const prefixes = rootEntries.filter((e)=>e.id === null && e.name !== EMPTY_FOLDER_PLACEHOLDER).map((e)=>e.name);
    // Every seller_verification row, keyed by user_id. Pass 2 needs more than
    // "does a row exist": it has to tell a prefix that is legitimately holding
    // documents (pending review) from one that should already be empty.
    //
    // Aggregated per user, NOT one entry per row: user_id is not unique (see
    // the note in pass 1), and a single overwriting map would let the last row
    // read decide the fate of a prefix that an earlier row still needs. A
    // prefix is in use if ANY of the user's rows still needs it.
    const rowByUserId = new Map();
    for(let from = 0;; from += 1000){
      const { data: idRows, error: idErr } = await supabase.from("seller_verification").select("id, user_id, status, ine_front_url, ine_back_url, selfie_url").range(from, from + 999);
      if (idErr) throw new Error("select user_ids: " + idErr.message);
      if (!idRows || idRows.length === 0) break;
      for (const r of idRows ?? []){
        const agg = rowByUserId.get(r.user_id) ?? {
          statuses: [],
          anyUrls: false,
          anyUnresolved: false
        };
        agg.statuses.push(String(r.status));
        agg.anyUrls = agg.anyUrls || hasUrls(r);
        agg.anyUnresolved = agg.anyUnresolved || !isResolved(r.status);
        rowByUserId.set(r.user_id, agg);
      }
      if (idRows.length < 1000) break;
    }
    const cutoff = Date.now() - ORPHAN_MAX_AGE_DAYS * 24 * 60 * 60 * 1000;
    for (const prefix of prefixes){
      const row = rowByUserId.get(prefix);
      // Still legitimately holding documents: some row is pending, or has a
      // NULL status we refuse to treat as resolved, or is resolved but still
      // carries URLs that pass 1 will handle on this run or a later one.
      if (row && (row.anyUrls || row.anyUnresolved)) continue;
      const docs = documentsOf(await listAll(supabase, prefix));
      if (docs.length === 0) continue;
      // LEFTOVER: the row is resolved and its URLs are already NULL, so
      // nothing points at these files. This is the safety net for the
      // "URLs first, objects second" ordering in pass 1 -- if a previous run
      // died between the two steps, or the storage remove failed, this is
      // where those files finally get collected. No age threshold: §15 says
      // the documents go when the verification resolves, and this row is
      // already resolved, so waiting 90 days would over-retain them.
      //
      // ORPHAN: no row at all. Only these get the age threshold, because
      // without a row there is no resolution date to key off.
      const phase = row ? "leftover" : "orphan";
      if (phase === "orphan") {
        // Age the prefix by its NEWEST object. Using the oldest would delete
        // a folder that received a file yesterday just because one file in it
        // is old.
        const newest = docs.reduce((max, e)=>{
          const t = e.created_at ? Date.parse(e.created_at) : NaN;
          return Number.isFinite(t) && t > max ? t : max;
        }, 0);
        // No usable created_at -> cannot prove it is old enough -> keep it.
        if (newest === 0 || newest > cutoff) {
          orphansSkippedTooNew++;
          continue;
        }
      }
      if (dryRun) {
        logRows.push({
          phase,
          user_id: row ? prefix : null,
          storage_prefix: prefix,
          deleted_paths: docs.map((e)=>prefix + "/" + e.name),
          deleted_count: docs.length,
          verification_status: row ? row.statuses.join(",") : null,
          error: null
        });
        continue;
      }
      const { paths, error: removeErr } = await removePrefix(supabase, prefix);
      const removed = documentPaths(paths);
      logRows.push({
        phase,
        user_id: row ? prefix : null,
        storage_prefix: prefix,
        deleted_paths: removed,
        deleted_count: removeErr ? 0 : removed.length,
        verification_status: row ? row.statuses.join(",") : null,
        error: removeErr
      });
    }
    // ===================================================================
    // Compliance log. This table is the only durable evidence that the
    // Aviso §15 deletion actually happened, so it is written even when a
    // pass errored -- but never on a dry run, which deletes nothing.
    // ===================================================================
    let logged = 0;
    if (!dryRun && logRows.length > 0) {
      const { error: logErr } = await supabase.from("verification_document_purge_log").insert(logRows.map((r)=>({
          ...r,
          run_at: startedAt
        })));
      if (logErr) {
        // Loud: the documents are gone and the proof that they were deleted
        // is not. Surfaces as a non-200 in net._http_response.
        console.error("purge log insert FAILED", logErr.message, logRows);
        return jsonResponse({
          ok: false,
          error: "purge ran but log insert failed: " + logErr.message,
          purged: logRows
        }, 500);
      }
      logged = logRows.length;
    }
    return jsonResponse({
      ok: true,
      dry_run: dryRun,
      started_at: startedAt,
      resolved_rows_purged: logRows.filter((r)=>r.phase === "resolved").length,
      leftover_prefixes_purged: logRows.filter((r)=>r.phase === "leftover").length,
      orphan_prefixes_purged: logRows.filter((r)=>r.phase === "orphan").length,
      files_deleted: logRows.reduce((n, r)=>n + r.deleted_count, 0),
      orphans_skipped_too_new: orphansSkippedTooNew,
      // Non-zero means a backlog remains and the next hourly run continues.
      resolved_batch_capped: resolvedRows.length === MAX_ROWS_PER_RUN,
      null_status_rows_with_docs: nullStatusWithDocs ?? 0,
      log_rows_written: logged,
      errors: logRows.filter((r)=>r.error !== null).map((r)=>({
          prefix: r.storage_prefix,
          error: r.error
        }))
    }, 200);
  } catch (err) {
    console.error("purge-verification-documents fatal:", err);
    return jsonResponse({
      ok: false,
      error: err.message,
      partial: logRows
    }, 500);
  }
});