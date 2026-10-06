/**
 * Sentry 7522543334 «Error: Rejected» (28 eventos en la semana del 25-sep, el
 * issue de nivel error mas frecuente, abierto desde el 2-jun) y VICINO-WEB-17
 * «AbortError: Failed to register a ServiceWorker» (1-oct, /terminos).
 *
 * Con `register: true`, el sw-entry.js de @ducanh2912/next-pwa hace
 * `window.workbox.register()` SIN .catch, y workbox-window relanza cualquier
 * fallo de navigator.serviceWorker.register: llega a Sentry como
 * onunhandledrejection. El «Rejected» es el stub que el Web Rendering Service
 * de Google (browser GoogleOther) pone en serviceWorker.register; el AbortError,
 * un movil real que no pudo bajar /sw.js. Ninguno es accionable.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buscarElementos, cargarReal } from "../lib/pruebas/cargar-real";

test("next.config: next-pwa no registra el service worker por su cuenta (sin .catch)", async () => {
  let opciones: Record<string, unknown> | undefined;
  await cargarReal("next.config.ts", {
    stubs: {
      "@ducanh2912/next-pwa": {
        default: (o: Record<string, unknown>) => {
          opciones = o;
          return (config: unknown) => config;
        },
      },
      "@sentry/nextjs": { withSentryConfig: (config: unknown) => config },
      "@next/bundle-analyzer": { default: () => (config: unknown) => config },
    },
  });
  assert.equal(opciones?.register, false);
});

test("el layout raiz monta el registro (cubre tambien /terminos y las rutas de auth)", async () => {
  const Registro = () => null;
  const layout = await cargarReal<{ default: (p: { children: unknown }) => unknown }>("app/layout.tsx", {
    stubs: {
      "next/font/google": { Inter: () => ({ variable: "i" }), Outfit: () => ({ variable: "o" }) },
      "@/components/registro-service-worker": { RegistroServiceWorker: Registro },
    },
    aislarEntrada: { reales: ["react"] },
  });
  assert.equal(buscarElementos(layout.default({ children: null }), Registro).length, 1);
});

type Componente = { RegistroServiceWorker: () => null };

/** Monta el componente real con useEffect ejecutado en el acto. */
async function montar(ventana: object) {
  const modulo = await cargarReal<Componente>("components/registro-service-worker.tsx", {
    stubs: { react: { useEffect: (efecto: () => void) => efecto() } },
    globales: { window: ventana },
  });
  modulo.RegistroServiceWorker();
}

/**
 * Lo que llegaria a onunhandledrejection mientras corre `fn`.
 *
 * node:test tiene su propio oyente de unhandledRejection, que da por fallida la
 * prueba en curso. Mientras dura la medicion se aparta (y se devuelve en el
 * finally) para que un rechazo sin manejar se pueda OBSERVAR y comprobar, no
 * solo hacer fallar la prueba.
 */
async function rechazosSinManejar(fn: () => Promise<void>): Promise<unknown[]> {
  const rechazos: unknown[] = [];
  const oyente = (motivo: unknown) => rechazos.push(motivo);
  const delRunner = process.listeners("unhandledRejection");
  process.removeAllListeners("unhandledRejection");
  process.on("unhandledRejection", oyente);
  try {
    await fn();
    await new Promise((listo) => setTimeout(listo, 20));
  } finally {
    process.off("unhandledRejection", oyente);
    for (const anterior of delRunner) process.on("unhandledRejection", anterior);
  }
  return rechazos;
}

test("componente: un register() rechazado (el stub de GoogleOther) no queda sin manejar", async (t) => {
  const aviso = t.mock.method(console, "warn", () => {});
  let llamadas = 0;
  const register = () => {
    llamadas++;
    return Promise.reject(new Error("Rejected"));
  };
  const rechazos = await rechazosSinManejar(() => montar({ workbox: { register } }));
  assert.equal(llamadas, 1, "se sigue registrando el service worker");
  assert.deepEqual(rechazos, []);
  assert.equal(aviso.mock.callCount(), 1, "queda en consola (y como breadcrumb), no como evento");
});

test("componente: un AbortError (un movil que no pudo bajar /sw.js) tampoco queda sin manejar", async (t) => {
  const aviso = t.mock.method(console, "warn", () => {});
  const abort = new DOMException(
    "Failed to register a ServiceWorker for scope ('https://vicinomarket.com/') with script ('https://vicinomarket.com/sw.js'): An unknown error occurred when fetching the script.",
    "AbortError",
  );
  const rechazos = await rechazosSinManejar(() => montar({ workbox: { register: () => Promise.reject(abort) } }));
  assert.deepEqual(rechazos, []);
  assert.equal(aviso.mock.callCount(), 1);
});

// Lo que NO es ruido tiene que seguir llegando a Sentry. El catch tragaba
// cualquier rechazo, asi que un fallo sistematico del registro (un /sw.js con
// 404, una redireccion, un MIME malo) dejaba la PWA sin cache para el 100 % de
// los visitantes sin un solo evento. Se comprueba que llega a
// onunhandledrejection, que es lo que capturan los global handlers de Sentry
// tanto en la web como en la app de Android: alli @sentry/nextjs no tiene
// cliente y un captureException suyo se perderia (capacitor-init.tsx).
const FALLOS_REALES: Array<[string, Error]> = [
  [
    "/sw.js con 404",
    new TypeError(
      "Failed to register a ServiceWorker for scope ('https://vicinomarket.com/') with script ('https://vicinomarket.com/sw.js'): A bad HTTP response code (404) was received when fetching the script.",
    ),
  ],
  [
    "/sw.js detras de una redireccion",
    new DOMException("Failed to register a ServiceWorker: The script resource is behind a redirect, which is disallowed.", "SecurityError"),
  ],
  [
    "/sw.js con MIME de HTML",
    new DOMException("Failed to register a ServiceWorker: The script has an unsupported MIME type ('text/html').", "SecurityError"),
  ],
  ["un mensaje que solo se parece al del stub", new Error("Rejected by policy")],
];

for (const [caso, fallo] of FALLOS_REALES) {
  test(`componente: un fallo real del registro (${caso}) sigue llegando a Sentry`, async (t) => {
    const aviso = t.mock.method(console, "warn", () => {});
    const rechazos = await rechazosSinManejar(() => montar({ workbox: { register: () => Promise.reject(fallo) } }));
    assert.equal(rechazos.length, 1, "llega a onunhandledrejection, como antes de daac627");
    assert.equal(rechazos[0], fallo, "el mismo error, no uno envuelto");
    assert.equal(aviso.mock.callCount(), 0);
  });
}

test("componente: sin window.workbox (dev, sin soporte de SW) no hace nada", async () => {
  const rechazos = await rechazosSinManejar(() => montar({}));
  assert.deepEqual(rechazos, []);
});
