import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChatAttachment } from "@vicino/shared";

/** El bucket es PRIVADO. De aqui no sale nunca una URL publica. */
export const CHAT_BUCKET = "chat-media";

/**
 * Lado mayor al que se reduce la foto antes de subirla. 1600 px cubre de sobra
 * una pantalla de movil a 3x y deja los archivos en decenas de KB. El bucket
 * admite 10 MB, pero el limite que importa aqui no es el del bucket: es el dato
 * movil de quien recibe.
 */
const LADO_MAX = 1600;
const CALIDAD = 0.82;

/**
 * Cuanto vale una URL firmada. Una hora es de sobra para ver la conversacion y
 * lo bastante corta para que un enlace reenviado por accidente no sea una
 * puerta abierta. Se vuelven a firmar al recargar.
 */
export const FIRMA_TTL_SEGUNDOS = 3600;

export type FotoComprimida = { blob: Blob; w: number; h: number };

/**
 * Reduce y recodifica a WebP en el navegador.
 *
 * Se hace ANTES de subir y no despues por una razon concreta: subir el original
 * y recomprimir en el servidor gasta el dato de quien manda dos veces y deja el
 * pesado guardado igual. Aqui lo que viaja ya es lo que se guarda.
 *
 * Devuelve tambien el tamano final porque el chat lo necesita para reservar el
 * hueco de la imagen: sin eso, la conversacion pega un salto cuando cada foto
 * termina de cargar y te saca del sitio donde estabas leyendo.
 */
export async function comprimirFoto(file: File): Promise<FotoComprimida> {
  const bitmap = await createImageBitmap(file);
  try {
    const escala = Math.min(1, LADO_MAX / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * escala));
    const h = Math.max(1, Math.round(bitmap.height * escala));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("No se pudo preparar la imagen");
    ctx.drawImage(bitmap, 0, 0, w, h);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", CALIDAD),
    );
    if (!blob) throw new Error("No se pudo preparar la imagen");
    return { blob, w, h };
  } finally {
    // Un ImageBitmap retiene su memoria hasta que se cierra. Sin esto, mandar
    // varias fotos seguidas va dejando copias descomprimidas colgadas.
    bitmap.close();
  }
}

/**
 * Sube las fotos a <chat_id>/<autor_id>/ y devuelve los adjuntos.
 *
 * El chat delante de la ruta NO es decorativo: es lo que la policy de storage
 * mira para decidir quien puede leer. Con la convencion anterior —la carpeta
 * propia del que sube— la persona a la que iba dirigida la foto era justo la
 * unica sin permiso para verla.
 *
 * Si una falla, se BORRA lo ya subido antes de propagar el error. Sin esa
 * limpieza, cada envio a medias deja archivos que no referencia nadie: asi es
 * como se juntaron los 31 huerfanos que aparecieron esta manana en otros
 * buckets. La policy de DELETE de chat-media existe exactamente para esto.
 */
export async function subirAdjuntos(
  supabase: SupabaseClient,
  chatId: string,
  userId: string,
  files: File[],
): Promise<ChatAttachment[]> {
  const subidos: string[] = [];
  const adjuntos: ChatAttachment[] = [];

  try {
    for (const file of files) {
      const { blob, w, h } = await comprimirFoto(file);
      const path = `${chatId}/${userId}/${crypto.randomUUID()}.webp`;

      const { error } = await supabase.storage
        .from(CHAT_BUCKET)
        .upload(path, blob, { contentType: "image/webp", cacheControl: "3600" });
      if (error) throw new Error(error.message);

      subidos.push(path);
      adjuntos.push({ path, tipo: "image", w, h });
    }
    return adjuntos;
  } catch (error) {
    if (subidos.length > 0) {
      // Best-effort: si la limpieza tambien falla no se puede hacer nada mas
      // desde aqui, y tapar el error original con el de la limpieza dejaria a
      // la persona sin saber por que no se envio su foto.
      await supabase.storage.from(CHAT_BUCKET).remove(subidos).catch(() => {});
    }
    throw error;
  }
}

/**
 * Firma en bloque las rutas de un lote de mensajes.
 *
 * Va por lotes y no una por una porque una conversacion con fotos pediria una
 * peticion por imagen en cada carga. Las rutas que la firma rechaza —porque
 * quien mira no es del chat, o porque el archivo ya no esta— simplemente no
 * entran al mapa, y el chat pinta el hueco de "no disponible" en vez de un
 * enlace roto.
 */
export async function firmarAdjuntos(
  supabase: SupabaseClient,
  paths: string[],
): Promise<Map<string, string>> {
  const firmadas = new Map<string, string>();
  if (paths.length === 0) return firmadas;

  const { data, error } = await supabase.storage
    .from(CHAT_BUCKET)
    .createSignedUrls(paths, FIRMA_TTL_SEGUNDOS);
  if (error || !data) return firmadas;

  for (const item of data) {
    if (item.signedUrl && item.path) firmadas.set(item.path, item.signedUrl);
  }
  return firmadas;
}

/**
 * Lee el array `attachments` de un mensaje, que llega de la base como `unknown`.
 *
 * Es contenido escrito por otra persona: se comprueba la forma antes de usarlo
 * en vez de confiar en el tipo. Lo que no encaja se descarta en silencio — un
 * adjunto malformado no debe impedir que se lea el resto de la conversacion.
 */
export function leerAdjuntos(valor: unknown): ChatAttachment[] {
  if (!Array.isArray(valor)) return [];
  const salida: ChatAttachment[] = [];
  for (const item of valor) {
    if (!item || typeof item !== "object") continue;
    const a = item as Record<string, unknown>;
    if (typeof a.path !== "string" || a.tipo !== "image") continue;
    salida.push({
      path: a.path,
      tipo: "image",
      w: typeof a.w === "number" ? a.w : undefined,
      h: typeof a.h === "number" ? a.h : undefined,
    });
  }
  return salida;
}
