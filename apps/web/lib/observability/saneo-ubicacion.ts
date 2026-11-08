/**
 * Saneo de privacidad para Sentry: coordenadas, cuerpos de peticion y cookies
 * fuera de breadcrumbs, eventos y transacciones. Funciones puras: no leen el
 * entorno, no tocan la red y nunca mutan lo que reciben (devuelven el MISMO
 * objeto si no habia nada que quitar).
 *
 * Que se quita y por que (comprobado con los SDK instalados, 10.75.2 en web y
 * servidor y 10.43 en la app nativa):
 *
 * - Los parametros lat, lng, radio, center y vicino_location, en la query y en
 *   el fragmento de cualquier URL. El fragmento importa: la cache de sesion
 *   pide `/api/session/home?#vicino_location=<lat>,<lng>;vicino_radius=<m>`
 *   (lib/session-scope.ts) y el SDK guarda en el breadcrumb `fetch` la URL tal
 *   cual se le paso a fetch(), con fragmento. /rankings, /mapa y /buscar llevan
 *   lat/lng/radio en la query, y el SDK los copia en los breadcrumbs
 *   `navigation` (from/to), en `request.url` y en `url.full`/`http.target`.
 * - En las URLs de *.apple-mapkit.com, la query y el fragmento enteros: la del
 *   snapshot lleva `center` y la firma (lib/geo/region-map-snapshot.ts), y las
 *   de MapKit JS llevan la coordenada con otros nombres de parametro.
 * - TODAS las cookies, no solo vicino_location: `request.cookies`, la cabecera
 *   `cookie` y los atributos `http.request.header.cookie*` y
 *   `http.response.header.set_cookie*` del span raiz. El SDK de servidor 10.75
 *   las adjunta aunque sendDefaultPii sea false (@sentry/core
 *   integrations/requestdata.js; @sentry/nextjs server/handleOnSpanStart.js
 *   copia cada cabecera de la peticion al span, Referer incluido), y entre
 *   ellas va la de sesion de Supabase, con el access y el refresh token.
 * - El cuerpo de la peticion (`request.data`, y `http.request.body.*` si algun
 *   dia se activa span streaming). El SDK de servidor lee el de cada peticion
 *   entrante (@sentry/core integrations/http) y lo adjunta a errores y
 *   transacciones aunque sendDefaultPii sea false. Ahi van los argumentos de
 *   las Server Actions: credenciales, direcciones, textos del chat o
 *   coordenadas.
 * - Las cabeceras con credenciales (Authorization, *token*, *secret*,
 *   api-key, csrf...) de `request.headers`: el SDK solo las filtra en los
 *   atributos del span.
 * - `contexts.nextjs.request_path`: onRequestError (instrumentation.ts) recibe
 *   de Next 16 la ruta CON la query y @sentry/nextjs la copia ahi
 *   (common/captureRequestError.js). Se sanea cualquier clave con URL de
 *   cualquier contexto (request_path, url, path, href).
 * - Las cabeceras x-vercel-ip-* (latitud, longitud, ciudad, codigo postal...
 *   por IP), en `request.headers` y como atributos del span raiz. El SDK solo
 *   borra su lista fija de cabeceras de IP (@sentry/core vendor/getIpAddress.js).
 *
 * No cambia QUE se reporta: sanearEvento nunca devuelve null. sanearBreadcrumb
 * solo devuelve null si el propio saneo fallara: es preferible perder la miga
 * que mandarla con la coordenada.
 *
 * Queda fuera de estos ganchos: Replay graba las URLs del historial sin pasar
 * por beforeBreadcrumb ni por beforeSend, y el texto de las migas de console
 * pasa tal cual.
 */

const PARAMETROS_DE_UBICACION: ReadonlySet<string> = new Set([
  "lat",
  "lng",
  "radio",
  "center",
  "vicino_location",
]);

/** Claves de `data` (breadcrumbs y spans) cuyo valor es una URL o una ruta con query. */
const CLAVES_CON_URL: readonly string[] = ["url", "from", "to", "http.url", "url.full", "http.target"];
/** Mas las cabeceras con URL que el SDK copia como atributos del span. */
const CLAVES_URL: ReadonlySet<string> = new Set([
  ...CLAVES_CON_URL,
  "http.request.header.referer",
  "http.request.header.referrer",
  "http.response.header.location",
]);

/** Cookies copiadas como atributo: la cabecera entera o `...cookie.<nombre>`. */
const COOKIE_EN_ATRIBUTO = /^http\.(?:request|response)\.header\.(?:cookie|set_cookie)(?:\..+)?$/i;
/** El cuerpo como atributo: el SDK lo escribe en `http.request.body.data` con span streaming. */
const CUERPO_EN_ATRIBUTO = /^http\.request\.body(?:\..+)?$/i;
/**
 * Cabeceras con credenciales (el cron de Vercel manda su secreto en
 * Authorization). El SDK solo las filtra en los atributos del span, no en
 * `request.headers`.
 */
const CABECERA_CON_CREDENCIAL = /authorization|token|secret|signature|api[-_]?key|csrf|xsrf|session|password/i;

/** Claves cuyo valor es solo la query o solo el fragmento, con o sin `?`/`#`. */
const CLAVES_QUERY: ReadonlySet<string> = new Set([
  "http.query",
  "url.query",
  "http.fragment",
  "url.fragment",
]);

/** Hosts que llevan coordenadas y firmas en la query: se mandan sin query ni fragmento. */
const HOST_SIN_QUERY = /(^|\.)apple-mapkit\.com$/;

/** Geolocalizacion por IP que Vercel agrega a cada peticion: x-vercel-ip-latitude, -city... */
const PREFIJO_CABECERA_GEO = "x-vercel-ip-";
/** La misma cabecera copiada como atributo del span raiz (el SDK cambia `-` por `_`). */
const CABECERA_GEO_EN_ATRIBUTO = /^http\.(?:request|response)\.header\.x_vercel_ip_/i;

/** Claves de un contexto cuyo valor es una URL o una ruta con query. */
const CLAVES_CON_URL_EN_CONTEXTO: ReadonlySet<string> = new Set(["request_path", "url", "path", "href"]);
/** Lo que el respaldo conserva de contexts.trace: los identificadores, sin `data`. */
const CLAVES_DE_TRAZA_SIN_DATOS: readonly string[] = [
  "trace_id",
  "span_id",
  "parent_span_id",
  "op",
  "status",
  "origin",
];

/** El grupo de captura hace que split() conserve los separadores originales. */
const SEPARADORES_DE_QUERY = /([&;])/;

type Datos = Record<string, unknown>;

/** Lo que sanearEvento lee de un evento; el resto pasa intacto. */
export interface EventoSaneable {
  request?: unknown;
  breadcrumbs?: unknown;
  spans?: unknown;
  contexts?: unknown;
  transaction?: unknown;
}

function esObjeto(valor: unknown): valor is Datos {
  return typeof valor === "object" && valor !== null && !Array.isArray(valor);
}

function esClaveDeUbicacion(clave: string): boolean {
  return PARAMETROS_DE_UBICACION.has(clave.trim().toLowerCase());
}

function claveDelPar(par: string): string {
  const igual = par.indexOf("=");
  const cruda = igual === -1 ? par : par.slice(0, igual);
  try {
    return decodeURIComponent(cruda.replace(/\+/g, " "));
  } catch {
    // Un `%` suelto no es motivo para dejar pasar la coordenada.
    return cruda;
  }
}

/** Quita los pares clave=valor de ubicacion y deja todo lo demas igual. */
function filtrarPares(texto: string, separador: RegExp): string {
  const partes = texto.split(separador);
  const conservados: string[] = [];
  let quitoAlgo = false;
  for (let i = 0; i < partes.length; i += 2) {
    const par = partes[i] ?? "";
    if (esClaveDeUbicacion(claveDelPar(par))) {
      quitoAlgo = true;
      continue;
    }
    if (conservados.length > 0) conservados.push(partes[i - 1] ?? "&");
    conservados.push(par);
  }
  return quitoAlgo ? conservados.join("") : texto;
}

function hostDe(url: string): string | undefined {
  const autoridad = /^(?:[a-z][a-z\d+.-]*:)?\/\/([^/?#]*)/i.exec(url.trim())?.[1];
  if (autoridad === undefined) return undefined;
  return autoridad
    .replace(/^.*@/, "")
    .replace(/:\d*$/, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

function esHostSinQuery(host: string | undefined): boolean {
  return host !== undefined && HOST_SIN_QUERY.test(host.toLowerCase());
}

function sanearUrlCon(url: string, sinQuery: boolean): string {
  if (/^data:/i.test(url)) return url;
  const inicioFragmento = url.indexOf("#");
  const sinFragmento = inicioFragmento === -1 ? url : url.slice(0, inicioFragmento);
  const inicioQuery = sinFragmento.indexOf("?");
  if (inicioQuery === -1 && inicioFragmento === -1) return url;
  const base = inicioQuery === -1 ? sinFragmento : sinFragmento.slice(0, inicioQuery);
  if (sinQuery || esHostSinQuery(hostDe(base))) return base;
  const query = inicioQuery === -1 ? undefined : sinFragmento.slice(inicioQuery + 1);
  const fragmento = inicioFragmento === -1 ? undefined : url.slice(inicioFragmento + 1);
  const queryLimpia = query === undefined ? undefined : filtrarPares(query, SEPARADORES_DE_QUERY);
  const fragmentoLimpio =
    fragmento === undefined ? undefined : filtrarPares(fragmento, SEPARADORES_DE_QUERY);
  if (queryLimpia === query && fragmentoLimpio === fragmento) return url;
  return `${base}${queryLimpia ? `?${queryLimpia}` : ""}${fragmentoLimpio ? `#${fragmentoLimpio}` : ""}`;
}

/** URL absoluta o relativa sin parametros de ubicacion (y sin query si es de MapKit). */
export function sanearUrl(url: string): string {
  return sanearUrlCon(url, false);
}

/** Query o fragmento sueltos, como `http.query`; devuelve "" si no queda nada. */
export function sanearParametros(texto: string): string {
  const prefijo = texto.startsWith("?") || texto.startsWith("#") ? texto.slice(0, 1) : "";
  const cuerpo = texto.slice(prefijo.length);
  const filtrado = filtrarPares(cuerpo, SEPARADORES_DE_QUERY);
  if (filtrado === cuerpo) return texto;
  return filtrado === "" ? "" : `${prefijo}${filtrado}`;
}

function vieneDeHostSinQuery(datos: Datos): boolean {
  const servidor = datos["server.address"];
  if (typeof servidor === "string" && esHostSinQuery(servidor)) return true;
  return CLAVES_CON_URL.some((clave) => {
    const valor = datos[clave];
    return typeof valor === "string" && esHostSinQuery(hostDe(valor));
  });
}

function sanearValor(clave: string, valor: unknown, sinQuery: boolean): unknown {
  if (CABECERA_GEO_EN_ATRIBUTO.test(clave) || COOKIE_EN_ATRIBUTO.test(clave) || CUERPO_EN_ATRIBUTO.test(clave)) {
    return undefined;
  }
  if (typeof valor !== "string") return valor;
  if (CLAVES_URL.has(clave)) return sanearUrlCon(valor, sinQuery);
  if (!CLAVES_QUERY.has(clave)) return valor;
  if (sinQuery) return undefined;
  const limpio = sanearParametros(valor);
  return limpio === "" ? undefined : limpio;
}

/**
 * `data` de un breadcrumb o de un span; una clave que queda vacia se omite.
 * Object.fromEntries define propiedades propias: una clave "__proto__" no
 * pasa por el setter del prototipo.
 */
function sanearDatos(datos: Datos): Datos {
  const sinQuery = vieneDeHostSinQuery(datos);
  const salida: Array<[string, unknown]> = [];
  let cambio = false;
  for (const [clave, valor] of Object.entries(datos)) {
    const limpio = sanearValor(clave, valor, sinQuery);
    if (limpio !== valor) cambio = true;
    if (limpio !== undefined) salida.push([clave, limpio]);
  }
  return cambio ? Object.fromEntries(salida) : datos;
}

function sanearMiga<T extends object>(miga: T): T {
  const datos: unknown = "data" in miga ? miga.data : undefined;
  if (!esObjeto(datos)) return miga;
  const limpios = sanearDatos(datos);
  return limpios === datos ? miga : { ...miga, data: limpios };
}

/**
 * Para `beforeBreadcrumb`. Cubre navigation (from/to), fetch y xhr (url) del
 * navegador y http del servidor (url, http.query, http.fragment).
 */
export function sanearBreadcrumb<T extends object>(breadcrumb: T): T | null {
  try {
    return sanearMiga(breadcrumb);
  } catch {
    return null;
  }
}

function sanearLista(lista: unknown, sanear: (elemento: unknown) => unknown): unknown {
  if (!Array.isArray(lista)) return lista;
  let cambio = false;
  const salida = lista.map((elemento: unknown) => {
    const limpio = sanear(elemento);
    if (limpio !== elemento) cambio = true;
    return limpio;
  });
  return cambio ? salida : lista;
}

function sinClavesDeUbicacion(datos: Datos): Datos {
  if (!Object.keys(datos).some(esClaveDeUbicacion)) return datos;
  return Object.fromEntries(Object.entries(datos).filter(([clave]) => !esClaveDeUbicacion(clave)));
}

function sanearQueryString(query: unknown): unknown {
  if (typeof query === "string") {
    const limpia = sanearParametros(query);
    return limpia === "" && query !== "" ? undefined : limpia;
  }
  if (Array.isArray(query)) {
    const filtrada = query.filter(
      (par: unknown) => !(Array.isArray(par) && typeof par[0] === "string" && esClaveDeUbicacion(par[0])),
    );
    return filtrada.length === query.length ? query : filtrada;
  }
  return esObjeto(query) ? sinClavesDeUbicacion(query) : query;
}

function sanearCabecera(nombre: string, valor: unknown): unknown {
  if (typeof valor !== "string") return valor;
  const minusculas = nombre.toLowerCase();
  return minusculas === "referer" || minusculas === "referrer" ? sanearUrl(valor) : valor;
}

/** Fuera enteras: la cabecera cookie, las que llevan credenciales y la geolocalizacion por IP de Vercel. */
function esCabeceraFuera(nombre: string): boolean {
  const minusculas = nombre.trim().toLowerCase();
  return (
    minusculas === "cookie" ||
    CABECERA_CON_CREDENCIAL.test(minusculas) ||
    minusculas.startsWith(PREFIJO_CABECERA_GEO)
  );
}

function sanearCabeceras(cabeceras: Datos): Datos {
  let cambio = false;
  const salida: Array<[string, unknown]> = [];
  for (const [nombre, valor] of Object.entries(cabeceras)) {
    if (esCabeceraFuera(nombre)) {
      cambio = true;
      continue;
    }
    const limpio = sanearCabecera(nombre, valor);
    if (limpio !== valor) cambio = true;
    salida.push([nombre, limpio]);
  }
  return cambio ? Object.fromEntries(salida) : cabeceras;
}

function sanearRequest(request: unknown): unknown {
  if (!esObjeto(request)) return request;
  const cambios: Datos = {};
  if (typeof request.url === "string") {
    const url = sanearUrl(request.url);
    if (url !== request.url) cambios.url = url;
  }
  if ("query_string" in request) {
    const query = sanearQueryString(request.query_string);
    if (query !== request.query_string) cambios.query_string = query;
  }
  if (esObjeto(request.headers)) {
    const cabeceras = sanearCabeceras(request.headers);
    if (cabeceras !== request.headers) cambios.headers = cabeceras;
  }
  // Ni cookies (la de sesion lleva los tokens) ni cuerpo (argumentos de las Server Actions).
  if (request.cookies !== undefined) cambios.cookies = undefined;
  if (request.data !== undefined) cambios.data = undefined;
  return Object.keys(cambios).length === 0 ? request : { ...request, ...cambios };
}

function sanearSpan(span: unknown): unknown {
  if (!esObjeto(span)) return span;
  const cambios: Datos = {};
  if (esObjeto(span.data)) {
    const datos = sanearDatos(span.data);
    if (datos !== span.data) cambios.data = datos;
  }
  if (typeof span.description === "string") {
    const descripcion = sanearUrl(span.description);
    if (descripcion !== span.description) cambios.description = descripcion;
  }
  return Object.keys(cambios).length === 0 ? span : { ...span, ...cambios };
}

function sanearMigaDeEvento(miga: unknown): unknown {
  return esObjeto(miga) ? sanearMiga(miga) : miga;
}

/** Las claves con URL de un contexto y, en `trace`, los atributos del span raiz. */
function sanearContexto(nombre: string, contexto: unknown): unknown {
  if (!esObjeto(contexto)) return contexto;
  const cambios: Datos = {};
  for (const clave of CLAVES_CON_URL_EN_CONTEXTO) {
    const valor = contexto[clave];
    if (typeof valor !== "string") continue;
    const limpio = sanearUrl(valor);
    if (limpio !== valor) cambios[clave] = limpio;
  }
  if (nombre === "trace" && esObjeto(contexto.data)) {
    const datos = sanearDatos(contexto.data);
    if (datos !== contexto.data) cambios.data = datos;
  }
  return Object.keys(cambios).length === 0 ? contexto : { ...contexto, ...cambios };
}

/**
 * `contexts.trace.data` lleva los atributos del span raiz (url.full,
 * http.target, cabeceras...) y `contexts.nextjs.request_path` la ruta con query
 * de todo error que pasa por onRequestError.
 */
function sanearContextos(contextos: unknown): unknown {
  if (!esObjeto(contextos)) return contextos;
  let cambio = false;
  const salida = Object.entries(contextos).map(([nombre, contexto]): [string, unknown] => {
    const limpio = sanearContexto(nombre, contexto);
    if (limpio !== contexto) cambio = true;
    return [nombre, limpio];
  });
  return cambio ? Object.fromEntries(salida) : contextos;
}

/**
 * Para `beforeSend` y `beforeSendTransaction`: request (url, query_string,
 * Referer; sin cookies, sin cuerpo y sin cabeceras x-vercel-ip-*),
 * breadcrumbs, spans, los datos del span raiz y las claves con URL de los
 * contextos (nextjs.request_path).
 */
export function sanearEvento<T extends EventoSaneable>(evento: T): T {
  try {
    const cambios: EventoSaneable = {};
    const request = sanearRequest(evento.request);
    if (request !== evento.request) cambios.request = request;
    const breadcrumbs = sanearLista(evento.breadcrumbs, sanearMigaDeEvento);
    if (breadcrumbs !== evento.breadcrumbs) cambios.breadcrumbs = breadcrumbs;
    const spans = sanearLista(evento.spans, sanearSpan);
    if (spans !== evento.spans) cambios.spans = spans;
    const contextos = sanearContextos(evento.contexts);
    if (contextos !== evento.contexts) cambios.contexts = contextos;
    if (typeof evento.transaction === "string") {
      const transaccion = sanearUrl(evento.transaction);
      if (transaccion !== evento.transaction) cambios.transaction = transaccion;
    }
    return Object.keys(cambios).length === 0 ? evento : { ...evento, ...cambios };
  } catch {
    return sinPartesDeRiesgo(evento);
  }
}

/** Un paso del respaldo: si revienta, ese dato se omite y los demas siguen. */
function oOmitir<V>(calcular: () => V): V | undefined {
  try {
    return calcular();
  } catch {
    return undefined;
  }
}

function trazaSinDatos(traza: unknown): Datos | undefined {
  if (!esObjeto(traza)) return undefined;
  return Object.fromEntries(
    CLAVES_DE_TRAZA_SIN_DATOS.filter((clave) => traza[clave] !== undefined).map((clave) => [clave, traza[clave]]),
  );
}

function contextoSinUrl(contexto: unknown): unknown {
  if (!esObjeto(contexto)) return undefined;
  return Object.keys(contexto).some((clave) => CLAVES_CON_URL_EN_CONTEXTO.has(clave)) ? undefined : contexto;
}

/** Sin `data` en la traza y sin los contextos con una clave de URL (nextjs.request_path). */
function contextosSinUrl(contextos: unknown): Datos | undefined {
  if (!esObjeto(contextos)) return undefined;
  const salida: Array<[string, unknown]> = [];
  for (const nombre of Object.keys(contextos)) {
    const contexto = oOmitir(() =>
      nombre === "trace" ? trazaSinDatos(contextos[nombre]) : contextoSinUrl(contextos[nombre]),
    );
    if (contexto !== undefined) salida.push([nombre, contexto]);
  }
  return Object.fromEntries(salida);
}

function nombreSinQuery(nombre: unknown): unknown {
  return typeof nombre === "string" ? nombre.split(/[?#]/, 1)[0] : nombre;
}

/**
 * Nunca null: el evento se reporta igual, sin las partes que podian llevar la
 * coordenada (request, breadcrumbs, spans, la data de la traza, los contextos
 * con URL y la query del nombre de la transaccion).
 */
function sinPartesDeRiesgo<T extends EventoSaneable>(evento: T): T {
  try {
    const contexts = oOmitir(() => contextosSinUrl(evento.contexts));
    const transaction = oOmitir(() => nombreSinQuery(evento.transaction));
    return { ...evento, request: undefined, breadcrumbs: undefined, spans: undefined, contexts, transaction };
  } catch {
    // Si ni copiarlo se puede, se manda tal cual: antes que perder el reporte del error.
    return evento;
  }
}
