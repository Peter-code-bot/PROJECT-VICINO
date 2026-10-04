import { publicProfileName } from "@vicino/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdminPage } from "@/lib/auth/require-admin-page";
import * as Sentry from "@sentry/nextjs";
import { VerificationActions } from "./verification-actions";
import {
  VisorDeImagenes,
  type DocumentoDeVerificacion,
} from "@/components/admin/visor-de-imagenes";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/types/database.types";
import {
  anterioresDeLaNota,
  esRechazo,
  estadoDelAnalisis,
  fusionarHistoriales,
  historialConNotaPrevia,
  resumenDeLaNota,
  versionesDeLasFotos,
  type EstadoDelAnalisis,
} from "@/lib/verificacion/vigencia-analisis";

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

/**
 * Un solo nombre de archivo directamente bajo la carpeta del vendedor: nada de
 * "/", "%", "\\" ni "..". Las tres columnas de ruta las escribe el propio
 * vendedor mientras su solicitud esta pendiente, y service_role se salta la RLS
 * del bucket: sin esta lista blanca, una solicitud podia apuntar a la INE y la
 * selfie de OTRA persona y el panel las firmaba y ensenaba (PT09, 27-sep).
 */
const NOMBRE_DE_DOCUMENTO = /^[A-Za-z0-9_-][A-Za-z0-9._-]*$/;

function esRutaDelVendedor(path: string, userId: string): boolean {
  const prefijo = `${userId}/`;
  if (!path.startsWith(prefijo)) return false;
  const nombre = path.slice(prefijo.length);
  return NOMBRE_DE_DOCUMENTO.test(nombre) && !nombre.includes("..");
}

async function signOrNull(
  supabase: SupabaseClient,
  stored: string | null | undefined,
  userId: string,
): Promise<string | null> {
  if (!stored) return null;
  const path = extractStoragePath(stored);
  if (!esRutaDelVendedor(path, userId)) {
    Sentry.captureMessage("admin verificaciones: ruta fuera de la carpeta del vendedor", {
      level: "warning",
      tags: { action: "admin_firmar_documento" },
    });
    return null;
  }
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

/**
 * updated_at actual de cada foto guardada en la fila, o null si no se pudo
 * listar la carpeta. Es la mitad de la comparacion que decide si la nota de la
 * IA es sobre estas fotos (ver lib/verificacion/vigencia-analisis.ts).
 */
async function versionesActuales(
  supabase: SupabaseClient,
  userId: string,
  guardadas: readonly (string | null)[],
): Promise<(string | null)[] | null> {
  // Las ranuras vacias se quedan como null: una foto ausente nunca cuenta como
  // «la IA la vio».
  const rutas = guardadas.map((r) => (r ? extractStoragePath(r) : null));
  const { data, error } = await supabase.storage
    .from(VERIFICATION_BUCKET)
    .list(userId, { limit: 1000 });
  if (error) {
    Sentry.captureException(error, { tags: { action: "admin_listar_fotos_verificacion" } });
    return null;
  }
  return versionesDeLasFotos(userId, rutas, data ?? []);
}

/** Lo que el revisor lee encima de la nota de la IA. */
const ETIQUETA_NOTA: Record<Exclude<EstadoDelAnalisis, "ninguno">, string> = {
  vigente: "La IA dice:",
  desfasado: "La IA dijo, sobre un envío anterior:",
  sin_comprobar: "La IA dijo (no se pudo comprobar si fue sobre estas fotos):",
};

export default async function VerificationsPage() {
  // EL ROL, ANTES DEL CLIENTE DE SERVICIO. El guard de app/admin/layout.tsx no
  // protege esta pagina en una navegacion RSC parcial (Next renderiza solo el
  // segmento que cambia y no vuelve a ejecutar el layout), y lo de abajo firma
  // documentos de identidad con service_role. Ver lib/auth/require-admin-page.ts.
  //
  // `revisor` sirve ademas para no ofrecerle su propia solicitud: la base ya lo
  // impide (impedir_revisar_verificacion_propia_trg, 20260927110000).
  const { user: revisor } = await requireAdminPage();

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
    .select("*, profiles!user_id(nombre, email, trust_level, es_vendedor, seller_type, nombre_negocio)")
    // NULL cuenta como pendiente, igual que en verifyDocument y en la policy:
    // si no, poner la fila en NULL la sacaba de la cola con su nota negativa.
    .or("status.is.null,status.eq.pending")
    .order("created_at", { ascending: true });

  if (verificationsError) {
    Sentry.captureException(verificationsError, {
      tags: { action: "admin_listar_verificaciones" },
      contexts: {
        supabase: { code: verificationsError.code, details: verificationsError.details },
      },
    });
  }

  // HISTORIAL DEL VENDEDOR, AL PINTAR. El vendedor controla que filas tiene:
  // una fila que la IA dejo en 'rejected' sale de la cola, y puede abrir otra
  // limpia que nunca pase por la IA. Fundirlo solo al escribir (verifyDocument)
  // no basta: aqui se leen TODAS sus filas con el cliente de servicio (que el
  // vendedor no puede filtrar) y cada tarjeta ensena sus veredictos negativos y
  // los rechazos de un revisor. Si la lectura falla, la tarjeta lo dice.
  type FilaDelVendedor = {
    id: string;
    user_id: string;
    status: string | null;
    ai_analysis_raw: Json | null;
    ai_analizado_en: string | null;
    reviewer_note: string | null;
    reviewed_at: string | null;
  };
  const idsEnCola = [...new Set((verifications ?? []).map((v) => v.user_id))];
  let filasDelVendedor: FilaDelVendedor[] = [];
  let historialFallo = false;
  if (idsEnCola.length > 0) {
    // Solo filas con nota de la IA o revisadas por alguien: el vendedor puede
    // crear filas vacias en bucle, pero no escribir ai_analysis_raw ni
    // reviewed_at, asi que no puede inundar la ventana. Si llega llena, se
    // trata como historial incompleto.
    const LIMITE_HISTORIAL = 1000;
    const { data, error } = await adminSupabase
      .from("seller_verification")
      .select("id, user_id, status, ai_analysis_raw, ai_analizado_en, reviewer_note, reviewed_at")
      .in("user_id", idsEnCola)
      .or("ai_analysis_raw.not.is.null,reviewed_at.not.is.null")
      .order("created_at", { ascending: false })
      .limit(LIMITE_HISTORIAL);
    if (error || (data?.length ?? 0) >= LIMITE_HISTORIAL) {
      historialFallo = true;
      Sentry.captureException(error ?? new Error("historial de verificaciones truncado"), {
        tags: { action: "admin_historial_verificaciones" },
      });
    }
    filasDelVendedor = data ?? [];
  }

  // Generate signed URLs in parallel for all docs across all verifications
  const verificationsWithUrls = await Promise.all(
    (verifications ?? []).map(async (v) => {
      const [selfieUrl, ineFrontUrl, ineBackUrl, versiones] = await Promise.all([
        signOrNull(adminSupabase, v.selfie_url, v.user_id),
        signOrNull(adminSupabase, v.ine_front_url, v.user_id),
        signOrNull(adminSupabase, v.ine_back_url, v.user_id),
        v.ai_analysis_raw
          ? versionesActuales(adminSupabase, v.user_id, [v.selfie_url, v.ine_front_url, v.ine_back_url])
          : Promise.resolve([]),
      ]);
      const analisis = estadoDelAnalisis({
        hayAnalisis: !!v.ai_analysis_raw,
        vigente: v.ai_vigente,
        analizadoEn: v.ai_analizado_en,
        versiones,
      });
      const otras = filasDelVendedor.filter((f) => f.user_id === v.user_id && f.id !== v.id);
      const anteriores = fusionarHistoriales([
        anterioresDeLaNota(v.ai_analysis_raw),
        ...otras.map((f) => historialConNotaPrevia(f.ai_analysis_raw, f.ai_analizado_en)),
      ]);
      // Revisiones previas de una persona, INCLUIDA esta misma fila: tras un
      // rechazo, el vendedor reenvia sobre la misma fila (vuelve a 'pending') y
      // la nota del revisor se quedaba sin ensenar. reviewed_at y reviewer_note
      // solo los escriben las RPC de revision (ni la IA ni el vendedor), y el
      // status no se usa: el vendedor lo controla.
      const revisionesPrevias = [v, ...otras].filter(
        (f) => f.reviewed_at && (f.reviewer_note || f.status !== "approved"),
      );
      const resumen = resumenDeLaNota(v.ai_analysis_raw);
      return { ...v, selfieUrl, ineFrontUrl, ineBackUrl, analisis, anteriores, revisionesPrevias, resumen };
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
                      <p className="font-medium text-sm truncate">{publicProfileName(profile, "Usuario")}</p>
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

                {/* BUG-VERIF-IA (27-sep): la tarjeta no decia que faltaban
                    fotos ni que la IA no las habia visto, y mostraba la nota de
                    un intento anterior junto a la universidad nueva. */}
                {(() => {
                  const faltan = [
                    !v.selfie_url && "selfie",
                    !v.ine_front_url && "frente",
                    !v.ine_back_url && "reverso",
                  ].filter(Boolean) as string[];
                  const sinAnalisis = v.analisis === "ninguno";
                  const desfasado = v.analisis === "desfasado";
                  if (!faltan.length && !sinAnalisis && !desfasado) return null;
                  return (
                    <div className="flex flex-wrap gap-2">
                      {faltan.length > 0 && (
                        <span className="text-[10px] bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 px-2 py-0.5 rounded-full font-medium">
                          Incompleta: falta {faltan.join(", ")}
                        </span>
                      )}
                      {sinAnalisis && (
                        <span className="text-[10px] bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 px-2 py-0.5 rounded-full font-medium">
                          Sin análisis automático
                        </span>
                      )}
                      {desfasado && (
                        <span className="text-[10px] bg-red-50 text-red-700 dark:bg-red-950/40 dark:text-red-300 px-2 py-0.5 rounded-full font-medium">
                          La IA no ha visto estas fotos
                        </span>
                      )}
                    </div>
                  );
                })()}

                {/* La nota vieja NO se esconde: un veredicto negativo de un
                    envio anterior es informacion para el revisor, y borrarla
                    era justo lo que el vendedor podia provocar con un PATCH. */}
                {v.analisis !== "ninguno" && (() => {
                  // Con un veredicto real se usa el resumen (decision del
                  // servidor y alarmas); con el aviso de fallo del proveedor,
                  // su motivo tal cual.
                  // Un «aprobar» limpio tambien se dice: con la aprobacion
                  // automatica apagada, si no, no se distinguia «todo cuadra»
                  // de «no hay nada que decir».
                  const texto = v.resumen
                    ? v.resumen.motivo_rechazo_o_duda ??
                      (v.resumen.veredicto === "aprobar" && v.resumen.aprobable === true ? "todo cuadra (propone aprobar)." : null)
                    : motivoDeRechazo(v.ai_analysis_raw);
                  const alarma = !v.resumen
                    ? ""
                    : v.resumen.decision === "rejected"
                      ? "El servidor lo rechazó. "
                      : v.resumen.veredicto === "aprobar" && v.resumen.aprobable === false
                        ? "Propuso aprobar, pero no cuadra. "
                        : "";
                  if (!texto && !alarma) return null;
                  return (
                    <div className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-2 text-xs text-amber-800 dark:text-amber-400">
                      <span className="font-bold">🤖 {ETIQUETA_NOTA[v.analisis]}</span> {alarma}
                      {texto ?? ""}
                    </div>
                  );
                })()}

                {historialFallo && (
                  <p role="alert" className="text-xs text-red-600 dark:text-red-400">
                    No se pudo cargar el historial de este vendedor. Revísalo antes de decidir.
                  </p>
                )}

                {v.revisionesPrevias.map((f) => (
                  <div
                    key={f.id}
                    className="bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-md p-2 text-xs text-red-800 dark:text-red-300"
                  >
                    <span className="font-bold">
                      {f.id === v.id ? "Esta solicitud ya la revisó alguien" : "Revisada antes por un revisor"}
                      {f.reviewed_at
                        ? ` el ${new Date(f.reviewed_at).toLocaleDateString("es-MX", { timeZone: "America/Mexico_City" })}`
                        : ""}
                      {f.id === v.id ? "" : ` (estado actual: ${f.status ?? "pendiente"})`}:
                    </span>{" "}
                    {f.reviewer_note ?? "sin nota"}
                  </div>
                ))}

                {/* Veredictos NO aprobatorios de analisis anteriores. Volver a
                    analizar reemplaza la nota: sin esto, repetir hasta que el
                    modelo contestara algo menos malo borraba la advertencia. Se
                    ensenan aunque la nota actual no traiga motivo. */}
                {v.anteriores.map((a, i) => (
                  <div
                    key={`${a.analizado_en ?? "sin-fecha"}-${i}`}
                    className="bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 rounded-md p-2 text-xs text-amber-800 dark:text-amber-400"
                  >
                    <span className="font-bold">
                      🤖 La IA dijo en un análisis anterior ({esRechazo(a) ? "rechazo" : a.veredicto === "aprobar" ? "no cuadra" : "revisión humana"}
                      {a.entrada?.universidad ? `, ${a.entrada.universidad}` : ""}):
                    </span>{" "}
                    {a.motivo_rechazo_o_duda ?? "sin motivo"}
                  </div>
                ))}

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

                {revisor && v.user_id === revisor.id ? (
                  <p className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Tu solicitud.</span> La tiene que
                    revisar otro administrador.
                  </p>
                ) : (
                  <VerificationActions id={v.id} userId={v.user_id} />
                )}
              </div>
            );
          })}
        </div>
      ) : verificationsError ? (
        // Un fallo de lectura NO es una cola vacia: el check verde aqui decia
        // «nada pendiente» justo cuando no se podia leer nada.
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          No se pudo cargar la cola de verificaciones. Recarga la página; si sigue, revisa Sentry.
        </p>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center text-center py-12 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="font-medium">Sin verificaciones pendientes</p>
        </div>
      )}
    </div>
  );
}
