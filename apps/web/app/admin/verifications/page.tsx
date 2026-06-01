import { createClient } from "@/lib/supabase/server";
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
  const supabase = await createClient();

  const { data: verifications } = await supabase
    .from("seller_verification")
    .select("*, profiles!user_id(nombre, email, trust_level)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  // Generate signed URLs in parallel for all docs across all verifications
  const verificationsWithUrls = await Promise.all(
    (verifications ?? []).map(async (v) => {
      const [selfieUrl, ineFrontUrl, ineBackUrl] = await Promise.all([
        signOrNull(supabase, v.selfie_url),
        signOrNull(supabase, v.ine_front_url),
        signOrNull(supabase, v.ine_back_url),
      ]);
      return { ...v, selfieUrl, ineFrontUrl, ineBackUrl };
    })
  );

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Verificaciones pendientes</h1>

      {verificationsWithUrls.length > 0 ? (
        <div className="space-y-4">
          {verificationsWithUrls.map((v) => {
            const profile = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
            return (
              <div key={v.id} className="rounded-lg border p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-sm">{profile?.nombre ?? "Usuario"}</p>
                      <span className="text-[10px] bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 rounded-full font-medium">
                        {v.document_type || "INE"}
                      </span>
                      {v.university_name && (
                        <span className="text-[10px] bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300 px-2 py-0.5 rounded-full font-medium">
                          {v.university_name}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">{profile?.email}</p>
                  </div>
                  <span className="text-xs bg-amber-50 text-amber-600 dark:bg-amber-950/50 px-2 py-0.5 rounded-full">
                    Pendiente
                  </span>
                </div>

                {v.ai_analysis_raw && (v.ai_analysis_raw as any).motivo_rechazo_o_duda && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-2 text-xs text-amber-800 dark:text-amber-400">
                    <span className="font-bold">🤖 Gemini dice:</span> {(v.ai_analysis_raw as any).motivo_rechazo_o_duda}
                  </div>
                )}

                <div className="grid grid-cols-3 gap-2">
                  {v.selfieUrl && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">Selfie</p>
                      <a href={v.selfieUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                        Ver imagen →
                      </a>
                    </div>
                  )}
                  {v.ineFrontUrl && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">INE frente</p>
                      <a href={v.ineFrontUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                        Ver imagen →
                      </a>
                    </div>
                  )}
                  {v.ineBackUrl && (
                    <div className="space-y-1">
                      <p className="text-xs text-muted-foreground">INE reverso</p>
                      <a href={v.ineBackUrl} target="_blank" rel="noreferrer" className="text-xs text-primary hover:underline">
                        Ver imagen →
                      </a>
                    </div>
                  )}
                  {v.selfie_url && !v.selfieUrl && (
                    <p className="text-xs text-red-500 col-span-3">
                      Selfie: no se pudo generar URL firmada
                    </p>
                  )}
                  {v.ine_front_url && !v.ineFrontUrl && (
                    <p className="text-xs text-red-500 col-span-3">
                      INE frente: no se pudo generar URL firmada
                    </p>
                  )}
                  {v.ine_back_url && !v.ineBackUrl && (
                    <p className="text-xs text-red-500 col-span-3">
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
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="font-medium">Sin verificaciones pendientes</p>
        </div>
      )}
    </div>
  );
}
