#!/usr/bin/env node
/**
 * Smoke de SOLO LECTURA del orden por distancia de «Cerca de ti»
 * (FEED-GEO-ORDER, PDF 05: «primero confirmar y probar el orden por distancia»).
 *
 *   node scripts/smoke-orden-cercania.mjs
 *   node scripts/smoke-orden-cercania.mjs --url https://<preview>.vercel.app
 *   SMOKE_BASE_URL=http://localhost:3000 node scripts/smoke-orden-cercania.mjs
 *   node scripts/smoke-orden-cercania.mjs --html --estricto-d4
 *
 * Hace dos GET anonimos a /api/session/home, sin sesion y sin escribir nada,
 * con la cookie de zona de dos puntos sinteticos: los centros genericos de dos
 * ciudades vecinas (a unos 10 km), con radio de 10 km. Comprueba:
 *
 *   1. 200 y JSON (Cache-Control privado/no-store: aviso si no).
 *   2. «Cerca de ti» sin error y con al menos 2 filas.
 *   3. distance_meters no decreciente. Tolera caidas de hasta 100 m: la RPC
 *      ordena con `<->` (esfera) y devuelve la distancia con ST_Distance
 *      redondeada hacia arriba a 100 m, asi que dos filas casi empatadas pueden
 *      quedar invertidas por un cubo (INFERIDO). Esas salen como aviso; una
 *      caida mayor es fallo.
 *   4. Ninguna fila (cerca, all, universityProducts) trae claves de
 *      coordenadas. distance_meters no cuenta: es un cubo de 100 m, y en `all`
 *      llega en null.
 *   5. Que el orden cambie entre los dos puntos (aviso si no).
 *   6. PENDIENTE D4: que la respuesta no devuelva userLat/userLng. Hasta que
 *      se despliegue, es un aviso; con --estricto-d4 es fallo. Con --html se
 *      mira ademas la semilla del HTML de / (la cookie literal en la clave y
 *      userLat con numero, igual de pendientes) y que el primer pintado siga
 *      diciendo «Vista previa de tu zona» y «Cargando tu zona…» (fallo si no).
 *
 * No imprime titulos ni nombres: solo contadores, booleanos y distancias.
 * Sale 0 si no hay fallos y 1 si hay alguno.
 */

const BASE_POR_DEFECTO = 'https://vicinomarket.com';
/** Centros urbanos genericos, a 3 decimales (no son la ubicacion de nadie). */
const PUNTOS = [
  { nombre: 'centro-a', lat: 19.041, lng: -98.206 },
  { nombre: 'centro-b', lat: 19.063, lng: -98.306 },
];
const RADIO_M = 10000;
const TOLERANCIA_M = 100;
const PLAZO_MS = 20_000;
/** Por debajo del cupo de 60/min por IP de /api/session. */
const PAUSA_MS = 1100;

function argumentos(argv) {
  const opciones = { url: process.env.SMOKE_BASE_URL ?? process.env.BASE_URL ?? BASE_POR_DEFECTO, html: false, estrictoD4: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--url') opciones.url = argv[++i] ?? '';
    else if (arg.startsWith('--url=')) opciones.url = arg.slice('--url='.length);
    else if (arg === '--html') opciones.html = true;
    else if (arg === '--estricto-d4') opciones.estrictoD4 = true;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  return opciones;
}

/** Solo un origen: https, o http a la propia maquina. Sin credenciales, ruta ni query. */
function origenValido(texto) {
  const url = new URL(texto);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (url.username || url.password || (url.pathname !== '/' && url.pathname !== '') || url.search || url.hash) {
    throw new Error('La URL base debe ser solo un origen, sin credenciales, ruta ni query');
  }
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) {
    throw new Error('Solo https, o http contra localhost');
  }
  return url.origin;
}

const PROHIBIDAS = [
  /^(lat|lng|lon|long|latitude|longitude|latitud|longitud)$/i,
  /_(lat|lng|lon|latitude|longitude)$/i,
  /^(coords?|coordinates|coordenadas|center|centro|geo|geometry|point)$/i,
  /^ubicacion_(geo|mapa|lat|lng)$/i,
  /^exact_/i,
];
const esClaveDeCoordenadas = (clave) => PROHIBIDAS.some((patron) => patron.test(clave));

function clavesDeCoordenadas(valor, ruta = '', encontradas = new Set()) {
  if (Array.isArray(valor)) {
    valor.forEach((item) => clavesDeCoordenadas(item, `${ruta}[]`, encontradas));
  } else if (valor && typeof valor === 'object') {
    for (const [clave, item] of Object.entries(valor)) {
      if (esClaveDeCoordenadas(clave)) encontradas.add(`${ruta}.${clave}`);
      clavesDeCoordenadas(item, `${ruta}.${clave}`, encontradas);
    }
  }
  return encontradas;
}

const esperar = (ms) => new Promise((resolver) => setTimeout(resolver, ms));
const cookieDe = (punto) => `vicino_location=${punto.lat.toFixed(3)},${punto.lng.toFixed(3)}; vicino_radius=${RADIO_M}`;

async function pedir(base, ruta, punto, accept) {
  return fetch(new URL(ruta, base), {
    method: 'GET',
    headers: { Cookie: cookieDe(punto), Accept: accept },
    redirect: 'manual',
    cache: 'no-store',
    signal: AbortSignal.timeout(PLAZO_MS),
  });
}

function revisarOrden(distancias) {
  let exactas = 0;
  let graves = 0;
  for (let i = 1; i < distancias.length; i++) {
    const caida = distancias[i - 1] - distancias[i];
    if (caida > TOLERANCIA_M) graves++;
    else if (caida > 0) exactas++;
  }
  return { exactas, graves };
}

async function revisarPunto(base, punto, informe) {
  const respuesta = await pedir(base, '/api/session/home', punto, 'application/json');
  const cacheControl = respuesta.headers.get('cache-control') ?? '';
  if (respuesta.status !== 200) {
    informe.fallo(`${punto.nombre}: status ${respuesta.status}`);
    return null;
  }
  if (!/private/.test(cacheControl) || !/no-store/.test(cacheControl)) informe.aviso(`${punto.nombre}: Cache-Control sin private/no-store`);
  let cuerpo;
  try {
    cuerpo = await respuesta.json();
  } catch {
    informe.fallo(`${punto.nombre}: la respuesta no es JSON`);
    return null;
  }
  const valor = cuerpo?.value ?? {};
  const cerca = valor.cercaDeTiResultado ?? {};
  const filas = Array.isArray(cerca.products) ? cerca.products : [];
  if (cerca.error) informe.fallo(`${punto.nombre}: «Cerca de ti» trae error`);
  if (filas.length < 2) informe.fallo(`${punto.nombre}: «Cerca de ti» trae ${filas.length} filas (minimo 2)`);

  const distancias = filas.map((fila) => fila?.distance_meters);
  const noNumericas = distancias.filter((d) => typeof d !== 'number' || !Number.isFinite(d)).length;
  if (noNumericas) informe.fallo(`${punto.nombre}: ${noNumericas} filas sin distance_meters numerico`);
  const { exactas, graves } = revisarOrden(distancias.filter((d) => typeof d === 'number'));
  if (graves) informe.fallo(`${punto.nombre}: ${graves} inversiones de mas de ${TOLERANCIA_M} m`);
  if (exactas) informe.aviso(`${punto.nombre}: ${exactas} inversiones dentro de un cubo de ${TOLERANCIA_M} m`);

  const claves = clavesDeCoordenadas({ cerca: filas, all: valor.all ?? [], universityProducts: valor.universityProducts ?? [] });
  if (claves.size) informe.fallo(`${punto.nombre}: filas con claves de coordenadas: ${[...claves].join(', ')}`);

  const devuelveCoordenadas = valor.userLat != null || valor.userLng != null;
  if (devuelveCoordenadas) informe.pendienteD4(`${punto.nombre}: la respuesta devuelve userLat/userLng`);

  const numericas = distancias.filter((d) => typeof d === 'number');
  console.log(`${punto.nombre}: status=200 noStore=${/no-store/.test(cacheControl)} anonimo=${cuerpo?.userId === ''} filasCerca=${filas.length} `
    + `distancias=[${numericas.join(',')}] inversiones=${exactas + graves} (>${TOLERANCIA_M}m: ${graves}) `
    + `clavesCoordenadas=${claves.size} filasAll=${Array.isArray(valor.all) ? valor.all.length : 0} userLatPresente=${devuelveCoordenadas}`);
  return filas.map((fila) => fila?.id);
}

async function revisarHtml(base, punto, informe) {
  const respuesta = await pedir(base, '/', punto, 'text/html');
  if (respuesta.status !== 200) {
    informe.fallo(`html ${punto.nombre}: status ${respuesta.status}`);
    return;
  }
  const html = await respuesta.text();
  const cookieLiteral = html.includes('vicino_location=');
  const userLatConNumero = /userLat\\?"\s*:\s*-?\d/.test(html);
  // Sin coordenadas en la semilla, el primer pintado tiene que seguir diciendo
  // que hay zona (la vista previa recibe solo hayUbicacionEnServidor).
  const vistaPreviaDeTuZona = html.includes('Vista previa de tu zona');
  const cargandoTuZona = html.includes('Cargando tu zona');
  if (cookieLiteral) informe.pendienteD4(`html ${punto.nombre}: la semilla lleva la cookie literal en la clave`);
  if (userLatConNumero) informe.pendienteD4(`html ${punto.nombre}: la semilla lleva userLat con numero`);
  if (!vistaPreviaDeTuZona || !cargandoTuZona) informe.fallo(`html ${punto.nombre}: el primer pintado ya no dice que hay zona`);
  console.log(`html ${punto.nombre}: status=200 cookieLiteral=${cookieLiteral} userLatConNumero=${userLatConNumero} `
    + `vistaPreviaDeTuZona=${vistaPreviaDeTuZona} cargandoTuZona=${cargandoTuZona}`);
}

async function main() {
  const opciones = argumentos(process.argv.slice(2));
  const base = origenValido(opciones.url);
  const fallos = [];
  const avisos = [];
  const informe = {
    fallo: (texto) => fallos.push(texto),
    aviso: (texto) => avisos.push(texto),
    pendienteD4: (texto) => (opciones.estrictoD4 ? fallos : avisos).push(`PENDIENTE D4 · ${texto}`),
  };
  console.log(`Smoke orden por cercania contra ${base} (solo GET, sin sesion)`);

  const ordenes = [];
  for (const [indice, punto] of PUNTOS.entries()) {
    if (indice > 0) await esperar(PAUSA_MS);
    try {
      ordenes.push(await revisarPunto(base, punto, informe));
    } catch (error) {
      informe.fallo(`${punto.nombre}: ${error instanceof Error ? error.name : 'error'} al pedir la API`);
      ordenes.push(null);
    }
  }
  const [ordenA, ordenB] = ordenes;
  if (ordenA && ordenB) {
    const igual = ordenA.length === ordenB.length && ordenA.every((id, i) => id === ordenB[i]);
    console.log(`ordenDistintoEntrePuntos=${!igual}`);
    if (igual) informe.aviso('el orden de «Cerca de ti» es igual en los dos puntos');
  }

  if (opciones.html) {
    for (const punto of PUNTOS) {
      await esperar(PAUSA_MS);
      try {
        await revisarHtml(base, punto, informe);
      } catch (error) {
        informe.fallo(`html ${punto.nombre}: ${error instanceof Error ? error.name : 'error'} al pedir /`);
      }
    }
  }

  for (const texto of avisos) console.log(`AVISO ${texto}`);
  for (const texto of fallos) console.log(`FALLO ${texto}`);
  console.log(`RESULTADO: ${fallos.length} fallos, ${avisos.length} avisos`);
  process.exitCode = fallos.length ? 1 : 0;
}

main().catch((error) => {
  console.error(`FALLO ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
