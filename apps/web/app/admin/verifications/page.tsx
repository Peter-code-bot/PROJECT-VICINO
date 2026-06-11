import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminOrModerator } from "@/lib/auth/require-admin-or-moderator";
import { VerificationActions } from "./verification-actions";
import type { SupabaseClient } from "@supabase/supabase-js";

export const metadata = { title: "Admin — Verificaciones" };

const VERIFICATION_BUCKET = "verification-documents";
const SIGNED_URL_TTL_SECONDS = 60 * 30; // 30 min — long enough to review, short enough to limit exposure

/**
 * Defensive: stored value may be a path ("<userId>/selfie-<ts>.png") for new
 * uploads, or a legacy public URL constructed before the signed-URL migration.
 * Strip any "/storage/v1/object/.../verification-documents/" prefix to get
 * the bucket-relative path.
 */
function extractStoragePath(stored: string): string {
  const marker = "/object/public/verification-documents/";
  const signedMarker = "/object/sign/verification-documents/";
  for (const m of [marker, signedMarker]) {
    const idx = stored.indexOf(m);
    if (idx >= 0) {
      const tail = stored.slice(idx + m.length);
      // Strip query string from signed URLs
      const q = tail.indexOf("?");
      return q >= 0 ? tail.slice(0, q) : tail;
    }
  }
  return stored;
}

async function signOrNull(
  supabase: SupabaseClient,
  stored: string | null | undefined
): Promise<string | null> {
  if (!stored) return null;
  const path = extractStoragePath(stored);
  const { data, error } = await supabase.storage
    .from(VERIFICATION_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);
  if (error || !data) return null;
  return data.signedUrl;
}

export default async function VerificationsPage() {
  // Fail-fast: this page reads PII (submitter email) via the service-role client,
  // which bypasses RLS. Assert admin/moderator here so a layout-gate regression
  // cannot leak emails (#2 defense-in-depth).
  const ctx = await requireAdminOrModerator();
  if (!ctx) redirect("/login");

  const supabase = await createClient();
  // SECURITY: adminSupabase (service-role) is LOAD-BEARING for the signed-URL
  // generation below. The `verification-documents` storage bucket has NO RLS
  // policy that grants admins access via a user-context client -- the orphan
  // migration that would have added one was removed 2026-06-03 as confirmed
  // dead code (admin path uses service-role; see openspec/specs/rls-performance/
  // spec.md follow-ups). If this code is ever refactored to use `supabase`
  // (user-context) for the signOrNull calls, you MUST re-introduce the
  // `Admin read verification docs` policy on storage.objects first, otherwise
  // signed-URL generation will silently fail (returns { error } -> null URLs
  // in the UI).
  const adminSupabase = createAdminClient();

  // profiles.email is revoked from the user client (#2): the user-context embed
  // keeps only public columns; the submitter emails are fetched via the existing
  // service-role client (this page is admin-only and already uses adminSupabase).
  const { data: verifications } = await supabase
    .from("seller_verification")
    .select("*, profiles!user_id(nombre, trust_level)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  const submitterIds = [...new Set((verifications ?? []).map((v) => v.user_id))];
  const emailById = new Map<string, string>();
  if (submitterIds.length > 0) {
    const { data: emailRows } = await adminSupabase
      .from("profiles")
      .select("id, email")
      .in("id", submitterIds);
    for (const r of emailRows ?? []) emailById.set(r.id, r.email);
  }

  // Generate signed URLs in parallel for all docs across all verifications
  const verificationsWithUrls = await Promise.all(
    (verifications ?? []).map(async (v) => {
      const [selfieUrl, ineFrontUrl, ineBackUrl] = await Promise.all([
        signOrNull(adminSupabase, v.selfie_url),
        signOrNull(adminSupabase, v.ine_front_url),
        signOrNull(adminSupabase, v.ine_back_url),
      ]);
      return { ...v, selfieUrl, ineFrontUrl, ineBackUrl, submitterEmail: emailById.get(v.user_id) ?? null };
    })
  );

  return (
    <div className="space-y-4 flex flex-col flex-1 h-full">
      <h1 className="text-xl font-bold">Verificaciones pendientes</h1>

      {verificationsWithUrls.length > 0 ? (
        <div className="space-y-4">
          {verificationsWithUrls.map((v) => {
            const profile = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
            return (
              <div key={v.id} className="rounded-lg border p-4 space-y-3 w-full">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-sm truncate">{profile?.nombre ?? "Usuario"}</p>
                      <span className="text-[10px] bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 rounded-full font-medium shrink-0">
                        {v.document_type || "INE"}
                      </span>
                      {v.university_name && (
                        <span className="text-[10px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium shrink-0">
                          {v.university_name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{v.submitterEmail}</p>
                  </div>
                  <span className="text-xs bg-amber-50 text-amber-600 dark:bg-amber-950/50 px-2 py-0.5 rounded-full shrink-0">
                    Pendiente
                  </span>
                </div>

                {v.ai_analysis_raw && (v.ai_analysis_raw as any).motivo_rechazo_o_duda && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-2 text-xs text-amber-800 dark:text-amber-400">
                    <span className="font-bold">🤖 Gemini dice:</span> {(v.ai_analysis_raw as any).motivo_rechazo_o_duda}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  {v.selfieUrl && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Selfie</p>
                      <a href={v.selfieUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">
                        Ver imagen →
                      </a>
                    </div>
                  )}
                  {v.ineFrontUrl && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">INE frente</p>
                      <a href={v.ineFrontUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">
                        Ver imagen →
                      </a>
                    </div>
                  )}
                  {v.ineBackUrl && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">INE reverso</p>
                      <a href={v.ineBackUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline break-all">
                        Ver imagen →
                      </a>
                    </div>
                  )}
                  {v.selfie_url && !v.selfieUrl && (
                    <p className="text-xs text-red-500 sm:col-span-3 break-words">
                      Selfie: no se pudo generar URL firmada
                    </p>
                  )}
                  {v.ine_front_url && !v.ineFrontUrl && (
                    <p className="text-xs text-red-500 sm:col-span-3 break-words">
                      INE frente: no se pudo generar URL firmada
                    </p>
                  )}
                  {v.ine_back_url && !v.ineBackUrl && (
                    <p className="text-xs text-red-500 sm:col-span-3 break-words">
                      INE reverso: no se pudo generar URL firmada
                    </p>
                  )}
                </div>

                <VerificationActions id={v.id} userId={v.user_id} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="font-medium">Sin verificaciones pendientes</p>
        </div>
      )}
    </div>
  );
}
