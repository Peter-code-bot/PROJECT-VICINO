import assert from "node:assert/strict";
import http from "node:http";
import { PassThrough, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { after, before, test } from "node:test";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@supabase/supabase-js";
import { REDACTADO } from "./saneo-supabase";
import { sanearBreadcrumb, sanearEvento } from "./saneo-ubicacion";

// Datos sinteticos. Centro de Puebla (zona por defecto de la app): coordenada de ciudad.
const LAT = "19.0414";
const LNG = "-98.2063";
const COOKIE_ZONA = "19.041,-98.206";
const CENTER_CODIFICADO = "19.041%2C-98.206";
const UNIVERSIDAD = "Universidad Sintetica de Prueba";
const ID_FILA = "00000000-0000-4000-8000-000000000000";
const SUPABASE_SINTETICO = "https://sintetico.supabase.invalid";
const CIUDAD_SINTETICA = "Ciudad%20Sintetica";
const CP_SINTETICO = "CP_SINTETICO";
/** Lo que Vercel agrega a cada peticion a una Function (geolocalizacion por IP). */
const CABECERAS_GEO_VERCEL = {
  "x-vercel-ip-latitude": LAT,
  "x-vercel-ip-longitude": LNG,
  "x-vercel-ip-city": CIUDAD_SINTETICA,
  "x-vercel-ip-postal-code": CP_SINTETICO,
};
/** Cookie de sesion de Supabase (access y refresh token) y argumentos de un login. */
const COOKIE_SESION = "sb-sintetico-auth-token=base64-SINTETICO";
const CUERPO_LOGIN = '["persona@sintetico.invalid","CONTRASENA_SINTETICA"]';
const HUELLAS = [
  "19.04",
  "98.20",
  "FIRMA_SINTETICA",
  UNIVERSIDAD,
  "PERSONA SINTETICA",
  CIUDAD_SINTETICA,
  CP_SINTETICO,
  "base64-SINTETICO",
  "persona@sintetico.invalid",
  "CONTRASENA_SINTETICA",
];

type Item = [{ type: string }, Record<string, unknown>];
type Sobre = [unknown, Item[]];
type Request = {
  url?: string;
  query_string?: unknown;
  headers?: Record<string, unknown>;
  cookies?: unknown;
  data?: unknown;
};

function itemsDe(sobres: Sobre[], tipo: string): Array<Record<string, unknown>> {
  return sobres.flatMap((sobre) => sobre[1]).filter(([cabecera]) => cabecera.type === tipo).map(([, item]) => item);
}

/** Cambia el send() del transporte por uno que guarda los sobres: nada sale a la red. */
function interceptarEnvios(): Sobre[] {
  const transporte = Sentry.getClient()?.getTransport();
  assert.ok(transporte && typeof transporte.send === "function", "sin transporte que interceptar");
  const sobres: Sobre[] = [];
  transporte.send = async (sobre) => {
    sobres.push(sobre as unknown as Sobre);
    return { statusCode: 200 };
  };
  transporte.flush = async () => true;
  return sobres;
}

/**
 * Fuera stacktrace: ContextLines adjunta lineas de ESTE archivo, y su codigo
 * fuente contiene los datos sinteticos; no son datos de ningun evento.
 */
function sinHuellas(sobres: Sobre[]): void {
  const todo = JSON.stringify(sobres, (clave, valor: unknown) => (clave === "stacktrace" ? undefined : valor));
  for (const huella of HUELLAS) {
    assert.ok(!todo.includes(huella), `quedo ${huella} en lo que se mandaria a Sentry`);
  }
}

function cabecerasGeo(request: Request | undefined): string[] {
  return Object.keys(request?.headers ?? {}).filter((nombre) => nombre.toLowerCase().startsWith("x-vercel-ip-"));
}

/**
 * La configuracion REAL del servidor (sentry.server.config.ts), con el SDK
 * @sentry/nextjs 10.75 que usa en produccion. El DSN es sintetico y lo unico
 * que se cambia es el send() del transporte, para que nada salga a la red.
 */
before(async () => {
  process.env.SENTRY_DSN = "https://sintetico@sintetico.invalid/1";
  process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_SINTETICO;
  await import("../../sentry.server.config");
  const cliente = Sentry.getClient();
  assert.ok(cliente, "sentry.server.config.ts no inicio el cliente");
  const opciones = cliente.getOptions();
  assert.equal(opciones.beforeBreadcrumb, sanearBreadcrumb);
  assert.equal(opciones.beforeSend, sanearEvento);
  assert.equal(opciones.beforeSendTransaction, sanearEvento);
});

after(async () => {
  await Sentry.close(2_000);
});

test("el servidor manda errores y transacciones sin coordenadas, sin la firma de MapKit y sin el cuerpo de la verificacion", async () => {
  const sobres = interceptarEnvios();
  const fetchFalso: typeof fetch = async () =>
    new Response(JSON.stringify({ code: "23514", message: "sintetico", details: "sintetico", hint: null }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  const supabase = createClient(SUPABASE_SINTETICO, "llave-anonima-sintetica", {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: fetchFalso },
  });

  await Sentry.withIsolationScope(async (scope) => {
    // Lo que @sentry/nextjs guarda de una peticion a /buscar con zona.
    scope.setSDKProcessingMetadata({
      normalizedRequest: {
        url: `https://vicinomarket.com/buscar?q=pan&lat=${LAT}&lng=${LNG}&radio=5000`,
        method: "GET",
        query_string: `q=pan&lat=${LAT}&lng=${LNG}&radio=5000`,
        headers: {
          host: "vicinomarket.com",
          cookie: `${COOKIE_SESION}; vicino_location=${COOKIE_ZONA}; vicino_radius=10000`,
          referer: `https://vicinomarket.com/rankings?lat=${LAT}&lng=${LNG}`,
          ...CABECERAS_GEO_VERCEL,
        },
        data: CUERPO_LOGIN,
      },
    });
    // La miga que deja @sentry/node-core al terminar el fetch del snapshot.
    Sentry.addBreadcrumb({
      category: "http",
      type: "http",
      data: {
        status_code: 200,
        url: "https://snapshot.apple-mapkit.com/api/v1/snapshot",
        "http.method": "GET",
        "http.query": `?center=${CENTER_CODIFICADO}&size=640x360&teamId=EQUIPO&signature=FIRMA_SINTETICA`,
      },
    });
    await Sentry.startSpan(
      {
        name: "GET /buscar",
        op: "http.server",
        forceTransaction: true,
        attributes: { "http.target": `/buscar?q=pan&lat=${LAT}&lng=${LNG}&radio=5000` },
      },
      async () => {
        await Sentry.startSpan(
          {
            name: "GET",
            op: "http.client",
            attributes: {
              "url.full": `https://snapshot.apple-mapkit.com/api/v1/snapshot?center=${CENTER_CODIFICADO}&signature=FIRMA_SINTETICA`,
              "url.query": `?center=${CENTER_CODIFICADO}&signature=FIRMA_SINTETICA`,
              "server.address": "snapshot.apple-mapkit.com",
            },
          },
          async () => {},
        );
        // La integracion de Supabase de la configuracion captura este error de escritura.
        const { error } = await supabase
          .from("seller_verification")
          .update({ university_name: UNIVERSIDAD, ai_analysis_raw: { nombre_en_documento: "PERSONA SINTETICA" } })
          .eq("id", ID_FILA);
        assert.equal(error?.code, "23514");
      },
    );
  });
  await Sentry.flush(3_000);

  const errores = itemsDe(sobres, "event");
  assert.equal(errores.length, 1);
  const error = errores[0] ?? {};
  const contextos = error.contexts as { supabase?: { body?: unknown } };
  assert.deepEqual(contextos.supabase?.body, { university_name: REDACTADO, ai_analysis_raw: REDACTADO });
  const request = error.request as Request;
  assert.equal(request.url, "https://vicinomarket.com/buscar?q=pan");
  assert.equal(request.query_string, "q=pan");
  assert.equal(request.headers?.cookie, undefined);
  assert.equal(request.headers?.referer, "https://vicinomarket.com/rankings");
  assert.equal(request.headers?.host, "vicinomarket.com");
  assert.deepEqual(cabecerasGeo(request), []);
  assert.equal(request.cookies, undefined);
  assert.equal(request.data, undefined);
  const migas = error.breadcrumbs as Array<{ category?: string; data?: Record<string, unknown> }>;
  const migaSnapshot = migas.find((miga) => miga.data?.url === "https://snapshot.apple-mapkit.com/api/v1/snapshot");
  assert.ok(migaSnapshot, "falta la miga del snapshot");
  assert.equal(migaSnapshot.data?.["http.query"], undefined);

  const transacciones = itemsDe(sobres, "transaction");
  assert.equal(transacciones.length, 1);
  const transaccion = transacciones[0] ?? {};
  assert.deepEqual(cabecerasGeo(transaccion.request as Request | undefined), []);
  assert.equal((transaccion.request as Request | undefined)?.data, undefined);
  assert.equal((transaccion.request as Request | undefined)?.cookies, undefined);
  const traza = (transaccion.contexts as { trace?: { data?: Record<string, unknown> } }).trace;
  assert.equal(traza?.data?.["http.target"], "/buscar?q=pan");
  const spans = transaccion.spans as Array<{ data?: Record<string, unknown> }>;
  const spanSnapshot = spans.find((span) => span.data?.["server.address"] === "snapshot.apple-mapkit.com");
  assert.ok(spanSnapshot, "falta el span del snapshot");
  assert.equal(spanSnapshot.data?.["url.full"], "https://snapshot.apple-mapkit.com/api/v1/snapshot");
  assert.equal(spanSnapshot.data?.["url.query"], undefined);

  // handleOnSpanStart copia las cabeceras de la peticion al span raiz; las cookies no quedan.
  assert.deepEqual(
    Object.keys(traza?.data ?? {}).filter((clave) => clave.startsWith("http.request.header.cookie")),
    [],
  );
  assert.equal(traza?.data?.["http.request.header.referer"], "https://vicinomarket.com/rankings");
  assert.deepEqual(
    Object.keys(traza?.data ?? {}).filter((clave) => clave.startsWith("http.request.header.x_vercel_ip_")),
    [],
  );

  sinHuellas(sobres);
});

/**
 * instrumentation.ts exporta onRequestError = Sentry.captureRequestError: es
 * lo que reporta todo error no controlado de render, rutas, Server Actions y
 * proxy. Next 16 le pasa `path` con la query (guia de instrumentation:
 * "e.g. /blog?name=foo") y el SDK lo copia a contexts.nextjs.request_path.
 */
test("onRequestError de instrumentation.ts manda el error sin la ruta con coordenadas ni la geolocalizacion de Vercel", async () => {
  const { onRequestError } = await import("../../instrumentation");
  const sobres = interceptarEnvios();

  onRequestError(
    new Error("sintetico-render"),
    {
      path: `/buscar?q=pan&lat=${LAT}&lng=${LNG}&radio=5000`,
      method: "GET",
      headers: {
        host: "vicinomarket.com",
        cookie: `${COOKIE_SESION}; vicino_location=${COOKIE_ZONA}; vicino_radius=10000`,
        referer: `https://vicinomarket.com/mapa?lat=${LAT}&lng=${LNG}`,
        ...CABECERAS_GEO_VERCEL,
      },
    },
    { routerKind: "App Router", routePath: "/buscar", routeType: "render" },
  );
  await Sentry.flush(3_000);

  const errores = itemsDe(sobres, "event");
  assert.equal(errores.length, 1);
  const error = errores[0] ?? {};
  const nextjs = (error.contexts as { nextjs?: Record<string, unknown> }).nextjs;
  assert.equal(nextjs?.request_path, "/buscar?q=pan");
  assert.equal(nextjs?.router_path, "/buscar");
  assert.equal(nextjs?.route_type, "render");
  assert.equal(error.transaction, "GET /buscar");
  const request = error.request as Request;
  assert.equal(request.headers?.cookie, undefined);
  assert.equal(request.headers?.referer, "https://vicinomarket.com/mapa");
  assert.deepEqual(cabecerasGeo(request), []);
  assert.equal(request.cookies, undefined);

  sinHuellas(sobres);
});

/**
 * Una Server Action llega como POST con sus argumentos en el cuerpo, y Next 16
 * lo lee con pipeline() (action-handler.js). Con un http.Server de verdad, el
 * SDK de servidor guarda ese cuerpo en request.data y las cookies en
 * request.cookies y en la cabecera cookie, de errores Y transacciones, aunque
 * sendDefaultPii sea false. Nada de eso debe salir hacia Sentry.
 */
test("un POST real no deja en Sentry ni su cuerpo ni las cookies de sesion", async () => {
  const sobres = interceptarEnvios();
  const leidos: Buffer[] = [];
  const servidor = http.createServer(async (req, res) => {
    await Sentry.startSpan({ name: "POST /login", op: "http.server", forceTransaction: true }, async () => {
      const paso = new PassThrough();
      await Promise.all([
        pipeline(
          req,
          new Transform({
            transform(trozo, _codificacion, listo) {
              listo(null, trozo);
            },
          }),
          paso,
        ),
        (async () => {
          for await (const trozo of paso) leidos.push(Buffer.from(trozo));
        })(),
      ]);
      Sentry.captureException(new Error("sintetico-accion"));
    });
    res.end("ok");
  });
  await new Promise<void>((listo) => servidor.listen(0, "127.0.0.1", () => listo()));
  try {
    const direccion = servidor.address();
    const puerto = typeof direccion === "object" && direccion !== null ? direccion.port : 0;
    await new Promise<void>((resolve, reject) => {
      const peticion = http.request(
        {
          host: "127.0.0.1",
          port: puerto,
          method: "POST",
          path: "/login",
          headers: {
            "content-type": "text/plain;charset=UTF-8",
            "next-action": "sintetico",
            cookie: `${COOKIE_SESION}; vicino_radius=10000`,
          },
        },
        (respuesta) => {
          respuesta.resume();
          respuesta.on("end", () => resolve());
        },
      );
      peticion.on("error", reject);
      peticion.end(CUERPO_LOGIN);
    });
  } finally {
    await new Promise<void>((listo) => servidor.close(() => listo()));
  }
  await Sentry.flush(3_000);

  assert.equal(Buffer.concat(leidos).toString("utf8"), CUERPO_LOGIN, "el servidor de prueba no leyo el cuerpo");
  const errores = itemsDe(sobres, "event");
  const transacciones = itemsDe(sobres, "transaction");
  assert.equal(errores.length, 1);
  assert.equal(transacciones.length, 1);
  for (const item of [...errores, ...transacciones]) {
    const request = item.request as Request | undefined;
    // Si el SDK dejara de adjuntar request, esta prueba ya no probaria nada.
    assert.ok(request, "el evento no trae request");
    assert.equal(request.data, undefined);
    assert.equal(request.cookies, undefined);
    assert.equal(request.headers?.cookie, undefined);
  }

  sinHuellas(sobres);
});
