// apps/web/scripts/qa-delete-account.mjs
// QA end-to-end for delete-account flow.
//
// Usage:
//   QA_DELETE_ACCOUNT_UUID=<staging-protected-uuid> \
//   NEXT_PUBLIC_SUPABASE_URL=... \
//   SUPABASE_SERVICE_ROLE_KEY=... \
//   node apps/web/scripts/qa-delete-account.mjs
//
// QA_DELETE_ACCOUNT_UUID = the protected staging account UUID that this
// script must NEVER touch. Read from env so the staging UUID is not
// hardcoded in source. The script CREATES its own throw-away test user
// on each run; this env var is the sentinel that guards against
// accidental deletion of the real staging account if any logic regression
// or bug ever produced a colliding uid.

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY env vars");
  process.exit(1);
}

const PROTECTED_EMAIL = "reviewconsolevicino@gmail.com";

// Sentinel UUID — read from env, validated as UUID v4-shaped string.
const PROTECTED_UUID = process.env.QA_DELETE_ACCOUNT_UUID;
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

if (!PROTECTED_UUID || !UUID_REGEX.test(PROTECTED_UUID)) {
  console.error(
    "Missing or invalid QA_DELETE_ACCOUNT_UUID env var (must be a valid UUID — " +
      "the protected staging account that this script will never delete)."
  );
  process.exit(1);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  const email = `qa-delete-${Date.now()}@example.com`;

  // Hard guards: never touch the protected account
  if (email === PROTECTED_EMAIL) throw new Error("protected email collision");

  // Track uids created during this run so we can clean them up in finally{}
  // even if the test fails partway through.
  let createdUid = null;
  let recreatedUid = null;

  try {
    // 1) Create test user
    const { data: created, error: e1 } = await supabase.auth.admin.createUser({
      email,
      password: "QaTest123!",
      email_confirm: true,
    });
    if (e1) throw new Error(`createUser failed: ${e1.message}`);

    createdUid = created.user.id;
    console.log(`Created QA user: ${createdUid} (${email})`);

    // Hard guard 2: verify we are NOT about to operate on the protected UUID
    if (createdUid === PROTECTED_UUID) {
      throw new Error(`FATAL: created uid matches PROTECTED_UUID — aborting before any deletion`);
    }

    // 2) Confirm profile auto-created (handle_new_user trigger)
    const { data: profile } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", createdUid)
      .maybeSingle();
    if (!profile) {
      console.warn("⚠️  Profile not auto-created by trigger (handle_new_user)");
    } else {
      console.log("✅ Profile auto-created by signup trigger");
    }

    // 3) Run delete_user_data RPC
    const { data: rpcResult, error: e2 } = await supabase.rpc("delete_user_data", {
      target_user_id: createdUid,
    });
    if (e2) throw new Error(`delete_user_data RPC failed: ${e2.message}`);
    console.log("RPC result:", JSON.stringify(rpcResult, null, 2));

    // 4) Verify profile is gone
    const { data: profileAfter } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", createdUid)
      .maybeSingle();
    if (profileAfter) throw new Error("Profile NOT deleted after delete_user_data");
    console.log("✅ Profile deleted");

    // 5) Verify audit log entry exists
    const { data: log, error: eLog } = await supabase
      .from("account_deletion_log")
      .select("*")
      .eq("deleted_user_id", createdUid);
    if (eLog) throw new Error(`audit log query failed: ${eLog.message}`);
    if (!log || log.length === 0) throw new Error("Audit log entry NOT created");
    console.log(`✅ Audit log entry created (${log.length} row, summary keys: ${Object.keys(log[0].summary || {}).length})`);

    // 6) Delete from auth.users
    const { error: e3 } = await supabase.auth.admin.deleteUser(createdUid);
    if (e3) throw new Error(`auth.admin.deleteUser failed: ${e3.message}`);
    console.log("✅ Auth user deleted");

    // createdUid is now fully cleaned by the script; mark it so finally{}
    // skips re-cleanup (idempotent but avoids redundant API calls).
    createdUid = null;

    // 7) Verify email is reusable (no leftover constraint)
    const { data: recreated, error: e4 } = await supabase.auth.admin.createUser({
      email,
      password: "QaTest123!",
      email_confirm: true,
    });
    if (e4) throw new Error(`Email NOT reusable: ${e4.message}`);
    recreatedUid = recreated.user.id;
    console.log(`✅ Email reusable, recreated as ${recreatedUid}`);

    if (recreatedUid === PROTECTED_UUID) {
      throw new Error("FATAL: recreated uid matches PROTECTED_UUID — aborting cleanup");
    }

    // 8) Cleanup the recreated user — also exercises the RPC + auth delete a second time
    const { error: eCleanup1 } = await supabase.rpc("delete_user_data", {
      target_user_id: recreatedUid,
    });
    if (eCleanup1) console.warn(`cleanup RPC warn: ${eCleanup1.message}`);
    const { error: eCleanup2 } = await supabase.auth.admin.deleteUser(recreatedUid);
    if (eCleanup2) console.warn(`cleanup auth.delete warn: ${eCleanup2.message}`);
    recreatedUid = null;
    console.log("✅ Cleanup complete");

    // 9) Final sanity: verify the protected account still exists
    const { data: protectedCheck, error: ePc } = await supabase
      .from("profiles")
      .select("id")
      .eq("id", PROTECTED_UUID)
      .maybeSingle();
    if (ePc) throw new Error(`protected check failed: ${ePc.message}`);
    if (!protectedCheck) {
      throw new Error(`FATAL: protected account ${PROTECTED_UUID} NOT found — investigate immediately`);
    }
    console.log(`✅ Protected account ${PROTECTED_UUID} still intact`);
  } finally {
    // Best-effort cleanup of any test users left behind by an early failure.
    // Idempotent — if the user is already gone, the calls silently fail.
    // SAFETY: never touch PROTECTED_UUID under any circumstance.
    for (const uid of [createdUid, recreatedUid]) {
      if (!uid) continue;
      if (uid === PROTECTED_UUID) {
        console.error(`SAFETY ABORT: refused to clean up uid matching PROTECTED_UUID (${uid})`);
        continue;
      }
      await supabase.rpc("delete_user_data", { target_user_id: uid }).catch(() => {});
      await supabase.auth.admin.deleteUser(uid).catch(() => {});
    }
  }
}

main()
  .then(() => {
    console.log("\nQA PASSED");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\nQA FAILED:", err.message || err);
    process.exit(1);
  });
