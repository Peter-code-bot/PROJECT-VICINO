import assert from "node:assert/strict";
import { createRequire } from "node:module";
import test from "node:test";
import { crearInicializadorSentry } from "./sentry-nativo";
import { sanearBreadcrumb } from "./saneo-ubicacion";

type Modulos = Awaited<ReturnType<Parameters<typeof crearInicializadorSentry>[0]>>;
type OpcionesNativas = Parameters<Modulos[0]["init"]>[0];
type Sobre = [unknown, Array<[{ type: string }, { breadcrumbs?: unknown }]>];

// Centro de Puebla (zona por defecto de la app): coordenada de ciudad, no de una persona.
const LAT = "19.0414";
const LNG = "-98.2063";
const COOKIE_ZONA = "19.041,-98.206";

const requerir = createRequire(import.meta.url);

/**
 * El mismo camino que la app Android: crearInicializadorSentry arma las
 * opciones y @sentry/capacitor se las pasa al SDK React 10.43 por el callback.
 * Aqui el modulo nativo es falso (sin puente ni red) y el SDK React es el real,
 * con un transporte que solo guarda los sobres.
 */
test("la app nativa manda los breadcrumbs sin coordenadas (SDK React 10.43 real)", async (t) => {
  const ventanaPrevia = Object.getOwnPropertyDescriptor(globalThis, "window");
  // plataformaNativa() lee window.Capacitor al iniciar; en Node no existe.
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { Capacitor: { getPlatform: () => "android" } },
  });
  t.after(() => {
    if (ventanaPrevia) Object.defineProperty(globalThis, "window", ventanaPrevia);
    else Reflect.deleteProperty(globalThis, "window");
  });

  const react = requerir("@sentry/react") as Modulos[1];
  const sobres: Sobre[] = [];
  const transporte = () => ({
    send: async (sobre: Sobre) => {
      sobres.push(sobre);
      return { statusCode: 200 };
    },
    flush: async () => true,
  });
  let opcionesVistas: OpcionesNativas | undefined;
  const nativo = {
    init: (opciones: OpcionesNativas, alIniciar: (final: object) => void) => {
      opcionesVistas = opciones;
      alIniciar({
        ...opciones,
        dsn: "https://sintetico@sintetico.invalid/7",
        transport: transporte,
        defaultIntegrations: false,
      });
    },
  } as unknown as Modulos[0];

  const arranque = crearInicializadorSentry(async () => [nativo, react]);
  assert.equal((await arranque.init()).state, "ready");
  try {
    assert.equal(opcionesVistas?.beforeBreadcrumb, sanearBreadcrumb);
    react.addBreadcrumb({ category: "navigation", data: { from: "/", to: `/rankings?lat=${LAT}&lng=${LNG}` } });
    react.addBreadcrumb({
      category: "fetch",
      type: "http",
      data: {
        method: "GET",
        url: `/api/session/home?#vicino_location=${COOKIE_ZONA};vicino_radius=10000`,
        status_code: 200,
      },
    });
    react.captureException(new Error("sintetico"));
    await react.flush(2_000);

    const eventos = sobres.flatMap((sobre) => sobre[1]).filter(([cabecera]) => cabecera.type === "event");
    assert.equal(eventos.length, 1);
    const migas = eventos[0]?.[1].breadcrumbs as Array<{ category: string; data: Record<string, unknown> }>;
    assert.deepEqual(
      migas.map((miga) => [miga.category, miga.data]),
      [
        ["navigation", { from: "/", to: "/rankings" }],
        ["fetch", { method: "GET", url: "/api/session/home#vicino_radius=10000", status_code: 200 }],
      ],
    );
    const todo = JSON.stringify(sobres);
    for (const huella of ["19.04", "98.20"]) assert.ok(!todo.includes(huella), `quedo ${huella}`);
  } finally {
    await react.close(1_000);
  }
});
