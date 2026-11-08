/**
 * Ubicacion publica de una publicacion (encargo GEO-PUB-EXACT-20261104).
 *
 * Cada publicacion guarda su precision en products_services.ubicacion_precision:
 *   - "exacta": el vendedor eligio y confirmo el punto; ficha, minimapa y mapa
 *     muestran ESE punto (columna ubicacion_exacta, la deriva un trigger).
 *   - "aproximada": se publica la rejilla, nunca ubicacion_geo. Las anteriores
 *     al cambio son todas aproximadas.
 *
 * El dato autorizado lo calcula la base (public.ubicacion_publica_punto) y lo
 * leen igual el mapa (search_map_publications_v4) y la ficha y el minimapa
 * (ubicacion_publica_de_publicacion). Aqui solo viven la eleccion de la rejilla
 * aproximada, que decide el servidor, y lo que necesita la vista previa del
 * formulario, que no es autoritativo.
 *
 * Funciones puras: sin red, sin entorno global (el entorno entra por argumento).
 */

export type PrecisionUbicacion = "exacta" | "aproximada";
export type DecimalesRejilla = 2 | 3;

export const PRECISION_POR_DEFECTO_AL_CREAR: PrecisionUbicacion = "exacta";
/** Lo que se asume si no llega nada: un formulario viejo o un POST a mano. */
export const PRECISION_SI_FALTA: PrecisionUbicacion = "aproximada";

export function esPrecisionUbicacion(valor: unknown): valor is PrecisionUbicacion {
  return valor === "exacta" || valor === "aproximada";
}

/**
 * Decimales de la rejilla APROXIMADA. VICINO_MAPA_RPC=v3 (o v4) activa la de
 * ~110 m del PR #75; sin la variable, con otro valor o con una errata, se queda
 * la de ~1 km que se ve hoy. Falla cerrado, igual que la ruta del mapa antes de
 * este cambio. Las exactas no dependen de esto.
 */
export function decimalesRejillaAproximada(valorVariable: string | undefined | null): DecimalesRejilla {
  const valor = (valorVariable ?? "").trim().toLowerCase();
  return valor === "v3" || valor === "v4" ? 3 : 2;
}

/**
 * Redondeo como el round(numeric, n) de Postgres: la mitad se aleja del cero
 * (Math.round la acerca a +infinito, y en Mexico las longitudes son negativas).
 * Solo para la vista previa: el dato publico lo calcula la base.
 */
export function redondearComoLaBase(valor: number, decimales: DecimalesRejilla): number {
  if (!Number.isFinite(valor)) return Number.NaN;
  const factor = 10 ** decimales;
  // toPrecision(15): los mismos digitos significativos que el cast float8 -> numeric.
  const escalado = Number((Math.abs(valor) * factor).toPrecision(15));
  return (Math.sign(valor) * Math.round(escalado)) / factor;
}

/** Centro de la celda aproximada que veran los compradores. */
export function centroAproximado(lat: number, lng: number, decimales: DecimalesRejilla): [number, number] {
  return [redondearComoLaBase(lat, decimales), redondearComoLaBase(lng, decimales)];
}

/**
 * Radio, en km, del circulo que representa la celda en la vista previa: media
 * diagonal de una celda de 0.001 grados (~78 m) o de 0.01 (~0.78 km) a la
 * latitud de Puebla, redondeada hacia arriba.
 */
export function radioVistaPreviaKm(decimales: DecimalesRejilla): number {
  return decimales === 3 ? 0.08 : 0.8;
}

/** Como se dice la precision aproximada en la interfaz. */
export function textoTamanoAproximado(decimales: DecimalesRejilla): string {
  return decimales === 3 ? "unos 100 m" : "alrededor de 1 km";
}
