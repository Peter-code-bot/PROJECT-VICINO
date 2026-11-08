import assert from "node:assert/strict";
import test from "node:test";
import { sanearBreadcrumb, sanearEvento, sanearParametros, sanearUrl } from "./saneo-ubicacion";

// Centro de Puebla, la zona por defecto de la app (change-location-sheet.tsx):
// una coordenada de ciudad, no la de una persona.
const LAT = "19.0414";
const LNG = "-98.2063";
const COOKIE_ZONA = "19.041,-98.206";
const CENTER_CODIFICADO = "19.041%2C-98.206";

function sinCoordenadas(valor: unknown): void {
  const texto = JSON.stringify(valor);
  for (const huella of ["19.04", "98.20"]) {
    assert.ok(!texto.includes(huella), `quedo ${huella} en ${texto}`);
  }
}

function congelar<T>(valor: T): T {
  if (typeof valor === "object" && valor !== null) {
    Object.values(valor).forEach(congelar);
    Object.freeze(valor);
  }
  return valor;
}

test("sanearUrl quita lat, lng y radio de la query y conserva lo demas", () => {
  assert.equal(sanearUrl(`/rankings?lat=${LAT}&lng=${LNG}`), "/rankings");
  assert.equal(
    sanearUrl(`/buscar?q=tacos&lat=${LAT}&lng=${LNG}&radio=5000&orden=reciente`),
    "/buscar?q=tacos&orden=reciente",
  );
  assert.equal(
    sanearUrl(`https://vicinomarket.com/mapa?modo=cerca&lat=${LAT}&lng=${LNG}&radio=3000`),
    "https://vicinomarket.com/mapa?modo=cerca",
  );
  // Solo cuentan las CLAVES: un valor que diga "lat" se queda.
  const sinUbicacion = "/buscar?q=lat&page=2#resultados";
  assert.equal(sanearUrl(sinUbicacion), sinUbicacion);
});

test("sanearUrl limpia el fragmento con ; que arma la cache de sesion", () => {
  assert.equal(
    sanearUrl(`/api/session/home?#vicino_location=${COOKIE_ZONA};vicino_radius=10000`),
    "/api/session/home#vicino_radius=10000",
  );
  assert.equal(
    sanearUrl(`/api/session/home?feed=following#vicino_location=${COOKIE_ZONA}`),
    "/api/session/home?feed=following",
  );
});

test("sanearUrl manda las URLs de apple-mapkit.com sin query ni fragmento", () => {
  const snapshot =
    `https://snapshot.apple-mapkit.com/api/v1/snapshot?center=${CENTER_CODIFICADO}` +
    "&size=640x360&scale=2&teamId=EQUIPO&keyId=LLAVE&signature=FIRMA_SINTETICA";
  assert.equal(sanearUrl(snapshot), "https://snapshot.apple-mapkit.com/api/v1/snapshot");
  assert.equal(
    sanearUrl(`https://api.apple-mapkit.com/v1/reverseGeocode?loc=${LAT},${LNG}&lang=es-MX#x`),
    "https://api.apple-mapkit.com/v1/reverseGeocode",
  );
  // Un host que solo se parece no recibe la regla del host, solo la de las claves.
  assert.equal(
    sanearUrl("https://apple-mapkit.com.ejemplo.test/x?center=1&firma=2"),
    "https://apple-mapkit.com.ejemplo.test/x?firma=2",
  );
  assert.equal(sanearUrl("https://falsoapple-mapkit.com/x?firma=2"), "https://falsoapple-mapkit.com/x?firma=2");
});

test("sanearUrl reconoce claves en mayusculas o codificadas y no revienta con un % suelto", () => {
  assert.equal(sanearUrl(`/x?LAT=${LAT}&%6Cng=${LNG}&ok=1`), "/x?ok=1");
  assert.equal(sanearUrl(`/x?%E0%A4%A=1&lat=${LAT}`), "/x?%E0%A4%A=1");
  const datos = `data:text/plain,lat=${LAT}`;
  assert.equal(sanearUrl(datos), datos);
});

test("sanearParametros acepta query o fragmento sueltos", () => {
  assert.equal(sanearParametros(`?center=${CENTER_CODIFICADO}&size=640x360`), "?size=640x360");
  assert.equal(sanearParametros(`lat=${LAT}&lng=${LNG}`), "");
  assert.equal(sanearParametros(`#vicino_location=${COOKIE_ZONA};vicino_radius=10000`), "#vicino_radius=10000");
  assert.equal(sanearParametros("?page=2"), "?page=2");
});

test("sanearBreadcrumb deja sin coordenadas navigation, fetch, xhr y el http del servidor", () => {
  const navegacion = sanearBreadcrumb({
    category: "navigation",
    data: { from: "/", to: `/rankings?lat=${LAT}&lng=${LNG}` },
  });
  assert.deepEqual(navegacion?.data, { from: "/", to: "/rankings" });

  const fetch = sanearBreadcrumb({
    category: "fetch",
    type: "http",
    data: {
      method: "GET",
      url: `/api/session/home?#vicino_location=${COOKIE_ZONA};vicino_radius=10000`,
      status_code: 200,
    },
  });
  assert.deepEqual(fetch?.data, { method: "GET", url: "/api/session/home#vicino_radius=10000", status_code: 200 });

  const xhr = sanearBreadcrumb({
    category: "xhr",
    type: "http",
    data: { method: "GET", url: `https://api.apple-mapkit.com/v1/reverseGeocode?loc=${LAT},${LNG}`, status_code: 200 },
  });
  assert.equal(xhr?.data.url, "https://api.apple-mapkit.com/v1/reverseGeocode");

  // Forma del breadcrumb de fetch de @sentry/node-core 10.75: url ya sin query, la query aparte.
  const snapshot = sanearBreadcrumb({
    category: "http",
    type: "http",
    data: {
      status_code: 200,
      url: "https://snapshot.apple-mapkit.com/api/v1/snapshot",
      "http.method": "GET",
      "http.query": `?center=${CENTER_CODIFICADO}&size=640x360&teamId=EQUIPO&keyId=LLAVE&signature=FIRMA_SINTETICA`,
    },
  });
  assert.deepEqual(snapshot?.data, {
    status_code: 200,
    url: "https://snapshot.apple-mapkit.com/api/v1/snapshot",
    "http.method": "GET",
  });

  const propio = sanearBreadcrumb({
    category: "http",
    data: { url: "https://vicinomarket.com/api/x", "http.query": `?lat=${LAT}&page=2`, "http.fragment": `#lng=${LNG}` },
  });
  assert.deepEqual(propio?.data, { url: "https://vicinomarket.com/api/x", "http.query": "?page=2" });

  for (const miga of [navegacion, fetch, xhr, snapshot, propio]) sinCoordenadas(miga);
  assert.ok(!JSON.stringify(snapshot).includes("FIRMA"));
});

test("sanearBreadcrumb no muta la entrada y devuelve la misma si no hay nada que quitar", () => {
  const clic = congelar({ category: "ui.click", message: "button.zona", data: { "ui.component_name": "Zona" } });
  assert.equal(sanearBreadcrumb(clic), clic);
  const sinDatos = congelar({ category: "sentry.event", message: "Error: sintetico" });
  assert.equal(sanearBreadcrumb(sinDatos), sinDatos);

  const original = { category: "navigation", data: { from: "/", to: `/mapa?lat=${LAT}&lng=${LNG}` } };
  const copia = structuredClone(original);
  congelar(original);
  const limpio = sanearBreadcrumb(original);
  assert.notEqual(limpio, original);
  assert.deepEqual(original, copia);
  assert.equal(limpio?.data.to, "/mapa");
});

test("sanearBreadcrumb conserva una clave __proto__ propia sin tocar el prototipo", () => {
  const data = JSON.parse(`{"__proto__": {"x": 1}, "url": "/mapa?lat=${LAT}"}`) as Record<string, unknown>;
  const limpio = sanearBreadcrumb({ category: "fetch", data });
  assert.ok(limpio && Object.prototype.hasOwnProperty.call(limpio.data, "__proto__"));
  assert.equal(Object.getPrototypeOf(limpio.data), Object.prototype);
  assert.equal(limpio.data.url, "/mapa");
});

test("sanearBreadcrumb descarta la miga si el saneo falla", () => {
  const rota = {
    category: "fetch",
    data: {
      get url(): string {
        throw new Error("sintetico");
      },
    },
  };
  assert.equal(sanearBreadcrumb(rota), null);
});

test("sanearEvento limpia request, Referer y breadcrumbs de un error y no deja ninguna cookie", () => {
  const evento = congelar({
    event_id: "0".repeat(32),
    level: "error" as const,
    exception: { values: [{ type: "Error", value: "sintetico" }] },
    request: {
      url: `https://vicinomarket.com/rankings?lat=${LAT}&lng=${LNG}`,
      method: "GET",
      query_string: `lat=${LAT}&lng=${LNG}`,
      headers: {
        Referer: `https://vicinomarket.com/buscar?q=pan&lat=${LAT}&lng=${LNG}&radio=5000`,
        cookie: `vicino_location=${COOKIE_ZONA}; vicino_radius=10000`,
        "User-Agent": "sintetico",
      },
      cookies: { vicino_location: COOKIE_ZONA, vicino_radius: "10000" },
    },
    breadcrumbs: [{ category: "navigation", data: { from: "/", to: `/rankings?lat=${LAT}&lng=${LNG}` } }],
    contexts: { trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) } },
  });
  const limpio = sanearEvento(evento);

  sinCoordenadas(limpio);
  assert.equal(limpio.request.url, "https://vicinomarket.com/rankings");
  assert.equal(limpio.request.query_string, undefined);
  assert.deepEqual(limpio.request.headers, {
    Referer: "https://vicinomarket.com/buscar?q=pan",
    "User-Agent": "sintetico",
  });
  assert.equal(limpio.request.cookies, undefined);
  assert.equal(limpio.request.method, "GET");
  assert.deepEqual(limpio.breadcrumbs, [{ category: "navigation", data: { from: "/", to: "/rankings" } }]);
  assert.equal(limpio.exception, evento.exception);
  assert.equal(limpio.contexts, evento.contexts);
});

test("sanearEvento no deja el cuerpo de la peticion ni las cookies, la de sesion incluida", () => {
  const evento = congelar({
    request: {
      url: "https://vicinomarket.com/login",
      method: "POST",
      // Lo que el SDK de servidor guarda del cuerpo de una Server Action: sus argumentos.
      data: '["persona@sintetico.invalid","CONTRASENA_SINTETICA"]',
      headers: {
        host: "vicinomarket.com",
        Cookie: "sb-sintetico-auth-token=base64-SINTETICO; tema=oscuro",
        "next-action": "sintetico",
        // Las cabeceras con credenciales: el cron de Vercel manda su secreto en Authorization.
        Authorization: "Bearer SECRETO_SINTETICO",
        "x-vercel-oidc-token": "TOKEN_SINTETICO",
        "x-api-key": "LLAVE_SINTETICA",
        "x-vercel-proxy-signature": "FIRMA_SINTETICA",
      },
      cookies: { "sb-sintetico-auth-token": "base64-SINTETICO", tema: "oscuro" },
    },
  });
  const limpio = sanearEvento(evento);

  const texto = JSON.stringify(limpio);
  const huellas = [
    "persona@sintetico.invalid",
    "CONTRASENA_SINTETICA",
    "base64-SINTETICO",
    "oscuro",
    "SECRETO_SINTETICO",
    "TOKEN_SINTETICO",
    "LLAVE_SINTETICA",
    "FIRMA_SINTETICA",
  ];
  for (const huella of huellas) {
    assert.ok(!texto.includes(huella), `quedo ${huella} en ${texto}`);
  }
  assert.equal(limpio.request.data, undefined);
  assert.equal(limpio.request.cookies, undefined);
  assert.deepEqual(limpio.request.headers, { host: "vicinomarket.com", "next-action": "sintetico" });
  assert.equal(limpio.request.url, "https://vicinomarket.com/login");
  assert.equal(limpio.request.method, "POST");

  const conObjeto = sanearEvento({ request: { method: "POST", data: { ubicacion_lat: LAT, ubicacion_lng: LNG } } });
  assert.deepEqual(JSON.parse(JSON.stringify(conObjeto.request)), { method: "POST" });
});

test("sanearEvento acepta query_string como objeto o como lista de pares", () => {
  const comoObjeto = sanearEvento({ request: { query_string: { lat: LAT, page: "2" } } });
  assert.deepEqual(comoObjeto.request, { query_string: { page: "2" } });
  const comoPares = sanearEvento({ request: { query_string: [["lat", LAT], ["page", "2"]] } });
  assert.deepEqual(comoPares.request, { query_string: [["page", "2"]] });
});

test("sanearEvento limpia la transaccion: span raiz, fetch con fragmento y el snapshot de Apple", () => {
  const consulta = { description: "from(products_services)", data: { "db.table": "products_services" } };
  const transaccion = congelar({
    type: "transaction" as const,
    transaction: "/rankings",
    request: { url: `https://vicinomarket.com/rankings?lat=${LAT}&lng=${LNG}` },
    contexts: {
      trace: {
        trace_id: "a".repeat(32),
        span_id: "b".repeat(16),
        data: {
          "sentry.op": "navigation",
          "url.full": `https://vicinomarket.com/rankings?lat=${LAT}&lng=${LNG}`,
          "url.path": "/rankings",
        },
      },
    },
    spans: [
      {
        description: "GET /api/session/home",
        data: {
          type: "fetch",
          url: `/api/session/home?#vicino_location=${COOKIE_ZONA};vicino_radius=10000`,
          "http.fragment": `#vicino_location=${COOKIE_ZONA};vicino_radius=10000`,
        },
      },
      {
        description: "GET https://snapshot.apple-mapkit.com/api/v1/snapshot",
        data: {
          "url.full": `https://snapshot.apple-mapkit.com/api/v1/snapshot?center=${CENTER_CODIFICADO}&signature=FIRMA_SINTETICA`,
          "url.query": `?center=${CENTER_CODIFICADO}&signature=FIRMA_SINTETICA`,
          "http.query": `center=${CENTER_CODIFICADO}&signature=FIRMA_SINTETICA`,
          url: "https://snapshot.apple-mapkit.com/api/v1/snapshot",
          "url.path": "/api/v1/snapshot",
          "server.address": "snapshot.apple-mapkit.com",
        },
      },
      consulta,
    ],
  });
  const limpia = sanearEvento(transaccion);

  sinCoordenadas(limpia);
  assert.ok(!JSON.stringify(limpia).includes("FIRMA"));
  assert.equal(limpia.request.url, "https://vicinomarket.com/rankings");
  assert.deepEqual(limpia.contexts.trace.data, {
    "sentry.op": "navigation",
    "url.full": "https://vicinomarket.com/rankings",
    "url.path": "/rankings",
  });
  assert.deepEqual(limpia.spans[0]?.data, {
    type: "fetch",
    url: "/api/session/home#vicino_radius=10000",
    "http.fragment": "#vicino_radius=10000",
  });
  assert.deepEqual(limpia.spans[1]?.data, {
    "url.full": "https://snapshot.apple-mapkit.com/api/v1/snapshot",
    url: "https://snapshot.apple-mapkit.com/api/v1/snapshot",
    "url.path": "/api/v1/snapshot",
    "server.address": "snapshot.apple-mapkit.com",
  });
  assert.equal(limpia.spans[2], consulta);
});

test("sanearEvento limpia las cabeceras que el SDK de servidor copia al span raiz y quita las cookies", () => {
  const transaccion = sanearEvento({
    contexts: {
      trace: {
        data: {
          "http.request.header.cookie.vicino_location": COOKIE_ZONA,
          "http.request.header.cookie.vicino_radius": "10000",
          "http.request.header.cookie.sb-sintetico-auth-token": "base64-SINTETICO",
          "http.request.header.cookie": `vicino_location=${COOKIE_ZONA}; tema=oscuro`,
          "http.request.header.referer": `https://vicinomarket.com/mapa?lat=${LAT}&lng=${LNG}`,
          "http.response.header.location": `/rankings?lat=${LAT}&lng=${LNG}`,
          "http.response.header.set_cookie.vicino_location": COOKIE_ZONA,
          "http.response.header.set_cookie": "sb-sintetico-auth-token=base64-SINTETICO",
          // Con span streaming, el SDK copia el cuerpo de la peticion a este atributo.
          "http.request.body.data": '["persona@sintetico.invalid","CONTRASENA_SINTETICA"]',
          "http.request.header.user_agent": "sintetico",
        },
      },
    },
  });
  sinCoordenadas(transaccion);
  assert.ok(!JSON.stringify(transaccion).includes("SINTETICO"));
  assert.ok(!JSON.stringify(transaccion).includes("SINTETICA"));
  assert.deepEqual(transaccion.contexts, {
    trace: {
      data: {
        "http.request.header.referer": "https://vicinomarket.com/mapa",
        "http.response.header.location": "/rankings",
        "http.request.header.user_agent": "sintetico",
      },
    },
  });
});

test("sanearEvento limpia la ruta que onRequestError deja en contexts.nextjs y las URL de otros contextos", () => {
  const evento = congelar({
    contexts: {
      // Lo que pone @sentry/nextjs (captureRequestError): request_path es req.url, con query.
      nextjs: {
        request_path: `/buscar?q=pan&lat=${LAT}&lng=${LNG}&radio=5000`,
        router_kind: "App Router",
        router_path: "/buscar",
        route_type: "render",
      },
      pagina: { url: `https://vicinomarket.com/mapa?lat=${LAT}&lng=${LNG}`, href: `/rankings?lat=${LAT}`, path: "/perfil" },
      trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16) },
      runtime: { name: "node", version: "v22.0.0" },
    },
  });
  const limpio = sanearEvento(evento);

  sinCoordenadas(limpio);
  assert.deepEqual(limpio.contexts.nextjs, {
    request_path: "/buscar?q=pan",
    router_kind: "App Router",
    router_path: "/buscar",
    route_type: "render",
  });
  assert.deepEqual(limpio.contexts.pagina, { url: "https://vicinomarket.com/mapa", href: "/rankings", path: "/perfil" });
  assert.equal(limpio.contexts.trace, evento.contexts.trace);
  assert.equal(limpio.contexts.runtime, evento.contexts.runtime);
});

test("sanearEvento quita las cabeceras de geolocalizacion por IP que agrega Vercel", () => {
  const evento = congelar({
    request: {
      headers: {
        host: "vicinomarket.com",
        "x-vercel-ip-latitude": LAT,
        "X-Vercel-IP-Longitude": LNG,
        "x-vercel-ip-city": "Ciudad%20Sintetica",
        "x-vercel-ip-postal-code": "CP_SINTETICO",
        "x-vercel-ip-country": "ZZ",
        "x-vercel-id": "sintetico",
      },
    },
    contexts: {
      trace: {
        data: {
          "http.request.header.x_vercel_ip_latitude": LAT,
          "http.request.header.x_vercel_ip_city": "Ciudad%20Sintetica",
          "http.request.header.x_vercel_id": "sintetico",
        },
      },
    },
  });
  const limpio = sanearEvento(evento);

  sinCoordenadas(limpio);
  assert.ok(!JSON.stringify(limpio).includes("Sintetica"));
  assert.deepEqual(limpio.request.headers, { host: "vicinomarket.com", "x-vercel-id": "sintetico" });
  assert.deepEqual(limpio.contexts.trace.data, { "http.request.header.x_vercel_id": "sintetico" });
});

test("sanearEvento devuelve el mismo evento si no hay nada que quitar y tolera formas raras", () => {
  const limpio = congelar({ event_id: "1".repeat(32), request: { url: "https://vicinomarket.com/perfil" } });
  assert.equal(sanearEvento(limpio), limpio);
  const raro = congelar({ request: null, breadcrumbs: "x", spans: {}, contexts: { trace: "y" } });
  assert.equal(sanearEvento(raro), raro);
});

test("sanearEvento nunca devuelve null: si algo revienta, quita request, breadcrumbs y spans", () => {
  const evento = {
    event_id: "2".repeat(32),
    request: {
      get url(): string {
        throw new Error("sintetico");
      },
    },
    breadcrumbs: [{ category: "navigation", data: { to: `/mapa?lat=${LAT}` } }],
  };
  const resultado = sanearEvento(evento);
  assert.ok(resultado !== null);
  assert.equal(resultado.event_id, evento.event_id);
  assert.equal(resultado.request, undefined);
  assert.equal(resultado.breadcrumbs, undefined);
});

test("el respaldo tampoco deja la ruta de onRequestError, los datos de la traza ni la query de la transaccion", () => {
  const evento = {
    event_id: "3".repeat(32),
    transaction: `GET /buscar?lat=${LAT}&lng=${LNG}`,
    request: {
      get url(): string {
        throw new Error("sintetico");
      },
    },
    contexts: {
      nextjs: { request_path: `/buscar?lat=${LAT}&lng=${LNG}`, router_path: "/buscar" },
      trace: {
        trace_id: "a".repeat(32),
        span_id: "b".repeat(16),
        op: "http.server",
        data: { "url.full": `https://vicinomarket.com/buscar?lat=${LAT}&lng=${LNG}` },
      },
      runtime: { name: "node" },
    },
  };
  const resultado = sanearEvento(evento);

  sinCoordenadas(resultado);
  assert.equal(resultado.event_id, evento.event_id);
  assert.equal(resultado.transaction, "GET /buscar");
  assert.deepEqual(resultado.contexts, {
    trace: { trace_id: "a".repeat(32), span_id: "b".repeat(16), op: "http.server" },
    runtime: { name: "node" },
  });
});
