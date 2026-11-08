/**
 * Interpretacion UNICA de las cookies de zona (`vicino_location` y
 * `vicino_radius`).
 *
 * Antes cada lector del servidor tenia su propia version y no coincidian: el
 * inicio comprobaba finitud y rangos con parseFloat, la tira del ranking solo
 * miraba NaN, /rankings daba por activa cualquier cookie no vacia y /buscar y
 * /mapa usaban parseCoordinates. Ninguno, salvo /mapa, comprobaba que el punto
 * cayera en el area del mapa.
 *
 * Es PURA e isomorfa a proposito (sin next/headers ni "server-only"): la usan
 * el lector del servidor (ubicacion-servidor.ts) y el ambito de la cache de
 * sesion (session-scope.ts), que corre en los dos lados. Si las dos capas
 * interpretaran distinto la misma cookie, la semilla del HTML quedaria bajo una
 * clave que el cliente no calcula.
 *
 * Recibe los valores YA decodificados: `cookies()` de Next los entrega asi, y
 * session-scope decodifica los de `document.cookie` antes de llamar.
 */
import { MAP_AREA } from "@vicino/shared";
import { parseCoordinates } from "./location-storage";
import { parseRadiusCookie } from "./radius";

export interface PuntoZona {
  lat: number;
  lng: number;
}

/**
 * - `ausente`: no hay cookie de ubicacion (o esta vacia).
 * - `invalida`: hay cookie pero no es "lat,lng" con numeros finitos en rango.
 * - `fuera-de-area`: es un punto valido, pero fuera de MAP_AREA.
 * - `valida`: punto dentro de MAP_AREA, redondeado a 3 decimales.
 *
 * Que hace cada llamador con `fuera-de-area` es decision suya: el inicio y
 * /buscar lo tratan como sin ubicacion, /rankings lo cuenta como ubicacion
 * activa sin consultar (si no, la tarjeta de activar volveria a guardar el
 * mismo punto y reapareceria sin salida).
 */
export type ZonaGuardada =
  | { estado: "ausente" | "invalida"; punto: null; radio: number }
  | { estado: "fuera-de-area" | "valida"; punto: PuntoZona; radio: number };

/**
 * El mismo redondeo que writeLocation (`toFixed(3)`), para que interpretar una
 * cookie ya escrita por la app no la mueva: aplicado dos veces da lo mismo.
 */
export function redondearCoordenada(valor: number): number {
  return Number(valor.toFixed(3));
}

/**
 * MAP_AREA y la caja de Mexico de location-search.ts (MEXICO_BBOX) tienen los
 * mismos limites; se usa MAP_AREA porque vive en @vicino/shared, que es seguro
 * en servidor y cliente, y es la que ya valida /mapa y /api/map-preview. Los
 * bordes cuentan como dentro, igual que en mapa/page.tsx.
 */
export function dentroDeMapArea(punto: PuntoZona): boolean {
  return Number.isFinite(punto.lat) && Number.isFinite(punto.lng)
    && punto.lat >= MAP_AREA.south && punto.lat <= MAP_AREA.north
    && punto.lng >= MAP_AREA.west && punto.lng <= MAP_AREA.east;
}

export function interpretarZonaGuardada(
  ubicacion: string | null | undefined,
  radio: string | null | undefined,
): ZonaGuardada {
  // El radio se lee siempre: el valor del inicio lo devuelve aunque no haya
  // punto, y con la misma funcion que ya compartian los cuatro lectores.
  const radioValido = parseRadiusCookie(radio);
  if (typeof ubicacion !== "string" || ubicacion.trim() === "") {
    return { estado: "ausente", punto: null, radio: radioValido };
  }
  const crudo = parseCoordinates(ubicacion);
  if (!crudo) return { estado: "invalida", punto: null, radio: radioValido };
  // Se redondea ANTES de mirar el area: el punto que se consulta y el que se
  // compara tienen que ser el mismo.
  const punto = { lat: redondearCoordenada(crudo.lat), lng: redondearCoordenada(crudo.lng) };
  return {
    estado: dentroDeMapArea(punto) ? "valida" : "fuera-de-area",
    punto,
    radio: radioValido,
  };
}
