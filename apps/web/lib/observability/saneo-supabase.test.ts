import assert from "node:assert/strict";
import test from "node:test";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { supabaseIntegration } from "@supabase/sentry-js-integration";
import {
  REDACTADO,
  TODAS_LAS_COLUMNAS,
  crearSanitizeBody,
  sanitizeBodySupabase,
} from "./saneo-supabase";

// Datos sinteticos: ninguna persona, documento ni universidad reales.
const UNIVERSIDAD = "Universidad Sintetica de Prueba";
const NOTA_IA = { nombre_en_documento: "PERSONA SINTETICA", observaciones: ["sintetica"], confianza_porcentaje: 50 };
/** Con formato de CURP y claves imposibles (ZZZZ, nacida en el extranjero): no es de nadie. */
const CURP_SINTETICA = ["ZZZZ", "000101", "X", "NE", "ZZZ", "0", "0"].join("");
const ID_FILA = "00000000-0000-4000-8000-000000000000";

test("redacta ai_analysis_raw y university_name de seller_verification", () => {
  assert.equal(sanitizeBodySupabase("seller_verification", "ai_analysis_raw", NOTA_IA), REDACTADO);
  assert.equal(sanitizeBodySupabase("seller_verification", "university_name", UNIVERSIDAD), REDACTADO);
});

test("deja pasar el resto de columnas, otras tablas y los valores nulos", () => {
  assert.equal(sanitizeBodySupabase("seller_verification", "status", "pending"), "pending");
  assert.equal(sanitizeBodySupabase("seller_verification", "document_type", "INE"), "INE");
  assert.equal(sanitizeBodySupabase("products_services", "university_name", UNIVERSIDAD), UNIVERSIDAD);
  assert.equal(sanitizeBodySupabase("seller_verification", "university_name", null), null);
  assert.equal(sanitizeBodySupabase("seller_verification", "ai_analysis_raw", undefined), undefined);
});

test("redacta coordenadas en cualquier tabla o RPC y deja el radio", () => {
  // Centro de Puebla (zona por defecto de la app): coordenada de ciudad, no de una persona.
  assert.equal(sanitizeBodySupabase("feed_nearby_requests_v2", "user_lat", 19.0414), REDACTADO);
  assert.equal(sanitizeBodySupabase("search_nearby_products_v4", "user_lng", -98.2063), REDACTADO);
  assert.equal(sanitizeBodySupabase("descubrir_comunidades", "p_lat", 19.0414), REDACTADO);
  assert.equal(
    sanitizeBodySupabase("products_services", "ubicacion_geo", "SRID=4326;POINT(-98.2063 19.0414)"),
    REDACTADO,
  );
  assert.equal(sanitizeBodySupabase("feed_nearby_requests_v2", "radius_meters", 5000), 5000);
  assert.equal(sanitizeBodySupabase("feed_nearby_requests_v2", "cat_slug", "comida"), "comida");
});

test("una tabla nueva, como la futura del OCR, se agrega con una linea", () => {
  const sanitize = crearSanitizeBody({
    seller_verification: ["ai_analysis_raw"],
    lectura_ocr_sintetica: TODAS_LAS_COLUMNAS,
    otra_tabla_sintetica: ["curp"],
  });
  assert.equal(sanitize("lectura_ocr_sintetica", "curp_valida", true), REDACTADO);
  assert.equal(sanitize("lectura_ocr_sintetica", "cualquier_columna", CURP_SINTETICA), REDACTADO);
  assert.equal(sanitize("otra_tabla_sintetica", "curp", CURP_SINTETICA), REDACTADO);
  assert.equal(sanitize("otra_tabla_sintetica", "estado", "ok"), "ok");
  assert.equal(sanitize("seller_verification", "university_name", UNIVERSIDAD), UNIVERSIDAD);
});

test("un nombre de tabla raro no lee Object.prototype", () => {
  for (const tabla of ["constructor", "__proto__", "hasOwnProperty", "toString"]) {
    assert.equal(sanitizeBodySupabase(tabla, "university_name", UNIVERSIDAD), UNIVERSIDAD);
  }
});

type Captura = { span?: Record<string, unknown>; contexto?: Record<string, unknown> };

/**
 * La integracion real 0.3.0 con un Sentry de mentira: asi se ve exactamente que
 * le llega a startInactiveSpan (db.body) y a captureException (contexts.supabase)
 * cuando PostgREST responde con error. Sin red: el fetch es falso.
 */
test("la integracion real manda db.body y contexts.supabase.body ya redactados", async () => {
  const captura: Captura = {};
  const sentryFalso = {
    startInactiveSpan(opciones: { attributes?: Record<string, unknown> }) {
      captura.span = opciones.attributes;
      return { setAttribute() {}, setStatus() {}, end() {} };
    },
    captureException(_error: unknown, contexto?: { contexts?: Record<string, unknown> }) {
      captura.contexto = contexto?.contexts;
    },
    addBreadcrumb() {},
    SEMANTIC_ATTRIBUTE_SENTRY_OP: "sentry.op",
    SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN: "sentry.origin",
  };
  const integracion = supabaseIntegration(SupabaseClient, sentryFalso, {
    tracing: true,
    breadcrumbs: false,
    errors: true,
    sanitizeBody: sanitizeBodySupabase,
  }) as { setupOnce: () => void; _restore?: () => void };
  integracion.setupOnce();
  try {
    const peticiones: string[] = [];
    const fetchFalso: typeof fetch = async (entrada) => {
      peticiones.push(String(entrada));
      return new Response(
        JSON.stringify({ code: "23514", message: "sintetico", details: "sintetico", hint: null }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    };
    const cliente = createClient("https://sintetico.supabase.invalid", "llave-anonima-sintetica", {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
      global: { fetch: fetchFalso },
    });
    const { error } = await cliente
      .from("seller_verification")
      .update({ status: "pending", university_name: UNIVERSIDAD, ai_analysis_raw: NOTA_IA })
      .eq("id", ID_FILA);

    assert.equal(error?.code, "23514");
    assert.equal(peticiones.length, 1);
    const esperado = { status: "pending", university_name: REDACTADO, ai_analysis_raw: REDACTADO };
    assert.deepEqual(captura.span?.["db.body"], esperado);
    assert.deepEqual((captura.contexto?.supabase as { body?: unknown } | undefined)?.body, esperado);
    const todo = JSON.stringify(captura);
    for (const dato of [UNIVERSIDAD, "PERSONA SINTETICA"]) assert.ok(!todo.includes(dato), `quedo ${dato}`);

    // Los argumentos de una RPC llegan por el mismo camino (tabla = nombre de la funcion).
    await cliente.rpc("feed_nearby_requests_v2", { user_lat: 19.0414, user_lng: -98.2063, radius_meters: 5000 });
    assert.ok(peticiones.at(-1)?.endsWith("/rest/v1/rpc/feed_nearby_requests_v2"));
    const esperadoRpc = { user_lat: REDACTADO, user_lng: REDACTADO, radius_meters: 5000 };
    assert.deepEqual(captura.span?.["db.body"], esperadoRpc);
    assert.deepEqual((captura.contexto?.supabase as { body?: unknown } | undefined)?.body, esperadoRpc);
  } finally {
    integracion._restore?.();
  }
});
