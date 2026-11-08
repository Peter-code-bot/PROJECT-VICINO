/**
 * Que columnas de ubicacion escribe el formulario de vender (GEO-PUB-EXACT).
 *
 * El formulario manda, junto con el punto, tres campos:
 *   - ubicacion_accion: "conservar" (no toco el mapa), "fijar" (elegi o movi el
 *     punto, o cambie el modo) o "quitar". Antes no existia: editar el precio
 *     reenviaba el punto cargado al abrir y el servidor no podia distinguir "no
 *     lo toque" de "lo puse igual".
 *   - ubicacion_precision: "exacta" o "aproximada".
 *   - confirmar_ubicacion_exacta: "1" cuando el vendedor confirmo que se vera su
 *     punto exacto (al publicar es el propio boton de publicar; al editar, la
 *     confirmacion explicita que pide el formulario si el punto cambia).
 *
 * Falla cerrado: lo que no llegue o llegue mal nunca publica un punto exacto.
 * Un formulario abierto antes del despliegue no manda ubicacion_accion: si
 * movio el pin, la publicacion queda aproximada. El modo, el punto y la
 * etiqueta van en la MISMA escritura; la base deriva el punto publico y la
 * revision (trigger zz_ubicacion_publica_derivada).
 *
 * Funciones puras: reciben FormData o valores, no tocan la red.
 */
import type { PrecisionUbicacion } from "./ubicacion-publica";

export type AccionUbicacion = "conservar" | "fijar" | "quitar";

export interface EntradaUbicacion {
  /** null = formulario anterior a este cambio. */
  accion: AccionUbicacion | null;
  /** null = no vino (o vino vacio). */
  precision: PrecisionUbicacion | null;
  confirmada: boolean;
  punto: { lat: number; lng: number } | null;
  /** remove_location="true" del formulario anterior. */
  quitarHeredado: boolean;
  etiqueta: string | null;
  radioKm: number | null;
}

export type Resultado<T> = { ok: true; valor: T } | { ok: false; error: string };

const MENSAJE_COORDENADAS = "Las coordenadas de la ubicación son inválidas";
export const MENSAJE_CONFIRMAR_EXACTA =
  "Confirma que quieres mostrar el punto exacto de tu publicación antes de guardar.";

function texto(formData: FormData, nombre: string): string | null {
  const valor = formData.get(nombre);
  return typeof valor === "string" ? valor : null;
}

/** Lee y valida los campos de ubicacion. No decide que se escribe. */
export function leerEntradaUbicacion(formData: FormData): Resultado<EntradaUbicacion> {
  const accionCruda = texto(formData, "ubicacion_accion");
  let accion: AccionUbicacion | null = null;
  if (accionCruda !== null && accionCruda !== "") {
    if (accionCruda !== "conservar" && accionCruda !== "fijar" && accionCruda !== "quitar") {
      return { ok: false, error: "Selección de ubicación inválida" };
    }
    accion = accionCruda;
  }

  const precisionCruda = texto(formData, "ubicacion_precision");
  let precision: PrecisionUbicacion | null = null;
  if (precisionCruda !== null && precisionCruda !== "") {
    if (precisionCruda !== "exacta" && precisionCruda !== "aproximada") {
      return { ok: false, error: "Elige si la ubicación es exacta o aproximada" };
    }
    precision = precisionCruda;
  }

  const quitar = texto(formData, "remove_location") ?? "false";
  if (quitar !== "true" && quitar !== "false") return { ok: false, error: "Selección de ubicación inválida" };

  const latCruda = texto(formData, "ubicacion_lat");
  const lngCruda = texto(formData, "ubicacion_lng");
  let punto: { lat: number; lng: number } | null = null;
  if (latCruda && lngCruda) {
    const lat = Number(latCruda);
    const lng = Number(lngCruda);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      return { ok: false, error: MENSAJE_COORDENADAS };
    }
    // (0, 0) es el "sin seleccion" del formulario, no un punto en el Atlantico.
    if (lat !== 0 || lng !== 0) punto = { lat, lng };
  }

  const radioCrudo = texto(formData, "delivery_radius_km");
  const radio = radioCrudo ? Number(radioCrudo) : null;
  const etiqueta = texto(formData, "ubicacion");

  return {
    ok: true,
    valor: {
      accion,
      precision,
      confirmada: texto(formData, "confirmar_ubicacion_exacta") === "1",
      punto,
      quitarHeredado: quitar === "true",
      etiqueta: etiqueta !== null && etiqueta.length > 0 ? etiqueta : null,
      radioKm: radio !== null && Number.isFinite(radio) ? radio : null,
    },
  };
}

const ewkt = (p: { lat: number; lng: number }) => `SRID=4326;POINT(${p.lng} ${p.lat})`;

export interface UbicacionAlCrear {
  ubicacion_geo: string;
  ubicacion_precision: PrecisionUbicacion;
}

/**
 * Al publicar. El punto es obligatorio (lo era antes). Exacta solo si el
 * formulario la pidio Y la confirmo; sin campo, aproximada.
 */
export function ubicacionAlCrear(entrada: EntradaUbicacion): Resultado<UbicacionAlCrear> {
  if (!entrada.punto) return { ok: false, error: "Selecciona una ubicación en el mapa para tu publicación" };
  const precision = entrada.precision ?? "aproximada";
  if (precision === "exacta" && !entrada.confirmada) return { ok: false, error: MENSAJE_CONFIRMAR_EXACTA };
  return { ok: true, valor: { ubicacion_geo: ewkt(entrada.punto), ubicacion_precision: precision } };
}

/** Lo que el dueno tiene guardado (ubicacion_de_mi_publicacion o get_product_location). */
export interface UbicacionGuardada {
  lat: number | null;
  lng: number | null;
}

/** Diferencia menor que esto (~0.1 mm) es el mismo punto tras ir y volver como texto. */
const MISMO_PUNTO = 1e-9;

export function mismoPunto(a: { lat: number; lng: number } | null, b: UbicacionGuardada | null): boolean {
  if (!a || !b || b.lat === null || b.lng === null) return false;
  return Math.abs(a.lat - b.lat) < MISMO_PUNTO && Math.abs(a.lng - b.lng) < MISMO_PUNTO;
}

/**
 * Al editar: columnas que hay que escribir (vacio = no tocar nada de la
 * ubicacion; ni el punto, ni la etiqueta, ni el radio, ni el modo).
 *
 * `guardada` solo hace falta para el formulario anterior (sin accion), para
 * saber si movio el pin; puede ser null si no se pudo leer, y entonces se
 * asume que lo movio (y queda aproximada).
 */
export function cambiosAlEditar(entrada: EntradaUbicacion, guardada: UbicacionGuardada | null): Resultado<Record<string, unknown>> {
  const quitar = { ubicacion_geo: null, ubicacion: null, delivery_radius_km: null, ubicacion_precision: "aproximada" };
  const conPunto = (punto: { lat: number; lng: number }, precision: PrecisionUbicacion) => ({
    ubicacion_geo: ewkt(punto),
    ubicacion_precision: precision,
    ...(entrada.etiqueta !== null ? { ubicacion: entrada.etiqueta } : {}),
    ...(entrada.radioKm !== null ? { delivery_radius_km: entrada.radioKm } : {}),
  });

  if (entrada.accion === "quitar" || (entrada.accion === null && entrada.quitarHeredado)) return { ok: true, valor: quitar };
  if (entrada.accion === "conservar") return { ok: true, valor: {} };

  if (entrada.accion === "fijar") {
    if (!entrada.punto) return { ok: false, error: "Selecciona una ubicación en el mapa para tu publicación" };
    const precision = entrada.precision ?? "aproximada";
    if (precision === "exacta" && !entrada.confirmada) return { ok: false, error: MENSAJE_CONFIRMAR_EXACTA };
    return { ok: true, valor: conPunto(entrada.punto, precision) };
  }

  // Formulario anterior: sin punto no toca nada; con el mismo punto, tampoco;
  // si lo movio, se guarda el punto nuevo como aproximado (nunca exacto sin
  // la confirmacion que ese formulario no sabe pedir).
  if (!entrada.punto || mismoPunto(entrada.punto, guardada)) return { ok: true, valor: {} };
  return { ok: true, valor: conPunto(entrada.punto, "aproximada") };
}
