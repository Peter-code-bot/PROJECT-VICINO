import assert from "node:assert/strict";
import { createRequire } from "node:module";
import path from "node:path";
import test from "node:test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { supabaseIntegration } from "@supabase/sentry-js-integration";
import { REDACTADO, sanitizeBodySupabase } from "./saneo-supabase";
import { sanearBreadcrumb, sanearEvento } from "./saneo-ubicacion";

// Datos sinteticos. Centro de Puebla (zona por defecto de la app): coordenada de ciudad.
const LAT = "19.0414";
const LNG = "-98.2063";
const COOKIE_ZONA = "19.041,-98.206";
const UNIVERSIDAD = "Universidad Sintetica de Prueba";
const SUPABASE_SINTETICO = "https://sintetico.supabase.invalid";

type Item = [{ type: string }, Record<string, unknown>];
type Sobre = [unknown, Item[]];
type Miga = { category?: string; data?: Record<string, unknown> };

const requerir = createRequire(import.meta.url);
/** El SDK de navegador que trae @sentry/nextjs (el 10.43 de la raiz es el de la app nativa). */
const requerirDeNext = createRequire(path.join(path.dirname(requerir.resolve("@sentry/nextjs/package.json")), "package.json"));
const SentryNavegador = requerirDeNext("@sentry/react") as typeof import("@sentry/react");
const versionNext = (requerir("@sentry/nextjs/package.json") as { version: string }).version;

function itemsDe(sobres: Sobre[], tipo: string): Array<Record<string, unknown>> {
  return sobres.flatMap((sobre) => sobre[1]).filter(([cabecera]) => cabecera.type === tipo).map(([, item]) => item);
}

/**
 * Las mismas opciones que instrumentation-client.ts, sobre el SDK de navegador
 * real. Lo que el navegador hace distinto del servidor: guarda el atributo
 * db.body como objeto dentro de la transaccion y mete los breadcrumbs tambien
 * en las transacciones. En Node no hay window.location, asi que un procesador
 * pone request como lo pondria HttpContext. Transporte falso: sin red.
 */
test("el SDK de navegador manda breadcrumbs, errores y transacciones sin coordenadas ni university_name", async () => {
  assert.equal(SentryNavegador.SDK_VERSION, versionNext, "no es el SDK de navegador de @sentry/nextjs");
  const sobres: Sobre[] = [];
  SentryNavegador.init({
    dsn: "https://sintetico@sintetico.invalid/3",
    transport: () => ({
      send: async (sobre) => {
        sobres.push(sobre as unknown as Sobre);
        return { statusCode: 200 };
      },
      flush: async () => true,
    }),
    tracesSampleRate: 1,
    defaultIntegrations: false,
    integrations: [
      supabaseIntegration(SupabaseClient, SentryNavegador, {
        tracing: true,
        breadcrumbs: false,
        errors: true,
        sanitizeBody: sanitizeBodySupabase,
      }),
    ],
    beforeBreadcrumb: sanearBreadcrumb,
    beforeSend: (evento) => sanearEvento(evento),
    beforeSendTransaction: sanearEvento,
  });
  SentryNavegador.addEventProcessor((evento) => ({
    ...evento,
    request: {
      url: `https://vicinomarket.com/rankings?lat=${LAT}&lng=${LNG}`,
      headers: { Referer: `https://vicinomarket.com/buscar?lat=${LAT}&lng=${LNG}&radio=5000`, "User-Agent": "sintetico" },
    },
  }));

  // Las RPC responden bien (solo dejan su span); las escrituras fallan (span y error).
  const fetchFalso: typeof fetch = async (entrada) =>
    String(entrada).includes("/rest/v1/rpc/")
      ? new Response("[]", { status: 200, headers: { "Content-Type": "application/json" } })
      : new Response(JSON.stringify({ code: "23514", message: "sintetico", details: "sintetico", hint: null }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
  const supabase = createClient(SUPABASE_SINTETICO, "llave-anonima-sintetica", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchFalso },
  });

  try {
    // Las tres formas que dejan las integraciones del navegador.
    SentryNavegador.addBreadcrumb({ category: "navigation", data: { from: "/", to: `/rankings?lat=${LAT}&lng=${LNG}` } });
    SentryNavegador.addBreadcrumb({
      category: "fetch",
      type: "http",
      data: { method: "GET", url: `/api/session/home?#vicino_location=${COOKIE_ZONA};vicino_radius=10000`, status_code: 200 },
    });
    SentryNavegador.addBreadcrumb({
      category: "xhr",
      type: "http",
      data: { method: "GET", url: `https://api.apple-mapkit.com/v1/reverseGeocode?loc=${LAT},${LNG}`, status_code: 200 },
    });
    SentryNavegador.startSpan(
      { name: "/rankings", op: "navigation", forceTransaction: true, attributes: { "url.full": `https://vicinomarket.com/rankings?lat=${LAT}&lng=${LNG}` } },
      () => {},
    );
    // La escritura de verification-upload.tsx; la integracion crea su span y captura el error.
    const { error } = await supabase
      .from("seller_verification")
      .update({ status: "pending", document_type: "Credencial Universitaria", university_name: UNIVERSIDAD })
      .eq("id", "00000000-0000-4000-8000-000000000000");
    assert.equal(error?.code, "23514");
    // La RPC que hooks/use-request-page.ts llama desde el navegador con la zona.
    await supabase.rpc("feed_nearby_requests_v2", { user_lat: Number(LAT), user_lng: Number(LNG), radius_meters: 5000 });
    await SentryNavegador.flush(3_000);

    const errores = itemsDe(sobres, "event");
    assert.equal(errores.length, 1);
    const evento = errores[0] ?? {};
    assert.deepEqual((evento.contexts as { supabase?: { body?: unknown } }).supabase?.body, {
      status: "pending",
      document_type: "Credencial Universitaria",
      university_name: REDACTADO,
    });
    assert.deepEqual(evento.request, {
      url: "https://vicinomarket.com/rankings",
      headers: { Referer: "https://vicinomarket.com/buscar", "User-Agent": "sintetico" },
    });
    assert.deepEqual(
      (evento.breadcrumbs as Miga[]).map((miga) => [miga.category, miga.data?.to ?? miga.data?.url]),
      [
        ["navigation", "/rankings"],
        ["fetch", "/api/session/home#vicino_radius=10000"],
        ["xhr", "https://api.apple-mapkit.com/v1/reverseGeocode"],
      ],
    );

    const transacciones = itemsDe(sobres, "transaction");
    const datos = transacciones.flatMap((transaccion) => [
      (transaccion.contexts as { trace?: { data?: Record<string, unknown> } }).trace?.data ?? {},
      ...((transaccion.spans as Array<{ data?: Record<string, unknown> }> | undefined) ?? []).map((span) => span.data ?? {}),
    ]);
    const navegacion = datos.find((dato) => dato["sentry.op"] === "navigation");
    assert.equal(navegacion?.["url.full"], "https://vicinomarket.com/rankings");
    const escritura = datos.find((dato) => dato["db.table"] === "seller_verification");
    assert.deepEqual(escritura?.["db.body"], {
      status: "pending",
      document_type: "Credencial Universitaria",
      university_name: REDACTADO,
    });
    const rpc = datos.find((dato) => dato["db.table"] === "feed_nearby_requests_v2");
    assert.deepEqual(rpc?.["db.body"], { user_lat: REDACTADO, user_lng: REDACTADO, radius_meters: 5000 });

    // Fuera stacktrace: son lineas de codigo fuente de este archivo, no datos del evento.
    const todo = JSON.stringify(sobres, (clave, valor: unknown) => (clave === "stacktrace" ? undefined : valor));
    for (const huella of ["19.04", "98.20", UNIVERSIDAD]) {
      assert.ok(!todo.includes(huella), `quedo ${huella} en lo que se mandaria a Sentry`);
    }
  } finally {
    await SentryNavegador.close(2_000);
  }
});
