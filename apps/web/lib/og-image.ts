import { isVideoUrl, posterUrl } from "@/lib/video-thumbnail";

/**
 * Imagen de previsualizacion al compartir. Nunca devuelve vacio.
 *
 * Antes se mandaba `posterUrl(imagen_principal)` y ya. Eso tiene dos agujeros
 * que se ven justo en el canal por el que comparten los vendedores:
 *
 *   1. Si la principal es un video, la miniatura _thumb.jpg puede NO existir.
 *      Generarla es "best effort": si falla, el codigo deja un console.warn y
 *      sigue. WhatsApp pide entonces una URL que da 404 y no ensena nada.
 *   2. Si no hay imagen principal, se mandaba una lista vacia y tampoco habia
 *      previsualizacion.
 *
 * Se prefiere una imagen DE VERDAD de la galeria antes que la miniatura de un
 * video, porque una imagen subida siempre existe. La miniatura solo se usa
 * cuando no hay ninguna otra opcion, y el logotipo del sitio cierra el caso de
 * que no haya nada. Cero peticiones extra: todo sale de la misma fila.
 */
export function ogImageUrl(
  imagenPrincipal: string | null | undefined,
  galeria: readonly string[] | null | undefined,
  siteUrl: string,
): string {
  const candidatas = [imagenPrincipal, ...(galeria ?? [])].filter(
    (u): u is string => typeof u === "string" && u.length > 0,
  );

  const imagenReal = candidatas.find((u) => !isVideoUrl(u));
  if (imagenReal) return imagenReal;

  const primerVideo = candidatas[0];
  if (primerVideo) return posterUrl(primerVideo);

  return `${siteUrl}/og-image.jpg`;
}
