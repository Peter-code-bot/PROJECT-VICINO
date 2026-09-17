import type { SupabaseClient } from "@supabase/supabase-js";
import { comprimirFoto, FIRMA_TTL_SEGUNDOS } from "@/lib/chat/attachments";

/**
 * Imagenes de las publicaciones y los comentarios de comunidades.
 *
 * Es el mismo circuito que el del chat (lib/chat/attachments.ts) con una sola
 * diferencia de forma: aqui la columna guarda RUTAS peladas (text[]) y no un
 * jsonb con dimensiones. Se comprime antes de subir, se sube al bucket privado,
 * se firma para mostrar y se lee con un parser defensivo.
 *
 * La compresion NO se duplica: se reutiliza comprimirFoto del chat. Dos lienzos
 * con parametros distintos acabarian dando fotos de peso distinto segun por
 * donde entraran, y el dia que haya que cambiar la calidad se cambiaria en uno
 * de los dos sitios.
 *
 * Este modulo NO lleva "use client" a proposito: actions.ts (servidor) importa
 * de aqui los topes para volver a validarlos, y un helper exportado desde un
 * modulo cliente revienta en runtime al llamarlo en el servidor aunque tsc y el
 * build salgan verdes. Todo lo que toca el navegador (canvas, crypto) se usa
 * DENTRO del cuerpo de una funcion, nunca al cargar el modulo.
 */

/** El bucket es PRIVADO. De aqui no sale nunca una URL publica, solo rutas. */
export const COMMUNITY_BUCKET = "community-media";

/**
 * Espejo del tope que aplica publicar_en_comunidad sobre p_imagenes. El limite
 * de verdad vive en la base; este solo evita gastar una subida y una peticion
 * cuando ya se sabe que va a rebotar.
 */
export const MAX_IMAGENES_POR_PUBLICACION = 4;

/**
 * Tope de ENTRADA por imagen, antes de comprimir: lo que acaba subiendo pesa
 * mucho menos. Se rechaza aqui y no despues de comprimir porque decodificar un
 * archivo enorme es justo lo que cuelga un movil de gama baja.
 */
export const MAX_BYTES_POR_IMAGEN = 5 * 1024 * 1024;

/** Espejo del largo maximo de ruta que valida el servidor antes de la RPC. */
export const MAX_LARGO_RUTA = 512;

/** La firma dura lo mismo que en el chat: una hora, y se vuelve a pedir. */
export { FIRMA_TTL_SEGUNDOS };

/**
 * La carpeta de quien sube. Vive en UNA funcion porque la misma convencion la
 * exigen tres sitios a la vez -- la policy del bucket, la RPC y el validador
 * del servidor -- y si se escribe a mano en cada uno, cambiarla deja dos de los
 * tres apuntando a la convencion vieja y las subidas mueren con un 403 que no
 * explica nada.
 */
export function prefijoImagenesComunidad(communityId: string, userId: string): string {
  return `${communityId}/${userId}/`;
}

/**
 * Comprueba que una ruta pertenece a quien publica, dentro de la comunidad
 * donde se publica, y que no se sale de su carpeta.
 *
 * La comunidad va DELANTE del autor a proposito: es lo que permite que la
 * policy de lectura del bucket exija pertenencia. Con la ruta <uid>/<archivo>
 * no se podia saber de que comunidad era un archivo, y la unica policy posible
 * era "cualquiera con sesion": las fotos de una comunidad privada quedaban
 * legibles para quien conociera la ruta.
 *
 * El `..` importa: sin esa comprobacion,
 * "<comunidad>/<uid>/../otro/foto.webp" empieza por el prefijo correcto y
 * sigue apuntando fuera.
 */
export function esRutaDeAutor(ruta: unknown, communityId: string, userId: string): ruta is string {
  if (typeof ruta !== "string") return false;
  if (ruta.length === 0 || ruta.length > MAX_LARGO_RUTA) return false;
  // Se compara la ruta CRUDA: recortarla aqui y mandar la recortada seria
  // validar una cosa y escribir otra.
  if (ruta.trim() !== ruta) return false;
  if (!ruta.startsWith(prefijoImagenesComunidad(communityId, userId))) return false;
  const tramos = ruta.split("/");
  return !tramos.some((t) => t.length === 0 || t === "." || t === "..");
}

/**
 * Lee la columna `imagenes`, que llega como `unknown` mientras los tipos
 * generados no se regeneren, y despues como text[].
 *
 * Es contenido que escribio otra persona: se comprueba la forma en vez de
 * confiar en el tipo. Lo que no encaja se descarta en silencio -- una ruta
 * malformada no debe impedir que se lea el resto de la publicacion -- y se
 * recorta al tope para que una fila con veinte rutas no pinte veinte huecos.
 */
export function leerImagenes(valor: unknown): string[] {
  if (!Array.isArray(valor)) return [];
  const salida: string[] = [];
  for (const item of valor) {
    if (typeof item !== "string") continue;
    const ruta = item.trim();
    if (ruta.length === 0 || ruta.length > MAX_LARGO_RUTA) continue;
    if (salida.includes(ruta)) continue;
    salida.push(ruta);
    if (salida.length === MAX_IMAGENES_POR_PUBLICACION) break;
  }
  return salida;
}

export interface AdmisionImagenes {
  imagenes: File[];
  /** Vacio si entraron todas. Si no, POR QUE se quedaron fuera las demas. */
  aviso: string;
}

/**
 * Decide que imagenes entran de las que se acaban de elegir.
 *
 * Descartar en silencio es lo que hace que alguien elija seis, vea cuatro y no
 * sepa si las otras fallaron o si nunca las selecciono.
 */
export function admitirImagenes(actuales: File[], nuevas: File[]): AdmisionImagenes {
  const hueco = Math.max(0, MAX_IMAGENES_POR_PUBLICACION - actuales.length);
  const esImagen = (f: File) => f.type.startsWith("image/");
  const validas = nuevas.filter((f) => esImagen(f) && f.size <= MAX_BYTES_POR_IMAGEN);

  const porTipo = nuevas.filter((f) => !esImagen(f)).length;
  const porPeso = nuevas.filter((f) => esImagen(f) && f.size > MAX_BYTES_POR_IMAGEN).length;
  const sobrantes = Math.max(0, validas.length - hueco);

  const avisos: string[] = [];
  if (porTipo > 0) avisos.push("solo se pueden subir imágenes");
  if (porPeso > 0) avisos.push("cada imagen debe pesar 5 MB o menos");
  if (sobrantes > 0) avisos.push(`el máximo es ${MAX_IMAGENES_POR_PUBLICACION} por publicación`);

  return {
    imagenes: [...actuales, ...validas.slice(0, hueco)],
    aviso: avisos.length > 0 ? `No se añadieron todas: ${avisos.join(", ")}.` : "",
  };
}

/**
 * Sube las imagenes a <community_id>/<autor_id>/ y devuelve las RUTAS, en el
 * mismo orden en que se eligieron.
 *
 * Rutas y no URLs firmadas: una firma caduca, asi que guardarla en la columna
 * seria guardar algo que deja de servir al cabo de una hora.
 *
 * Si una falla, se BORRA lo ya subido antes de propagar el error. Sin esa
 * limpieza cada envio a medias deja archivos que no referencia nadie, que es
 * como se juntaron los 31 huerfanos del bucket del chat.
 */
export async function subirImagenesComunidad(
  supabase: SupabaseClient,
  communityId: string,
  userId: string,
  files: File[],
): Promise<string[]> {
  if (files.length === 0) return [];
  if (files.length > MAX_IMAGENES_POR_PUBLICACION) {
    throw new Error(`El máximo es ${MAX_IMAGENES_POR_PUBLICACION} imágenes por publicación`);
  }

  const rutas: string[] = [];
  try {
    for (const file of files) {
      const { blob } = await comprimirFoto(file);
      const ruta = `${prefijoImagenesComunidad(communityId, userId)}${crypto.randomUUID()}.webp`;

      const { error } = await supabase.storage
        .from(COMMUNITY_BUCKET)
        .upload(ruta, blob, { contentType: "image/webp", cacheControl: "3600" });
      if (error) throw new Error(error.message);

      rutas.push(ruta);
    }
    return rutas;
  } catch (error) {
    await borrarImagenesComunidad(supabase, rutas);
    throw error;
  }
}

/**
 * Borra rutas del bucket. Es best-effort a proposito: si la limpieza tambien
 * falla no se puede hacer nada mas desde aqui, y tapar el error original con el
 * de la limpieza dejaria a la persona sin saber por que no se publico su foto.
 */
export async function borrarImagenesComunidad(
  supabase: SupabaseClient,
  rutas: string[],
): Promise<void> {
  if (rutas.length === 0) return;
  try {
    await supabase.storage.from(COMMUNITY_BUCKET).remove(rutas);
  } catch {
    // Silencio deliberado: ver el comentario de arriba.
  }
}

/**
 * Firma en bloque las rutas visibles.
 *
 * En bloque y no una por una porque un muro con fotos pediria una peticion por
 * imagen en cada carga. Las rutas que la firma rechaza -- porque quien mira no
 * puede leer el bucket, o porque el archivo ya no esta -- simplemente no entran
 * al mapa, y la tarjeta pinta el hueco de "no disponible" en vez de una imagen
 * rota.
 */
export async function firmarImagenesComunidad(
  supabase: SupabaseClient,
  rutas: string[],
): Promise<Map<string, string>> {
  const firmadas = new Map<string, string>();
  if (rutas.length === 0) return firmadas;

  const { data, error } = await supabase.storage
    .from(COMMUNITY_BUCKET)
    .createSignedUrls(rutas, FIRMA_TTL_SEGUNDOS);
  if (error || !data) return firmadas;

  for (const item of data) {
    if (item.signedUrl && item.path) firmadas.set(item.path, item.signedUrl);
  }
  return firmadas;
}
