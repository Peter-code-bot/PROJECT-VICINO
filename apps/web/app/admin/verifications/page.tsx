import { createAdminClient } from "@/lib/supabase/admin";
import * as Sentry from "@sentry/nextjs";
import { VerificationActions } from "./verification-actions";
import {
  VisorDeImagenes,
  type DocumentoDeVerificacion,
} from "@/components/admin/visor-de-imagenes";
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

/**
 * ai_analysis_raw es `Json` en los tipos generados: puede ser objeto, array,
 * cadena, numero o nulo, porque asi lo guarda la columna. Leerlo con
 * `as any` afirmaba que era un objeto con ese campo exacto, y si algun dia
 * el analisis devuelve otra forma eso revienta en el render, del lado del
 * servidor, en una pagina de admin.
 */
function motivoDeRechazo(bruto: unknown): string | null {
  if (typeof bruto !== "object" || bruto === null || Array.isArray(bruto)) return null;
  const motivo = (bruto as Record<string, unknown>).motivo_rechazo_o_duda;
  return typeof motivo === "string" && motivo.trim() !== "" ? motivo : null;
}

export default async function VerificationsPage() {
  // Ya no se construye el cliente de usuario: no queda ninguna lectura que lo
  // use. Las tres firmas de URL siempre fueron con adminSupabase, y la consulta
  // de la cola acaba de mudarse ahi porque con el rol `authenticated` moria con
  // 42501 al pedir profiles.email.
  //
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

  // Esta lectura va por adminSupabase y NO por el cliente de usuario, y es un
  // arreglo, no una comodidad.
  //
  // El embed pide profiles.email, y `authenticated` no tiene GRANT SELECT sobre
  // esa columna — profiles da privilegios columna por columna y email esta en
  // el conjunto sensible junto a telefono, rfc y las coordenadas. Por esa regla
  // la consulta no devolvia el email en nulo: moria ENTERA con 42501.
  // Comprobado en produccion con el rol real: la misma consulta sin `email`
  // devuelve filas, y con `email` da «permission denied for table profiles».
  //
  // Y el fallo era MUDO por partida doble: no se desestructuraba `error`, asi
  // que no habia log ni Sentry, y la pagina caia en su estado vacio — un check
  // verde y «Sin verificaciones pendientes». O sea que la cola de documentos de
  // identidad se veia limpia justo cuando no podia leerse ninguna. Hoy hay 0
  // pendientes, asi que no se ha perdido ninguna revision todavia; el dano
  // empezaba con la primera que entrara.
  //
  // service_role si puede leer email, y el acceso ya esta acotado por el guard
  // de admin del layout, que lee user_roles.
  const { data: verifications, error: verificationsError } = await adminSupabase
    .from("seller_verification")
    .select("*, profiles!user_id(nombre, email, trust_level)")
    .eq("status", "pending")
    .order("created_at", { ascending: true });

  if (verificationsError) {
    Sentry.captureException(verificationsError, {
      tags: { action: "admin_listar_verificaciones" },
      contexts: {
        supabase: { code: verificationsError.code, details: verificationsError.details },
      },
    });
  }

  // Generate signed URLs in parallel for all docs across all verifications
  const verificationsWithUrls = await Promise.all(
    (verifications ?? []).map(async (v) => {
      const [selfieUrl, ineFrontUrl, ineBackUrl] = await Promise.all([
        signOrNull(adminSupabase, v.selfie_url),
        signOrNull(adminSupabase, v.ine_front_url),
        signOrNull(adminSupabase, v.ine_back_url),
      ]);
      return { ...v, selfieUrl, ineFrontUrl, ineBackUrl };
    })
  );

  return (
    <div className="space-y-4 flex flex-col flex-1 h-full">
      <h1 className="text-xl font-bold">Verificaciones pendientes</h1>

      {verificationsWithUrls.length > 0 ? (
        <div className="space-y-4">
          {verificationsWithUrls.map((v) => {
            const profile = Array.isArray(v.profiles) ? v.profiles[0] : v.profiles;
            // Las etiquetas no dicen "INE": document_type tambien puede ser
            // "Credencial Universitaria", y en ese caso nombrar la INE describe
            // un documento que no es el que se esta mirando. El tipo real ya
            // sale en la insignia de arriba.
            const documentos: readonly DocumentoDeVerificacion[] = [
              { etiqueta: "Selfie", url: v.selfieUrl },
              { etiqueta: "Frente", url: v.ineFrontUrl },
              { etiqueta: "Reverso", url: v.ineBackUrl },
            ].filter((doc): doc is DocumentoDeVerificacion => doc.url !== null);
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
                    <p className="text-xs text-muted-foreground truncate">{profile?.email}</p>
                  </div>
                  <span className="text-xs bg-amber-50 text-amber-600 dark:bg-amber-950/50 px-2 py-0.5 rounded-full shrink-0">
                    Pendiente
                  </span>
                </div>

                {motivoDeRechazo(v.ai_analysis_raw) && (
                  <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-2 text-xs text-amber-800 dark:text-amber-400">
                    <span className="font-bold">🤖 La IA dice:</span> {motivoDeRechazo(v.ai_analysis_raw)}
                  </div>
                )}

                {/* Las miniaturas y el visor son cliente, pero la firma sigue
                    siendo del servidor: aqui solo baja la URL ya firmada, que
                    es exactamente lo que antes viajaba en el href del enlace.
                    El bucket es privado y el navegador del revisor es el unico
                    que tiene por que pedir el documento. */}
                <div className="space-y-2">
                  <VisorDeImagenes documentos={documentos} />
                  {/* Una firma que no se pudo generar se nombra aparte y no
                      entra al visor: no es un fallo de carga que un reintento
                      arregle, es la ruta guardada o el permiso del bucket, y el
                      revisor tiene que ver que ese documento falta. */}
                  {v.selfie_url && !v.selfieUrl && (
                    <p className="text-xs text-red-500 break-words">
                      Selfie: no se pudo generar URL firmada
                    </p>
                  )}
                  {v.ine_front_url && !v.ineFrontUrl && (
                    <p className="text-xs text-red-500 break-words">
                      Frente: no se pudo generar URL firmada
                    </p>
                  )}
                  {v.ine_back_url && !v.ineBackUrl && (
                    <p className="text-xs text-red-500 break-words">
                      Reverso: no se pudo generar URL firmada
                    </p>
                  )}
                  {documentos.length === 0 &&
                    !v.selfie_url &&
                    !v.ine_front_url &&
                    !v.ine_back_url && (
                      <p className="text-xs text-muted-foreground">
                        Esta solicitud no trae documentos.
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
