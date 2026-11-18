import assert from "node:assert/strict";
import test from "node:test";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@supabase/supabase-js";
import { REDACTADO } from "./saneo-supabase";
import { sanearBreadcrumb, sanearEvento } from "./saneo-ubicacion";

// Datos sinteticos. Centro de Puebla (zona por defecto de la app): coordenada de ciudad.
const LAT = "19.0414";
const LNG = "-98.2063";
const UNIVERSIDAD = "Universidad Sintetica de Prueba";
const SUPABASE_SINTETICO = "https://sintetico.supabase.invalid";

type Item = [{ type: string }, Record<string, unknown>];
type Sobre = [unknown, Item[]];
type Gancho = (evento: Sentry.ErrorEvent, pista: Sentry.EventHint) => unknown;

/**
 * El CABLEADO de instrumentation-client.ts. En Node, "@sentry/nextjs" resuelve
 * al build de servidor, asi que esto comprueba las opciones que el archivo le
 * pasa a Sentry.init (ganchos, filtro de ruido y sanitizeBody), no el SDK del
 * navegador: ese lo cubre saneo-sentry-navegador.test.ts con las mismas
 * funciones. DSN sintetico y send() interceptado: nada sale a la red.
 */
test("instrumentation-client.ts sanea ubicacion y cuerpos sin perder su filtro de ruido", async () => {
  process.env.NEXT_PUBLIC_SENTRY_DSN = "https://sintetico@sintetico.invalid/2";
  await import("../../instrumentation-client");

  const cliente = Sentry.getClient();
  assert.ok(cliente, "instrumentation-client.ts no inicio el cliente");
  const opciones = cliente.getOptions();
  assert.equal(opciones.beforeBreadcrumb, sanearBreadcrumb);
  assert.equal(opciones.beforeSendTransaction, sanearEvento);

  const beforeSend = opciones.beforeSend as Gancho | undefined;
  assert.ok(beforeSend, "falta beforeSend");
  const evento: Sentry.ErrorEvent = {
    type: undefined,
    request: { url: `https://vicinomarket.com/rankings?lat=${LAT}&lng=${LNG}` },
    breadcrumbs: [{ category: "navigation", data: { from: "/", to: `/mapa?lat=${LAT}&lng=${LNG}&radio=3000` } }],
  };
  const limpio = beforeSend(evento, { originalException: new Error("sintetico") }) as Sentry.ErrorEvent;
  assert.equal(limpio.request?.url, "https://vicinomarket.com/rankings");
  assert.deepEqual(limpio.breadcrumbs?.[0]?.data, { from: "/", to: "/mapa" });
  // Lo que ya hacia: tirar el ruido conocido.
  for (const ruido of ["ResizeObserver loop completed with undelivered notifications.", "Non-Error promise rejection captured"]) {
    assert.equal(beforeSend(evento, { originalException: new Error(ruido) }), null);
  }

  const transporte = cliente.getTransport();
  assert.ok(transporte && typeof transporte.send === "function", "sin transporte que interceptar");
  const sobres: Sobre[] = [];
  transporte.send = async (sobre) => {
    sobres.push(sobre as unknown as Sobre);
    return { statusCode: 200 };
  };
  transporte.flush = async () => true;

  const fetchFalso: typeof fetch = async () =>
    new Response(JSON.stringify({ code: "23514", message: "sintetico", details: "sintetico", hint: null }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  const supabase = createClient(SUPABASE_SINTETICO, "llave-anonima-sintetica", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchFalso },
  });
  try {
    // La misma escritura que hace verification-upload.tsx al subir una foto.
    const { error } = await supabase
      .from("seller_verification")
      .update({ status: "pending", document_type: "Credencial Universitaria", university_name: UNIVERSIDAD })
      .eq("id", "00000000-0000-4000-8000-000000000000");
    assert.equal(error?.code, "23514");
    await Sentry.flush(3_000);

    const errores = sobres.flatMap((sobre) => sobre[1]).filter(([cabecera]) => cabecera.type === "event");
    assert.equal(errores.length, 1);
    const contextos = errores[0]?.[1].contexts as { supabase?: { body?: unknown } };
    assert.deepEqual(contextos.supabase?.body, {
      status: "pending",
      document_type: "Credencial Universitaria",
      university_name: REDACTADO,
    });
    // Fuera stacktrace: ContextLines adjunta lineas de codigo fuente, no datos del evento.
    const todo = JSON.stringify(sobres, (clave, valor: unknown) => (clave === "stacktrace" ? undefined : valor));
    assert.ok(!todo.includes(UNIVERSIDAD));
  } finally {
    await Sentry.close(2_000);
  }
});
