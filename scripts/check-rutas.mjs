#!/usr/bin/env node
/**
 * Comprueba que todo `href` del codigo apunte a una ruta que EXISTE.
 *
 *   node scripts/check-rutas.mjs
 *
 * POR QUE EXISTE. El 27-ago-2026 Alejandro reporto que los botones de iniciar
 * sesion y de crear cuenta daban 404. Eran ciertos y eran seis enlaces a tres
 * rutas inventadas:
 *
 *   /ingresar        -> la ruta es /login
 *   /registro        -> la ruta es /register
 *   /producto/<id>   -> el detalle vive en /<categoria>/<slug>
 *
 * Los dos primeros eran, ademas, las UNICAS dos puertas que el home le ofrece a
 * quien no tiene sesion en el feed "Siguiendo": el camino de conversion mas
 * directo de la aplicacion, muerto. Y antes de eso ya habia pasado lo mismo con
 * `/login?next=/solicitudes`, que tampoco existe porque solo hay
 * /solicitudes/[id].
 *
 * Tres veces el mismo fallo es un patron, no mala suerte: nada obliga a que un
 * href corresponda con una carpeta. Esto lo obliga.
 *
 * QUE MIRA, Y QUE NO:
 *   - `href="/algo"` literal: se compara con el arbol de rutas completo.
 *   - href={`/algo/${x}`} con plantilla: se comprueba el PRIMER tramo estatico,
 *     que es donde estaba el bug de /producto. Un `/producto/` cualquiera falla
 *     aunque el resto sea dinamico.
 *   - Tambien mira `redirect("/x")` y `router.push("/x")`, que son la misma
 *     clase de enlace sin etiqueta.
 *   - NO mira destinos calculados enteros en runtime. Para eso no hay analisis
 *     estatico posible, y forzarlo daria falsos positivos.
 *
 * Sale 0 si todo apunta a algo real, 1 si no.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(REPO_ROOT, 'apps', 'web', 'app');
const FUENTES = path.join(REPO_ROOT, 'apps', 'web');

/** Rutas externas o de esquema propio que no son rutas de la app. */
const IGNORAR = /^(https?:|mailto:|tel:|#|vicino:)/;

const listarArchivos = (dir, ext, salida = []) => {
  for (const entrada of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entrada.name === 'node_modules' || entrada.name.startsWith('.')) continue;
    const p = path.join(dir, entrada.name);
    if (entrada.isDirectory()) listarArchivos(p, ext, salida);
    else if (ext.some((e) => entrada.name.endsWith(e))) salida.push(p);
  }
  return salida;
};

/** El arbol de rutas real: cada carpeta con page.tsx, sin los grupos (xxx). */
const rutasReales = () => {
  const rutas = new Set(['/']);
  for (const archivo of listarArchivos(APP, ['page.tsx', 'route.ts'])) {
    const rel = path.relative(APP, path.dirname(archivo)).split(path.sep).join('/');
    const ruta = ('/' + rel).replace(/\/\([^)]*\)/g, '') || '/';
    rutas.add(ruta === '' ? '/' : ruta);
  }
  return rutas;
};

/** Un segmento [x] casa con cualquier cosa que no lleve barra. */
const casa = (destino, rutas) => {
  if (rutas.has(destino)) return true;
  // Precedencia como la de Next: si el primer tramo del destino corresponde a
  // una carpeta estatica real, solo pueden casarlo rutas que empiecen por esa
  // misma carpeta. Sin esto, /[categoria]/[slug] —que vive en la raiz— casaba
  // con CUALQUIER destino de dos tramos, y el chequeo daba por buena
  // /perfil/siguiendo, que no existe. Next no retrocede a la ruta dinamica
  // hermana cuando el tramo estatico ya gano.
  const primero = destino.split('/').filter(Boolean)[0];
  const raizEstatica =
    Boolean(primero) &&
    [...rutas].some((r) => r.split('/').filter(Boolean)[0] === primero);
  for (const r of rutas) {
    if (raizEstatica && r.split('/').filter(Boolean)[0] !== primero) continue;
    const patron = '^' + r.replace(/\[\.\.\.[^\]]+\]/g, '.+').replace(/\[[^\]]+\]/g, '[^/]+') + '$';
    if (new RegExp(patron).test(destino)) return true;
  }
  return false;
};

/**
 * De un href con plantilla, el prefijo estatico. `/producto/${id}` -> /producto
 * Devuelve null si el primer tramo ya es dinamico (no hay nada que comprobar).
 */
const prefijoEstatico = (bruto) => {
  // La query se corta ANTES de partir por barras. Sin esto, `/buscar?q=${x}`
  // daba el tramo "/buscar?q=" y el chequeo escupia 17 falsos positivos — y un
  // chequeo con 17 falsos positivos es un chequeo que alguien apaga el martes.
  const antes = bruto.split('${')[0].split('?')[0].split('#')[0];
  const tramos = antes.split('/').filter(Boolean);
  return tramos.length > 0 ? '/' + tramos[0] : null;
};

const main = () => {
  const rutas = rutasReales();
  const raices = new Set([...rutas].map((r) => '/' + r.split('/').filter(Boolean)[0]).filter((r) => r !== '/undefined'));

  const problemas = [];
  for (const archivo of listarArchivos(FUENTES, ['.tsx', '.ts'])) {
    if (archivo.includes('.next') || archivo.includes('tests')) continue;
    const texto = fs.readFileSync(archivo, 'utf8');
    const rel = path.relative(REPO_ROOT, archivo).split(path.sep).join('/');

    // 1. href / redirect / router.push con destino literal.
    for (const m of texto.matchAll(/(?:href=|redirect\(|router\.(?:push|replace)\()"(\/[^"?#]*)/g)) {
      const destino = m[1];
      if (IGNORAR.test(destino)) continue;
      if (!casa(destino, rutas)) {
        problemas.push(`${rel}  ->  ${destino}   (no existe esa ruta)`);
      }
    }

    // 2. href con plantilla: se comprueba el primer tramo estatico.
    for (const m of texto.matchAll(/(?:href=\{|redirect\(|router\.(?:push|replace)\()`(\/[^`]*)`/g)) {
      const raiz = prefijoEstatico(m[1]);
      if (!raiz) continue;
      if (!raices.has(raiz)) {
        problemas.push(`${rel}  ->  ${raiz}/...   (no existe ninguna ruta bajo ${raiz})`);
      }
    }
  }

  const unicos = [...new Set(problemas)].sort();
  if (unicos.length === 0) {
    console.log(`Todas las rutas enlazadas existen. (${rutas.size} rutas en el arbol)`);
    process.exit(0);
  }

  console.log(`${unicos.length} enlace(s) a rutas que no existen:\n`);
  for (const p of unicos) console.log('  ' + p);
  console.log(
    '\nUn enlace a una ruta inexistente es un 404 en la cara del usuario, y no lo\n' +
      'atrapa ni tsc ni el build. Corrigelo o, si el destino es dinamico de verdad,\n' +
      'construyelo donde esten los datos y pasalo ya hecho.\n',
  );
  process.exit(1);
};

main();
