/**
 * Lógica PURA del modo en vivo del piloto (PDF 05): decide si una lectura de
 * ubicación se aplica (se vuelve a consultar «Cerca de ti» con ella) y si
 * además se escribe la cookie de zona, que refresca todo el inicio.
 *
 * Todavía NO está conectada a nada: ni watchPosition, ni bandera, ni pantalla.
 * Quien la conecte debe además: parar al ocultarse o perder el permiso, no
 * escribir recientes, no tocar la URL y no registrar coordenadas.
 *
 * Inmutable: recibe el estado anterior y devuelve uno nuevo; nunca muta nada.
 *
 * TODOS LOS UMBRALES SON VALORES INICIALES PARA EL PILOTO, PENDIENTES DE
 * DECISIÓN DE JAVIER, y se ajustan en las pruebas de batería y de estabilidad
 * del carrusel. Justificación de partida: 300 m son unas 3 celdas de la cookie
 * (0,001° ≈ 111 m de latitud) y quedan por encima del ruido en interiores y de
 * los cubos de distancia de 100 m; 60 s mantienen ≤ 1 consulta por minuto por
 * teléfono frente al cupo de 60/min por IP compartido detrás de un NAT.
 */
import { mismoPunto } from "./cambios-ubicacion";
import { calculateDistanceKm } from "./location-search";
import { RADIUS_MAX_METERS, RADIUS_MIN_METERS } from "./radius";
import { dentroDeMapArea, redondearCoordenada } from "./zona-guardada";

/** Valor inicial para el piloto, pendiente de decisión de Javier: precisión peor que esto se descarta. */
export const PRECISION_MAXIMA_M = 500;
/** Valor inicial para el piloto, pendiente de decisión de Javier: movimiento mínimo contra el último punto APLICADO. */
export const DISTANCIA_MINIMA_M = 300;
/** Valor inicial para el piloto, pendiente de decisión de Javier: el umbral nunca baja de este múltiplo de la precisión. */
export const FACTOR_PRECISION = 2;
/** Valor inicial para el piloto, pendiente de decisión de Javier: tiempo mínimo entre dos aplicaciones. */
export const INTERVALO_MINIMO_MS = 60_000;
/**
 * Valor inicial para el piloto, pendiente de decisión de Javier. Con permiso
 * APROXIMADO la precisión ronda kilómetros (INFERIDO): con el tope de 500 m no
 * se aplicaría ninguna lectura. Alternativa a decidir: apagar el modo en vivo
 * con ubicación aproximada y actualizar solo al abrir.
 */
export const PRECISION_MAXIMA_APROXIMADA_M = 5_000;
/** Valor inicial para el piloto, pendiente de decisión de Javier: movimiento mínimo con permiso aproximado. */
export const DISTANCIA_MINIMA_APROXIMADA_M = 2_000;
/** Valor inicial para el piloto, pendiente de decisión de Javier: intervalo mínimo con permiso aproximado. */
export const INTERVALO_MINIMO_APROXIMADA_MS = 5 * 60_000;
/** Valor inicial para el piloto, pendiente de decisión de Javier: válvula de aplicaciones por hora. */
export const MAXIMO_APLICACIONES_POR_HORA = 30;
/** Ventana deslizante del tope anterior. */
export const VENTANA_TOPE_MS = 60 * 60_000;
/** Valor inicial para el piloto, pendiente de decisión de Javier: la cookie solo se reescribe con este desplazamiento... */
export const DESPLAZAMIENTO_MINIMO_COOKIE_M = 1_000;
/** ...o con esta fracción del radio, si es mayor. Valor inicial para el piloto, pendiente de decisión de Javier. */
export const FRACCION_RADIO_COOKIE = 0.1;
/** Valor inicial para el piloto, pendiente de decisión de Javier: una lectura más vieja que esto ya no describe dónde está la persona. */
export const EDAD_MAXIMA_LECTURA_MS = 2 * 60_000;
/** Margen para relojes que no coinciden del todo entre la lectura y `ahora`. */
export const TOLERANCIA_RELOJ_MS = 5_000;

export interface Punto { readonly lat: number; readonly lng: number }
export interface LecturaUbicacion extends Punto {
  /** Radio de error en metros, como Position.coords.accuracy. */
  readonly accuracy: number;
  /** Instante de la lectura (ms desde epoch), como Position.timestamp. */
  readonly timestamp: number;
}

export interface EstadoEnVivo {
  /** El último punto que se aplicó y cuándo (reloj de `ahora`). Solo en memoria. */
  readonly ultimoAplicado: (Punto & { readonly en: number }) | null;
  /** Instantes de las aplicaciones dentro de la ventana del tope. */
  readonly aplicaciones: readonly number[];
  /** El punto de la cookie de zona, a 3 decimales. Sin cookie, el modo no la crea. */
  readonly ultimaCookie: Punto | null;
  /** Timestamp de la última lectura aceptada como válida, para descartar las fuera de orden. */
  readonly ultimaLectura: number | null;
}

export interface ContextoLectura {
  /** Reloj del llamador (ms desde epoch). */
  readonly ahora: number;
  /** La que da lib/geo/permiso-ubicacion.ts. «desconocida» sigue las reglas de «precisa»: el filtro de precisión la protege. */
  readonly precision: "precisa" | "aproximada" | "desconocida";
  /** Radio vigente de la zona, en metros. */
  readonly radioMetros: number;
  /** La lectura es la de volver a la app: no espera el intervalo, pero SÍ exige el umbral. */
  readonly alVolver?: boolean;
}

export type MotivoDecision =
  | "entrada-invalida"
  | "lectura-vieja"
  | "precision-insuficiente"
  | "fuera-de-area"
  | "tope-por-hora"
  | "muy-pronto"
  | "sin-movimiento"
  | "primera-lectura"
  | "movimiento";

export interface DecisionEnVivo {
  readonly aplicar: boolean;
  readonly escribirCookie: boolean;
  readonly motivo: MotivoDecision;
  readonly estadoNuevo: EstadoEnVivo;
}

/** El estado al activar el modo: sin nada aplicado y con el punto de la cookie, si hay. */
export function estadoEnVivoInicial(ultimaCookie: Punto | null): EstadoEnVivo {
  return {
    ultimoAplicado: null,
    aplicaciones: [],
    ultimaCookie: ultimaCookie && esPunto(ultimaCookie) ? { lat: ultimaCookie.lat, lng: ultimaCookie.lng } : null,
    ultimaLectura: null,
  };
}

function esNumero(valor: unknown): valor is number {
  return typeof valor === "number" && Number.isFinite(valor);
}

function esPunto(valor: Partial<Punto> | null | undefined): valor is Punto {
  return !!valor && esNumero(valor.lat) && esNumero(valor.lng) && Math.abs(valor.lat) <= 90 && Math.abs(valor.lng) <= 180;
}

function lecturaValida(lectura: LecturaUbicacion | null | undefined): lectura is LecturaUbicacion {
  return !!lectura && esPunto(lectura) && esNumero(lectura.accuracy) && lectura.accuracy >= 0
    && esNumero(lectura.timestamp) && lectura.timestamp >= 0;
}

function contextoValido(contexto: ContextoLectura | null | undefined): contexto is ContextoLectura {
  return !!contexto && esNumero(contexto.ahora) && contexto.ahora >= 0
    && (contexto.precision === "precisa" || contexto.precision === "aproximada" || contexto.precision === "desconocida")
    && esNumero(contexto.radioMetros) && contexto.radioMetros >= RADIUS_MIN_METERS && contexto.radioMetros <= RADIUS_MAX_METERS;
}

/** Un estado que llega roto (de otra versión, o mal construido) se trata como vacío en lo que esté roto. */
function sanear(estado: EstadoEnVivo | null | undefined): EstadoEnVivo {
  if (!estado) return estadoEnVivoInicial(null);
  const anterior = estado.ultimoAplicado;
  const aplicaciones: readonly unknown[] = Array.isArray(estado.aplicaciones) ? estado.aplicaciones : [];
  return {
    ultimoAplicado: anterior && esPunto(anterior) && esNumero(anterior.en) ? anterior : null,
    aplicaciones: aplicaciones.filter(esNumero),
    ultimaCookie: esPunto(estado.ultimaCookie) ? estado.ultimaCookie : null,
    ultimaLectura: esNumero(estado.ultimaLectura) ? estado.ultimaLectura : null,
  };
}

function distanciaMetros(a: Punto, b: Punto): number {
  return calculateDistanceKm(a.lat, a.lng, b.lat, b.lng) * 1000;
}

/**
 * La cookie se escribe (y el inicio entero se refresca) solo con un
 * desplazamiento ≥ max(1 km, 10 % del radio) o al volver a la app. Al volver
 * también hay umbral: escribirla por ruido en el borde de una celda refrescaría
 * el inicio con la persona quieta. Sin cookie previa nunca: el modo en vivo
 * sigue una zona, no la crea.
 */
function debeEscribirCookie(lectura: Punto, ultimaCookie: Punto | null, contexto: ContextoLectura, umbralMovimiento: number): boolean {
  if (!ultimaCookie || mismoPunto(lectura, ultimaCookie)) return false;
  const desplazamiento = distanciaMetros(ultimaCookie, lectura);
  if (contexto.alVolver) return desplazamiento >= umbralMovimiento;
  return desplazamiento >= Math.max(DESPLAZAMIENTO_MINIMO_COOKIE_M, FRACCION_RADIO_COOKIE * contexto.radioMetros);
}

/** Decide qué hacer con una lectura. No tiene efectos: el llamador aplica (o no) la decisión. */
export function decidirLectura(
  lectura: LecturaUbicacion,
  estadoAnterior: EstadoEnVivo,
  contexto: ContextoLectura,
): DecisionEnVivo {
  if (!lecturaValida(lectura) || !contextoValido(contexto) || lectura.timestamp > contexto.ahora + TOLERANCIA_RELOJ_MS) {
    return { aplicar: false, escribirCookie: false, motivo: "entrada-invalida", estadoNuevo: estadoAnterior };
  }
  const estado = sanear(estadoAnterior);
  const { ahora } = contexto;
  if ((estado.ultimaLectura !== null && lectura.timestamp <= estado.ultimaLectura) || ahora - lectura.timestamp > EDAD_MAXIMA_LECTURA_MS) {
    return { aplicar: false, escribirCookie: false, motivo: "lectura-vieja", estadoNuevo: estado };
  }

  const aplicaciones = estado.aplicaciones.filter((instante) => instante <= ahora && ahora - instante < VENTANA_TOPE_MS);
  const vigente: EstadoEnVivo = { ...estado, aplicaciones, ultimaLectura: lectura.timestamp };
  const rechazar = (motivo: MotivoDecision): DecisionEnVivo => ({ aplicar: false, escribirCookie: false, motivo, estadoNuevo: vigente });

  const aproximada = contexto.precision === "aproximada";
  if (lectura.accuracy > (aproximada ? PRECISION_MAXIMA_APROXIMADA_M : PRECISION_MAXIMA_M)) return rechazar("precision-insuficiente");
  // Fuera del área del mapa no se aplica ni se escribe nunca: el servidor la
  // trataría como «sin ubicación» (lib/geo/zona-guardada.ts).
  if (!dentroDeMapArea(lectura)) return rechazar("fuera-de-area");
  if (aplicaciones.length >= MAXIMO_APLICACIONES_POR_HORA) return rechazar("tope-por-hora");

  const umbral = Math.max(aproximada ? DISTANCIA_MINIMA_APROXIMADA_M : DISTANCIA_MINIMA_M, FACTOR_PRECISION * lectura.accuracy);
  // Sin nada aplicado todavía, la primera lectura se compara con la cookie.
  const referencia = estado.ultimoAplicado ?? estado.ultimaCookie;
  if (estado.ultimoAplicado && !contexto.alVolver) {
    const intervalo = aproximada ? INTERVALO_MINIMO_APROXIMADA_MS : INTERVALO_MINIMO_MS;
    if (ahora - estado.ultimoAplicado.en < intervalo) return rechazar("muy-pronto");
  }
  if (referencia && distanciaMetros(referencia, lectura) < umbral) return rechazar("sin-movimiento");

  const escribirCookie = debeEscribirCookie(lectura, estado.ultimaCookie, contexto, umbral);
  return {
    aplicar: true,
    escribirCookie,
    motivo: referencia ? "movimiento" : "primera-lectura",
    estadoNuevo: {
      ultimoAplicado: { lat: lectura.lat, lng: lectura.lng, en: ahora },
      aplicaciones: [...aplicaciones, ahora],
      // Lo mismo que escribirá writeLocation: 3 decimales.
      ultimaCookie: escribirCookie ? { lat: redondearCoordenada(lectura.lat), lng: redondearCoordenada(lectura.lng) } : estado.ultimaCookie,
      ultimaLectura: lectura.timestamp,
    },
  };
}
