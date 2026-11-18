import assert from "node:assert/strict";
import test from "node:test";
import {
  DESPLAZAMIENTO_MINIMO_COOKIE_M,
  INTERVALO_MINIMO_APROXIMADA_MS,
  INTERVALO_MINIMO_MS,
  MAXIMO_APLICACIONES_POR_HORA,
  VENTANA_TOPE_MS,
  decidirLectura,
  estadoEnVivoInicial,
  type ContextoLectura,
  type EstadoEnVivo,
  type LecturaUbicacion,
} from "./ubicacion-en-vivo";

// Centro generico de una ciudad (no es la ubicacion de nadie).
const CENTRO = { lat: 19.041, lng: -98.206 };
const T0 = Date.UTC(2026, 10, 7, 18, 0, 0);
/** Metros por grado de latitud con el mismo radio terrestre que calculateDistanceKm. */
const M_POR_GRADO = (6371000 * Math.PI) / 180;

const alNorte = (metros: number, desde = CENTRO) => ({ lat: desde.lat + metros / M_POR_GRADO, lng: desde.lng });
const lectura = (punto: { lat: number; lng: number }, timestamp: number, accuracy = 20): LecturaUbicacion => ({ ...punto, accuracy, timestamp });
const contexto = (ahora: number, extra: Partial<ContextoLectura> = {}): ContextoLectura => ({ ahora, precision: "precisa", radioMetros: 10000, ...extra });

/** Congela en profundidad para comprobar que nada se muta. */
function congelar<T>(valor: T): T {
  if (valor && typeof valor === "object") {
    Object.values(valor).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}

test("sin nada aplicado ni cookie: la primera lectura se aplica, pero no crea una zona", () => {
  const decision = decidirLectura(lectura(CENTRO, T0), estadoEnVivoInicial(null), contexto(T0));
  assert.equal(decision.aplicar, true);
  assert.equal(decision.motivo, "primera-lectura");
  assert.equal(decision.escribirCookie, false);
  assert.deepEqual(decision.estadoNuevo.ultimoAplicado, { ...CENTRO, en: T0 });
});

test("la primera lectura se compara con la cookie: 100 m es ruido, 400 m es movimiento", () => {
  const inicial = estadoEnVivoInicial(CENTRO);
  assert.equal(decidirLectura(lectura(alNorte(100), T0), inicial, contexto(T0)).motivo, "sin-movimiento");
  const cuatrocientos = decidirLectura(lectura(alNorte(400), T0), inicial, contexto(T0));
  assert.equal(cuatrocientos.aplicar, true);
  assert.equal(cuatrocientos.motivo, "movimiento");
  assert.equal(cuatrocientos.escribirCookie, false, "400 m no llega al km de la cookie");
});

test("se descarta una precisión peor que 500 m (modo preciso)", () => {
  const decision = decidirLectura(lectura(alNorte(3000), T0, 600), estadoEnVivoInicial(CENTRO), contexto(T0));
  assert.equal(decision.motivo, "precision-insuficiente");
  assert.equal(decision.aplicar, false);
});

test("el umbral nunca baja de 2× la precisión", () => {
  const inicial = estadoEnVivoInicial(CENTRO);
  // precisión 250 m → umbral 500 m
  assert.equal(decidirLectura(lectura(alNorte(400), T0, 250), inicial, contexto(T0)).motivo, "sin-movimiento");
  assert.equal(decidirLectura(lectura(alNorte(600), T0, 250), inicial, contexto(T0)).aplicar, true);
});

test("entre dos aplicaciones pasan al menos 60 s, se mueva lo que se mueva", () => {
  const primera = decidirLectura(lectura(alNorte(400), T0), estadoEnVivoInicial(CENTRO), contexto(T0));
  const lejos = alNorte(5000);
  const pronto = decidirLectura(lectura(lejos, T0 + 30_000), primera.estadoNuevo, contexto(T0 + 30_000));
  assert.equal(pronto.motivo, "muy-pronto");
  const despues = decidirLectura(lectura(lejos, T0 + INTERVALO_MINIMO_MS), pronto.estadoNuevo, contexto(T0 + INTERVALO_MINIMO_MS));
  assert.equal(despues.aplicar, true);
  // La distancia se mide contra el último punto APLICADO, no contra la cookie.
  const cerca = decidirLectura(lectura(alNorte(200, lejos), T0 + 3 * INTERVALO_MINIMO_MS), despues.estadoNuevo, contexto(T0 + 3 * INTERVALO_MINIMO_MS));
  assert.equal(cerca.motivo, "sin-movimiento");
});

test("al volver a la app no se espera el intervalo, pero el umbral sigue", () => {
  const primera = decidirLectura(lectura(alNorte(400), T0), estadoEnVivoInicial(CENTRO), contexto(T0));
  const ruido = decidirLectura(lectura(alNorte(450), T0 + 10_000), primera.estadoNuevo, contexto(T0 + 10_000, { alVolver: true }));
  assert.equal(ruido.motivo, "sin-movimiento");
  const movido = decidirLectura(lectura(alNorte(800), T0 + 11_000), ruido.estadoNuevo, contexto(T0 + 11_000, { alVolver: true }));
  assert.equal(movido.aplicar, true);
});

test("con permiso aproximado: precisión de km aceptada, 2 km y 5 min", () => {
  const ctx = (ahora: number) => contexto(ahora, { precision: "aproximada" });
  const inicial = estadoEnVivoInicial(CENTRO);
  assert.equal(decidirLectura(lectura(alNorte(1500), T0, 900), inicial, ctx(T0)).motivo, "sin-movimiento");
  const primera = decidirLectura(lectura(alNorte(2500), T0, 900), inicial, ctx(T0));
  assert.equal(primera.aplicar, true, "una precisión de 900 m no se descarta en modo aproximado");
  const destino = alNorte(6000);
  assert.equal(decidirLectura(lectura(destino, T0 + 4 * 60_000, 900), primera.estadoNuevo, ctx(T0 + 4 * 60_000)).motivo, "muy-pronto");
  assert.equal(decidirLectura(lectura(destino, T0 + INTERVALO_MINIMO_APROXIMADA_MS, 900), primera.estadoNuevo, ctx(T0 + INTERVALO_MINIMO_APROXIMADA_MS)).aplicar, true);
});

test("tope de 30 aplicaciones en una ventana deslizante de una hora", () => {
  let estado: EstadoEnVivo = estadoEnVivoInicial(CENTRO);
  let punto = CENTRO;
  for (let i = 0; i < MAXIMO_APLICACIONES_POR_HORA; i++) {
    punto = alNorte(400, punto);
    const ahora = T0 + i * INTERVALO_MINIMO_MS;
    const decision = decidirLectura(lectura(punto, ahora), estado, contexto(ahora));
    assert.equal(decision.aplicar, true, `aplicacion ${i + 1}`);
    estado = decision.estadoNuevo;
  }
  const ahora = T0 + MAXIMO_APLICACIONES_POR_HORA * INTERVALO_MINIMO_MS;
  const tope = decidirLectura(lectura(alNorte(400, punto), ahora), estado, contexto(ahora));
  assert.equal(tope.motivo, "tope-por-hora");
  // En cuanto la primera sale de la ventana, vuelve a haber cupo.
  const libre = T0 + VENTANA_TOPE_MS;
  assert.equal(decidirLectura(lectura(alNorte(400, punto), libre), tope.estadoNuevo, contexto(libre)).aplicar, true);
});

test("la cookie se reescribe con un desplazamiento ≥ max(1 km, 10 % del radio)", () => {
  const inicial = estadoEnVivoInicial(CENTRO);
  const a12 = alNorte(1200);
  const conRadio10 = decidirLectura(lectura(a12, T0), inicial, contexto(T0, { radioMetros: 10000 }));
  assert.equal(conRadio10.escribirCookie, true);
  assert.deepEqual(conRadio10.estadoNuevo.ultimaCookie, { lat: Number(a12.lat.toFixed(3)), lng: Number(a12.lng.toFixed(3)) });
  const conRadio25 = decidirLectura(lectura(a12, T0), inicial, contexto(T0, { radioMetros: 25000 }));
  assert.equal(conRadio25.aplicar, true);
  assert.equal(conRadio25.escribirCookie, false, "con 25 km hacen falta 2,5 km");
  assert.equal(conRadio25.estadoNuevo.ultimaCookie, inicial.ultimaCookie);
  assert.equal(DESPLAZAMIENTO_MINIMO_COOKIE_M, 1000);
});

test("al volver se escribe la cookie si superó el umbral de movimiento, nunca por ruido de la celda", () => {
  const inicial = estadoEnVivoInicial(CENTRO);
  const movido = decidirLectura(lectura(alNorte(400), T0), inicial, contexto(T0, { alVolver: true }));
  assert.equal(movido.escribirCookie, true);
  const ruido = decidirLectura(lectura(alNorte(60), T0), inicial, contexto(T0, { alVolver: true }));
  assert.equal(ruido.aplicar, false);
  assert.equal(ruido.escribirCookie, false);
});

test("fuera del área del mapa no se aplica ni se escribe la cookie", () => {
  const decision = decidirLectura(lectura({ lat: 40, lng: -120 }, T0), estadoEnVivoInicial(CENTRO), contexto(T0, { alVolver: true }));
  assert.deepEqual([decision.aplicar, decision.escribirCookie, decision.motivo], [false, false, "fuera-de-area"]);
});

test("lecturas viejas, fuera de orden o del futuro se descartan", () => {
  const primera = decidirLectura(lectura(alNorte(400), T0), estadoEnVivoInicial(CENTRO), contexto(T0));
  const ahora = T0 + 5 * INTERVALO_MINIMO_MS;
  assert.equal(decidirLectura(lectura(alNorte(2000), T0 - 1), primera.estadoNuevo, contexto(ahora)).motivo, "lectura-vieja");
  assert.equal(decidirLectura(lectura(alNorte(2000), ahora - 3 * 60_000), primera.estadoNuevo, contexto(ahora)).motivo, "lectura-vieja");
  assert.equal(decidirLectura(lectura(alNorte(2000), ahora + 60_000), primera.estadoNuevo, contexto(ahora)).motivo, "entrada-invalida");
});

test("entradas inválidas no aplican nada y devuelven el mismo estado", () => {
  const estado = estadoEnVivoInicial(CENTRO);
  const invalidas: Array<[LecturaUbicacion, ContextoLectura]> = [
    [lectura({ lat: Number.NaN, lng: -98.2 }, T0), contexto(T0)],
    [lectura({ lat: 95, lng: -98.2 }, T0), contexto(T0)],
    [lectura(CENTRO, T0, -1), contexto(T0)],
    [lectura(CENTRO, T0, Number.POSITIVE_INFINITY), contexto(T0)],
    [lectura(CENTRO, T0), contexto(T0, { radioMetros: 0 })],
    [lectura(CENTRO, T0), contexto(T0, { radioMetros: 60000 })],
    [lectura(CENTRO, T0), contexto(Number.NaN)],
    [lectura(CENTRO, T0), { ...contexto(T0), precision: "otra" as ContextoLectura["precision"] }],
  ];
  for (const [l, c] of invalidas) {
    const decision = decidirLectura(l, estado, c);
    assert.equal(decision.motivo, "entrada-invalida", JSON.stringify([l, c]));
    assert.equal(decision.aplicar, false);
    assert.equal(decision.estadoNuevo, estado);
  }
});

test("es pura: no muta el estado ni la lectura que recibe", () => {
  const estado = congelar(estadoEnVivoInicial(CENTRO));
  const entrada = congelar(lectura(alNorte(1500), T0));
  const copia = JSON.stringify(estado);
  const decision = decidirLectura(entrada, estado, congelar(contexto(T0)));
  assert.equal(decision.aplicar, true);
  assert.equal(JSON.stringify(estado), copia);
  assert.notEqual(decision.estadoNuevo, estado);
});

test("un estado roto se trata como vacío en lo que esté roto", () => {
  const roto = { ultimoAplicado: { lat: "x", lng: 1, en: 0 }, aplicaciones: [Number.NaN, "x"], ultimaCookie: null, ultimaLectura: "y" } as unknown as EstadoEnVivo;
  const decision = decidirLectura(lectura(CENTRO, T0), roto, contexto(T0));
  assert.equal(decision.motivo, "primera-lectura");
  assert.deepEqual(decision.estadoNuevo.aplicaciones, [T0]);
});
