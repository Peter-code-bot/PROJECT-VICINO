// Traza de vista (apps/web/tests/helpers/view-trace.ts) sin navegador: la fuente
// corre en un contexto vm con un DOM falso mínimo, reloj y frames manuales.
// Cubre ciclo de vida, anillo, privacidad, rutas, foco, transform y sonda de blanco.
// node --import tsx --test scripts/test-view-trace.ts
import assert from "node:assert/strict";
import { test } from "node:test";
import vm from "node:vm";
import {
  FUENTE_TRAZA_VISTA,
  comoElementoEnfocado,
  type ApiTrazaVista,
  type DescriptorFoco,
  type EventoTraza,
  type VolcadoTraza,
} from "../apps/web/tests/helpers/view-trace";
import { abreTeclado } from "../apps/web/lib/onboarding/abre-teclado";
import { PASOS_ONBOARDING } from "../apps/web/lib/onboarding/steps";
import { TAB_ROUTES } from "../apps/web/lib/navigation/tab-routes";

type Opciones = boolean | { capture?: boolean; passive?: boolean } | undefined;
type EventoFalso = Record<string, unknown> & { type: string };
type Manejador = (evento: EventoFalso) => void;
interface Escucha { tipo: string; manejador: Manejador; captura: boolean; pasiva: boolean }

const enCaptura = (opciones: Opciones) => (typeof opciones === "boolean" ? opciones : opciones?.capture === true);

class Emisor {
  escuchas: Escucha[] = [];
  addEventListener(tipo: string, manejador: Manejador, opciones?: Opciones) {
    const pasiva = typeof opciones === "object" && opciones?.passive === true;
    this.escuchas = [...this.escuchas, { tipo, manejador, captura: enCaptura(opciones), pasiva }];
  }
  removeEventListener(tipo: string, manejador: Manejador, opciones?: Opciones) {
    this.escuchas = this.escuchas.filter((e) => !(e.tipo === tipo && e.manejador === manejador && e.captura === enCaptura(opciones)));
  }
  /** Despacha a los listeners del tipo; `fase` limita a captura o burbuja. */
  emitir(tipo: string, datos: Record<string, unknown> = {}, fase?: "captura" | "burbuja"): EventoFalso {
    const evento: EventoFalso = { type: tipo, ...datos };
    for (const escucha of this.escuchas) {
      if (escucha.tipo !== tipo) continue;
      if (fase === "captura" && !escucha.captura) continue;
      if (fase === "burbuja" && escucha.captura) continue;
      escucha.manejador(evento);
    }
    return evento;
  }
}

interface DatosElemento {
  atributos?: Record<string, string>;
  type?: string;
  readOnly?: boolean;
  disabled?: boolean;
  inputMode?: string;
  isContentEditable?: boolean;
  estilo?: { transform?: string; position?: string };
  caja?: { top: number; bottom: number };
}

class ElementoFalso {
  readonly nodeType = 1;
  // Datos que la traza nunca debe copiar.
  readonly id = "id-privado";
  readonly className = "clase-privada";
  readonly textContent = "Texto privado sintetico";
  readonly value = "valor-privado";
  readonly placeholder = "pista-privada";
  readonly style = { getPropertyValue: () => "" };
  estilo: { transform?: string; position?: string };
  constructor(readonly localName: string, readonly parentElement: ElementoFalso | null = null, private readonly datos: DatosElemento = {}) {
    this.estilo = datos.estilo ?? {};
  }
  get type() { return this.datos.type; }
  get readOnly() { return this.datos.readOnly; }
  get inputMode() { return this.datos.inputMode ?? ""; }
  get isContentEditable() { return this.datos.isContentEditable === true; }
  get classList() { return { contains: (clase: string) => (this.datos.atributos?.class ?? "").split(" ").includes(clase) }; }
  getAttribute(nombre: string) { return this.datos.atributos?.[nombre] ?? null; }
  matches(selector: string): boolean {
    if (selector === ":disabled") return this.datos.disabled === true;
    const atributo = /^\[([a-z-]+)\]$/.exec(selector);
    if (atributo) return atributo[1]! in (this.datos.atributos ?? {});
    return selector === this.localName;
  }
  closest(selector: string): ElementoFalso | null {
    if (this.matches(selector)) return this;
    return this.parentElement ? this.parentElement.closest(selector) : null;
  }
  getBoundingClientRect() {
    const { top, bottom } = this.datos.caja ?? { top: 0, bottom: 0 };
    return { top, bottom, left: 0, right: 100, width: 100, height: bottom - top };
  }
}

interface Temporizador { fn: () => void; vence: number; cada: number | null }

function crearEntorno({ superior = true }: { superior?: boolean } = {}) {
  let reloj = 1000;
  let siguienteId = 1;
  const cuadros = new Map<number, () => void>();
  const temporizadores = new Map<number, Temporizador>();
  const html = new ElementoFalso("html", null, { atributos: { class: "" } });
  const body = new ElementoFalso("body", html);
  const contenido = new ElementoFalso("main", body);
  const medios: Array<Emisor & { matches: boolean }> = [];
  const observadores: Array<{ observado: unknown; desconectado: boolean }> = [];
  const puntosSondeados: Array<[number, number]> = [];
  let alPunto: (x: number, y: number) => ElementoFalso | null = () => contenido;
  let scroller: ElementoFalso | null = null;

  const documento = Object.assign(new Emisor(), {
    documentElement: html,
    body,
    scrollingElement: { scrollHeight: 844, clientHeight: 844 },
    visibilityState: "visible",
    querySelector: (selector: string) => (selector === "[data-onboarding-scroll]" ? scroller : null),
    elementFromPoint: (x: number, y: number) => { puntosSondeados.push([x, y]); return alPunto(x, y); },
  });
  const viewport = Object.assign(new Emisor(), { width: 390, height: 844, offsetTop: 0, offsetLeft: 0, scale: 1 });
  class ObservadorFalso {
    readonly registro = { observado: null as unknown, desconectado: false };
    constructor(readonly avisar: (lista: { getEntries(): unknown[] }) => void) { observadores.push(this.registro); }
    observe(opciones: unknown) { this.registro.observado = opciones; }
    disconnect() { this.registro.desconectado = true; }
  }
  const programar = (fn: () => void, ms: number, cada: number | null) => {
    const id = siguienteId++;
    temporizadores.set(id, { fn, vence: reloj + Math.max(0, ms), cada });
    return id;
  };
  const ventana = Object.assign(new Emisor(), {
    document: documento,
    visualViewport: viewport,
    innerWidth: 390,
    innerHeight: 844,
    scrollY: 0,
    location: { pathname: "/" },
    performance: { now: () => reloj },
    requestAnimationFrame: (fn: () => void) => { const id = siguienteId++; cuadros.set(id, fn); return id; },
    cancelAnimationFrame: (id: number) => { cuadros.delete(id); },
    setTimeout: (fn: () => void, ms = 0) => programar(fn, ms, null),
    clearTimeout: (id: number) => { temporizadores.delete(id); },
    setInterval: (fn: () => void, ms: number) => programar(fn, ms, Math.max(1, ms)),
    clearInterval: (id: number) => { temporizadores.delete(id); },
    getComputedStyle: (el: ElementoFalso) => ({ transform: el.estilo.transform ?? "none", position: el.estilo.position ?? "static" }),
    matchMedia: (consulta: string) => {
      const lista = Object.assign(new Emisor(), { matches: false, media: consulta });
      medios.push(lista);
      return lista;
    },
    PerformanceObserver: ObservadorFalso,
  });
  Object.assign(ventana, { window: ventana, top: superior ? ventana : {} });
  vm.createContext(ventana);
  vm.runInContext(FUENTE_TRAZA_VISTA, ventana, { filename: "view-trace.js" });
  const traza = (ventana as unknown as { __vicinoViewTrace: ApiTrazaVista }).__vicinoViewTrace;

  return {
    traza, ventana, documento, viewport, html, body, contenido, medios, observadores, cuadros, temporizadores, puntosSondeados,
    fijarScroller(elemento: ElementoFalso | null) { scroller = elemento; },
    fijarPunto(fn: (x: number, y: number) => ElementoFalso | null) { alPunto = fn; },
    escuchas: () => [...ventana.escuchas, ...documento.escuchas, ...viewport.escuchas],
    correrCuadro() {
      const pendientes = [...cuadros.values()];
      cuadros.clear();
      for (const fn of pendientes) fn();
    },
    avanzar(ms: number) {
      const meta = reloj + ms;
      for (;;) {
        const proximo = [...temporizadores.entries()].filter(([, t]) => t.vence <= meta).sort((a, b) => a[1].vence - b[1].vence)[0];
        if (!proximo) break;
        const [id, temporizador] = proximo;
        reloj = Math.max(reloj, temporizador.vence);
        if (temporizador.cada === null) temporizadores.delete(id);
        else temporizadores.set(id, { ...temporizador, vence: temporizador.vence + temporizador.cada });
        temporizador.fn();
      }
      reloj = meta;
    },
    volcado: (): VolcadoTraza => JSON.parse(traza.dump()) as VolcadoTraza,
  };
}

const delTipo = (volcado: VolcadoTraza, tipo: string): EventoTraza[] => volcado.eventos.filter((evento) => evento.tipo === tipo);
const toque = (x: number, y: number) => [{ clientX: x, clientY: y }];

test("antes de start() no hay listeners, observers, media queries, temporizadores ni frames", () => {
  const entorno = crearEntorno();
  assert.equal(entorno.escuchas().length, 0);
  assert.equal(entorno.cuadros.size, 0);
  assert.equal(entorno.temporizadores.size, 0);
  assert.equal(entorno.observadores.length, 0);
  assert.equal(entorno.medios.length, 0);
  assert.equal(entorno.traza.mark("sync"), false, "apagada no registra marcas");
  const volcado = entorno.volcado();
  assert.equal(volcado.activa, false);
  assert.equal(volcado.epoch, null);
  assert.deepEqual(volcado.eventos, []);
});

test("start() solo actúa en el frame superior", () => {
  const entorno = crearEntorno({ superior: false });
  assert.equal(entorno.traza.start(), false);
  assert.equal(entorno.escuchas().length, 0);
  assert.equal(entorno.cuadros.size, 0);
});

test("start() es idempotente; todo listener es pasivo y en captura salvo el clic de burbuja", () => {
  const entorno = crearEntorno();
  assert.equal(entorno.traza.start(), true);
  const escuchas = entorno.escuchas();
  assert.ok(escuchas.length > 0);
  assert.equal(entorno.traza.start(), true);
  assert.equal(entorno.escuchas().length, escuchas.length, "un segundo start no duplica listeners");
  assert.equal(entorno.cuadros.size, 1, "un solo bucle de frames");
  assert.ok(escuchas.every((escucha) => escucha.pasiva), "todos pasivos");
  assert.deepEqual(escuchas.filter((escucha) => !escucha.captura).map((escucha) => escucha.tipo), ["click"]);
  assert.equal(entorno.observadores.length, 1);
  assert.equal(typeof entorno.volcado().epoch, "number");
});

test("stop() retira listeners, frames, intervalos, media queries y el observer", () => {
  const entorno = crearEntorno();
  entorno.traza.start();
  entorno.ventana.emitir("touchstart", { target: entorno.contenido, touches: toque(100, 100), changedTouches: toque(100, 100), cancelable: true });
  entorno.ventana.emitir("touchend", { target: entorno.contenido, touches: [], changedTouches: toque(100, 100), cancelable: true });
  assert.ok(entorno.temporizadores.size > 0, "la sonda tras el toque quedó programada");
  entorno.traza.stop();
  assert.equal(entorno.escuchas().length, 0);
  assert.equal(entorno.cuadros.size, 0);
  assert.equal([...entorno.temporizadores.values()].filter((t) => t.cada !== null).length, 0, "sin intervalos vivos");
  assert.ok(entorno.medios.every((lista) => lista.escuchas.length === 0), "sin listeners de media queries");
  assert.ok(entorno.observadores.every((observador) => observador.desconectado));
  const antes = entorno.volcado().eventos.length;
  entorno.avanzar(2000);
  entorno.traza.clear();
  entorno.ventana.emitir("touchstart", { target: entorno.contenido, touches: toque(1, 1) });
  entorno.avanzar(10);
  assert.ok(antes > 0);
  assert.equal(entorno.volcado().eventos.length, 0, "apagada no registra nada");
});

test("el anillo guarda 3000 eventos y descarta los más viejos", () => {
  const entorno = crearEntorno();
  entorno.traza.start();
  for (let i = 0; i < 3100; i++) assert.equal(entorno.traza.mark(`m${i}`), true);
  const volcado = entorno.volcado();
  assert.equal(volcado.eventos.length, 3000);
  assert.equal(volcado.total, 3101, "inicio y 3100 marcas");
  assert.equal(volcado.descartados, 101);
  assert.equal(volcado.eventos[0]!.nombre, "m100");
  assert.equal(volcado.eventos.at(-1)!.nombre, "m3099");
  assert.ok(volcado.eventos.every((evento) => Number.isInteger(evento.t)));
});

test("mark() solo acepta nombres cortos sin espacios", () => {
  const entorno = crearEntorno();
  entorno.traza.start();
  assert.equal(entorno.traza.mark("sync"), true);
  assert.equal(entorno.traza.mark("con espacios"), false);
  assert.equal(entorno.traza.mark("x".repeat(33)), false);
  assert.equal(entorno.traza.mark(123 as unknown as string), false);
  assert.deepEqual(delTipo(entorno.volcado(), "mark").map((evento) => evento.nombre), ["sync"]);
});

test("la ruta se guarda como categoría de una lista cerrada, sin segmentos dinámicos", () => {
  const entorno = crearEntorno();
  entorno.traza.start();
  const casos: Array<[string, string]> = [
    ...TAB_ROUTES.map((ruta): [string, string] => [ruta, ruta]),
    ...PASOS_ONBOARDING.map((paso): [string, string] => [`/completar-perfil/${paso}`, `onboarding:${paso}`]),
    ["/bienvenida", "onboarding:bienvenida"],
    ["/perfil/", "/perfil"],
    ["/vendedor/0b5c2a91", "[dinamica]"],
    ["/chat", "/chat"],
    ["/completar-perfil/otro-paso", "[dinamica]"],
  ];
  for (const [ruta, categoria] of casos) {
    entorno.ventana.location.pathname = ruta;
    entorno.correrCuadro();
    assert.equal(delTipo(entorno.volcado(), "ruta").at(-1)?.categoria, categoria, ruta);
  }
  const json = entorno.traza.dump();
  assert.equal(json.includes("0b5c2a91"), false);
  assert.equal(json.includes("otro-paso"), false);
});

test("toques y clics no guardan id, clases, textos, valores, aria, name ni href", () => {
  const entorno = crearEntorno();
  const enlace = new ElementoFalso("a", entorno.contenido, {
    atributos: { href: "/vendedor/privado?correo=marca#seccion", "aria-label": "Aria sintetica", name: "nombre-privado", role: "Botón con espacios" },
  });
  entorno.traza.start();
  entorno.ventana.emitir("touchstart", { target: enlace, touches: toque(100.4, 200.6), changedTouches: toque(100.4, 200.6), cancelable: true });
  entorno.ventana.emitir("touchend", { target: enlace, touches: [], changedTouches: toque(100.4, 200.6), cancelable: true });
  entorno.ventana.emitir("click", { target: enlace, detail: 1 });
  entorno.avanzar(0);
  const json = entorno.traza.dump();
  for (const privado of ["id-privado", "clase-privada", "Texto privado", "valor-privado", "pista-privada", "sintetic", "nombre-privado", "privado", "correo", "marca", "seccion", "?", "#"]) {
    assert.equal(json.includes(privado), false, privado);
  }
  const inicio = delTipo(entorno.volcado(), "touchstart")[0]!;
  assert.deepEqual([inicio.x, inicio.y, inicio.toques, inicio.cancelable, inicio.defaultPrevented], [100, 201, 1, true, false]);
  assert.deepEqual(inicio.objetivo, { tag: "a", type: null, role: "otro", noPageSwipe: false, enOnboardingScroll: false });
  const clic = delTipo(entorno.volcado(), "clic")[0]!;
  assert.deepEqual([clic.propagado, clic.cancelado, clic.detail], [true, false, 1]);
});

test("defaultPrevented y la cancelación del clic se leen cuando terminó el despacho", () => {
  const entorno = crearEntorno();
  entorno.traza.start();
  const movimiento = entorno.ventana.emitir("touchmove", { target: entorno.contenido, touches: toque(80, 100), cancelable: true });
  movimiento.defaultPrevented = true; // el detector de la app lo previene después de la captura
  const clic = entorno.ventana.emitir("click", { target: entorno.contenido, detail: 1 }, "captura");
  clic.defaultPrevented = true; // suprimido: nunca vuelve a window en burbuja
  entorno.avanzar(0);
  const volcado = entorno.volcado();
  assert.equal(delTipo(volcado, "touchmove")[0]!.defaultPrevented, true);
  assert.equal(delTipo(volcado, "touchmove")[0]!.objetivo, undefined, "touchmove no repite el objetivo");
  assert.deepEqual([delTipo(volcado, "clic")[0]!.propagado, delTipo(volcado, "clic")[0]!.cancelado], [false, true]);
});

test("focusin guarda lo que abreTeclado necesita; un radio sr-only queda fuera de los bounds", () => {
  const entorno = crearEntorno();
  const scroller = new ElementoFalso("div", entorno.contenido, { atributos: { "data-onboarding-scroll": "" }, caja: { top: 64, bottom: 480 } });
  const campo = new ElementoFalso("input", scroller, { type: "text", caja: { top: 100, bottom: 148 } });
  const radio = new ElementoFalso("input", scroller, { type: "radio", estilo: { position: "absolute" }, caja: { top: 2470, bottom: 2471 } });
  const bloqueado = new ElementoFalso("textarea", scroller, { type: "textarea", disabled: true, caja: { top: 150, bottom: 250 } });
  entorno.traza.start();
  for (const objetivo of [campo, radio, bloqueado]) entorno.ventana.emitir("focusin", { target: objetivo });
  const focos = delTipo(entorno.volcado(), "focusin").map((evento) => evento.objetivo as DescriptorFoco);
  assert.deepEqual(focos.map((foco) => abreTeclado(comoElementoEnfocado(foco))), [true, false, false]);
  assert.deepEqual(focos.map((foco) => foco.dentroDeBounds), [true, false, true]);
  assert.deepEqual(focos.map((foco) => foco.position), ["static", "absolute", "static"]);
  assert.ok(focos.every((foco) => foco.enOnboardingScroll));
});

test("la copia de abreTeclado que guarda la traza coincide con la regla de lib en cada caso", () => {
  const entorno = crearEntorno();
  const tiposDeInput = ["text", "TEXT", "", "email", "number", "search", "tel", "url", "password", "radio", "checkbox", "button",
    "submit", "reset", "image", "range", "color", "file", "hidden", "date", "time", "datetime-local", "month", "week"];
  const casos: Array<[string, DatosElemento]> = [
    ...tiposDeInput.map((type): [string, DatosElemento] => ["input", { type }]),
    ["input", {}],
    ["input", { type: "text", readOnly: true }],
    ["input", { type: "text", disabled: true }],
    ["input", { type: "text", inputMode: "none" }],
    ["input", { type: "text", inputMode: "NONE" }],
    ["input", { type: "text", inputMode: "numeric" }],
    ["textarea", { type: "textarea" }],
    ["textarea", { type: "textarea", readOnly: true }],
    ["textarea", { type: "textarea", disabled: true }],
    ["textarea", { type: "textarea", inputMode: "none" }],
    ["div", { isContentEditable: true }],
    ["div", { isContentEditable: true, inputMode: "none" }],
    ["div", {}],
    ["select", { type: "select-one" }],
    ["button", { type: "submit" }],
    ["h1", {}],
  ];
  entorno.traza.start();
  for (const [tag, datos] of casos) entorno.ventana.emitir("focusin", { target: new ElementoFalso(tag, entorno.contenido, datos) });
  const focos = delTipo(entorno.volcado(), "focusin").map((evento) => evento.objetivo as DescriptorFoco);
  assert.equal(focos.length, casos.length);
  focos.forEach((foco, indice) => {
    assert.equal(foco.abreTeclado, abreTeclado(comoElementoEnfocado(foco)), JSON.stringify(casos[indice]));
  });
  assert.ok(focos.some((foco) => foco.abreTeclado) && focos.some((foco) => !foco.abreTeclado), "hay casos de los dos lados");
});

test("el transform de los ancestros se muestrea durante el toque y 500 ms después", () => {
  const entorno = crearEntorno();
  const envoltorio = new ElementoFalso("div", entorno.contenido);
  const superficie = new ElementoFalso("div", envoltorio);
  entorno.traza.start();
  entorno.ventana.emitir("touchstart", { target: superficie, touches: toque(200, 300), changedTouches: toque(200, 300), cancelable: true });
  envoltorio.estilo.transform = "matrix(1, 0, 0, 1, -2.4, 0)";
  entorno.correrCuadro();
  entorno.ventana.emitir("touchend", { target: superficie, touches: [], changedTouches: toque(188, 300), cancelable: true });
  envoltorio.estilo.transform = "matrix(1, 0, 0, 1, -1.2, 0)";
  entorno.correrCuadro();
  entorno.avanzar(300);
  entorno.correrCuadro();
  assert.equal(delTipo(entorno.volcado(), "transform").length, 0, "la ventana de 500 ms sigue abierta");
  // translateY de una animación de entrada (matrix3d), también dentro de la ventana.
  entorno.contenido.estilo.transform = "matrix3d(1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 20, 0, 1)";
  entorno.correrCuadro();
  entorno.avanzar(250);
  entorno.correrCuadro();
  const [transform] = delTipo(entorno.volcado(), "transform");
  assert.ok(transform, "se emitió al cerrar la ventana");
  assert.deepEqual(transform.ancestros, [
    { profundidad: 1, tag: "div", maxTx: 2.4, maxTy: 0 },
    { profundidad: 2, tag: "main", maxTx: 0, maxTy: 20 },
  ]);
  assert.ok((transform.muestras as number) >= 4);
});

test("la sonda de blanco usa el viewport visual y registra blank si cae en html o body", () => {
  const entorno = crearEntorno();
  Object.assign(entorno.viewport, { offsetTop: 100, height: 500 });
  // La franja inferior (y > 560 en coordenadas de la página) es fondo del body.
  entorno.fijarPunto((_x, y) => (y > 560 ? entorno.body : entorno.contenido));
  entorno.traza.start();
  entorno.correrCuadro(); // primera ruta: una sonda
  entorno.viewport.emitir("resize");
  entorno.correrCuadro();
  const blancos = delTipo(entorno.volcado(), "blank");
  assert.ok(blancos.length >= 1);
  const ultimo = blancos.at(-1)!;
  assert.deepEqual((ultimo.puntos as Array<{ k: unknown }>).map((punto) => punto.k), [4, 4, 4, 24]);
  assert.equal(ultimo.altoEstimado, 44);
  assert.equal(ultimo.vvOffsetTop, 100);
  assert.ok(entorno.puntosSondeados.every(([, y]) => y >= 100 && y <= 600), "todas las sondas dentro del viewport visual");
});

test("tras el toque la sonda corre cada 100 ms durante 1 s", () => {
  const entorno = crearEntorno();
  entorno.traza.start();
  entorno.ventana.emitir("touchend", { target: entorno.contenido, touches: [], changedTouches: toque(10, 10), cancelable: true });
  const antes = entorno.volcado().sondas;
  entorno.avanzar(1500);
  const sondas = entorno.volcado().sondas - antes;
  assert.ok(sondas >= 9 && sondas <= 11, `sondas tras el toque: ${sondas}`);
  assert.equal([...entorno.temporizadores.values()].filter((t) => t.cada !== null).length, 0, "el intervalo se apaga solo");
});
