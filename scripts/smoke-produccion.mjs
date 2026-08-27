#!/usr/bin/env node
/**
 * Smoke de produccion que mira CONTENIDO, no codigos de estado.
 *
 *   node scripts/smoke-produccion.mjs
 *   node scripts/smoke-produccion.mjs --url https://vicinomarket.com
 *
 * POR QUE EXISTE, Y ES UNA LECCION PAGADA. El 26-ago-2026 una migracion mia
 * duplico search_nearby_products_v4 (CREATE OR REPLACE anadiendo un parametro
 * crea una SOBRECARGA, no reemplaza). PostgREST empezo a devolver 300 PGRST203
 * y el feed de inicio, el universitario, "Cerca de ti" y el cargar-mas
 * quedaron caidos.
 *
 * El smoke de entonces comprobo que / devolvia 200. Y devolvia 200: la pagina
 * cargaba perfecta y pintaba "No hay vendedores cerca de ti" con la base llena.
 * Un 200 no dice absolutamente nada sobre si la pagina hace su trabajo.
 *
 * De ahi la forma de este archivo: cada comprobacion declara algo que TIENE que
 * aparecer en el HTML, y a veces algo que NO puede aparecer. El caso del feed
 * lleva la cookie de ubicacion, porque sin ella la home no ejerce el RPC que se
 * rompio.
 *
 * Sale 0 si todo pasa, 1 si algo falla.
 */

const BASE_POR_DEFECTO = 'https://vicinomarket.com';

/** Puebla centro. Sin cookie de ubicacion la home no llama al RPC del feed. */
const COOKIE_UBICACION = 'vicino_location=19.0414,-98.2063; vicino_radius=25000';

const COMPROBACIONES = [
  {
    nombre: 'home con ubicacion: el feed trae productos',
    ruta: '/',
    cookie: COOKIE_UBICACION,
    // Lo que de verdad demuestra que el feed vive: hay media de producto.
    debe: [/product-media/],
    // Y el estado vacio es justo lo que se pinto durante el incidente.
    nunca: [/No hay vendedores cerca de ti/],
  },
  {
    nombre: 'buscar sin acento encuentra el producto acentuado',
    ruta: '/buscar?q=sandia',
    debe: [/Aros de Sand/],
  },
  {
    nombre: 'buscar por ejemplo de categoria',
    ruta: '/buscar?q=gomitas',
    debe: [/href="\/[a-z-]+\/[a-z0-9-]+"/],
  },
  {
    nombre: 'aviso de privacidad publicado y versionado',
    ruta: '/privacidad',
    // El `<!-- -->` no es adorno: React lo intercala entre el texto estatico y
    // el valor interpolado. Sin contemplarlo, esta comprobacion daba rojo con la
    // pagina perfectamente bien — y un chequeo que grita en falso es un chequeo
    // que alguien acaba apagando.
    debe: [/[Vv]ersi[oó]n\s*(?:<!--\s*-->)?\s*2\.2/, /credencial de estudiante/],
  },
  {
    nombre: 'terminos publicados',
    ruta: '/terminos',
    debe: [/[Tt].rminos/],
  },
  {
    nombre: 'canonical apunta al dominio bueno',
    ruta: '/privacidad',
    debe: [/<link rel="canonical" href="https:\/\/vicinomarket\.com\/privacidad"\/?>/],
  },
  {
    nombre: 'rankings responde con contenido',
    ruta: '/rankings',
    debe: [/[Rr]anking/],
  },
  {
    nombre: 'los enlaces de vendedor no apuntan a la ruta muerta /tienda/',
    ruta: '/',
    cookie: COOKIE_UBICACION,
    nunca: [/href="\/tienda\//],
  },
];

const traer = async (url, cookie) => {
  const res = await fetch(url, {
    headers: cookie ? { Cookie: cookie } : {},
    redirect: 'follow',
  });
  return { status: res.status, html: await res.text() };
};

const main = async () => {
  const args = process.argv.slice(2);
  const i = args.indexOf('--url');
  const base = i !== -1 ? args[i + 1] : BASE_POR_DEFECTO;

  let fallos = 0;
  for (const c of COMPROBACIONES) {
    const url = base + c.ruta;
    let html = '';
    let status = 0;
    try {
      ({ status, html } = await traer(url, c.cookie));
    } catch (error) {
      console.log(`FALLA  ${c.nombre}\n       no se pudo pedir ${url}: ${error.message}`);
      fallos++;
      continue;
    }

    const faltan = (c.debe ?? []).filter((re) => !re.test(html));
    const sobran = (c.nunca ?? []).filter((re) => re.test(html));

    if (faltan.length === 0 && sobran.length === 0) {
      console.log(`OK     ${c.nombre}`);
      continue;
    }

    fallos++;
    console.log(`FALLA  ${c.nombre}   (HTTP ${status}, ${html.length} bytes)`);
    for (const re of faltan) console.log(`       falta:  ${re}`);
    for (const re of sobran) console.log(`       sobra:  ${re}`);
  }

  console.log(
    fallos === 0
      ? `\n${COMPROBACIONES.length} comprobaciones, todas en verde.\n`
      : `\n${fallos} de ${COMPROBACIONES.length} en rojo.\n`,
  );
  process.exit(fallos === 0 ? 0 : 1);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
