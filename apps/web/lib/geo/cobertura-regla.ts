/* Logica pura de la regla, sin React ni Supabase: la importan location-search y
   sus pruebas (node --test no resuelve el alias "@/"). El hook vive en cobertura.ts. */

/**
 * Regla de cobertura de VICINO leida de la base (`vicino_cobertura`, clave
 * 'operacion'): la MISMA que aplica `dentro_de_cobertura()` al publicar.
 *
 * Existe porque el buscador de ubicaciones recortaba sugerencias con
 * NEXT_PUBLIC_COVERAGE_RADIUS_KM (200 km desde Puebla por defecto) mientras la
 * base ya operaba en todo Mexico desde el 14-sep: Villahermosa se podia
 * publicar pero no se podia elegir (reporte de Javier, 26-sep). Una variable
 * de build no se entera cuando cambia la base; esto si.
 */
export type ReglaCobertura =
  | { modo: "pais" }
  | { modo: "radio"; centro: { lat: number; lng: number }; radioKm: number };

/** Sin regla legible se deja pasar Mexico entero, como hace la base sin fila. */
export const COBERTURA_PAIS: ReglaCobertura = { modo: "pais" };

type FilaCobertura = {
  modo: string;
  centro_lat: number | null;
  centro_lng: number | null;
  radio_km: number | null;
};

export function reglaDesdeFila(fila: FilaCobertura | null | undefined): ReglaCobertura {
  if (!fila || fila.modo !== "radio") return COBERTURA_PAIS;
  const { centro_lat: lat, centro_lng: lng, radio_km: radioKm } = fila;
  if (lat == null || lng == null || radioKm == null) return COBERTURA_PAIS;
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(radioKm) || radioKm <= 0) {
    return COBERTURA_PAIS;
  }
  return { modo: "radio", centro: { lat, lng }, radioKm };
}
