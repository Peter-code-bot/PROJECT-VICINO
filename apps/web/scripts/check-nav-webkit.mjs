#!/usr/bin/env node
/**
 * Comprueba la barra inferior EN WEBKIT, que es el motor del iPhone.
 *
 *   node scripts/check-nav-webkit.mjs
 *   node scripts/check-nav-webkit.mjs --url http://localhost:3000
 *
 * POR QUE EXISTE. La app de movil es un WebView que carga vicinomarket.com, asi
 * que la barra "de iPhone" y la "de Android" son EL MISMO CSS. Pero eso es un
 * razonamiento, y el efecto de vidrio depende de propiedades que los dos
 * motores tratan distinto — `backdrop-filter` sin prefijo, `url()` dentro de
 * el, `env(safe-area-inset-*)`. Afirmar "se ve igual en los dos" sin abrirlo en
 * WebKit es exactamente la clase de suposicion que este proyecto paga cara.
 *
 * Requiere el binario: `pnpm exec playwright install webkit` (58 MB, aparte de
 * chromium, que es lo unico que instala `test:e2e:setup`).
 *
 * Sale 0 si la barra se pinta con su vidrio en los dos temas, 1 si no.
 */

import { webkit } from '@playwright/test';

const BASE_POR_DEFECTO = 'https://vicinomarket.com';
const VIEWPORT = { width: 375, height: 812 };

const leerBarra = () => {
  const nav = document.querySelector('nav[aria-label="Navegación principal"]');
  if (!nav) return { encontrada: false };
  const pildora = nav.querySelector('.liquid-nav');
  if (!pildora) return { encontrada: true, pildora: false };
  const cs = getComputedStyle(pildora);
  const caja = pildora.getBoundingClientRect();
  return {
    encontrada: true,
    pildora: true,
    tema: document.documentElement.classList.contains('dark') ? 'oscuro' : 'claro',
    alto: Math.round(caja.height),
    // -webkit-backdrop-filter es el que WebKit entiende. Si aqui sale "none",
    // el vidrio NO se esta pintando en el iPhone por mucho que se vea en el
    // portatil.
    desenfoque: cs.webkitBackdropFilter || cs.backdropFilter || 'none',
    tieneGradiente: cs.backgroundImage.startsWith('linear-gradient'),
    capasDeSombra: cs.boxShadow.split(/,(?![^(]*\))/).length,
    // El hueco bajo la barra: en un iPhone con indicador de inicio, esto tiene
    // que dejar sitio o la barra queda debajo del gesto del sistema.
    separacionDelBorde: Math.round(window.innerHeight - caja.bottom),
    enlaces: [...nav.querySelectorAll('a[href]')].map((a) => a.id || a.getAttribute('href')),
  };
};

const main = async () => {
  const args = process.argv.slice(2);
  const i = args.indexOf('--url');
  const base = i !== -1 ? args[i + 1] : BASE_POR_DEFECTO;

  const navegador = await webkit.launch();
  const problemas = [];

  try {
    for (const tema of ['light', 'dark']) {
      const contexto = await navegador.newContext({
        viewport: VIEWPORT,
        colorScheme: tema,
        // Sin sesion: es el caso que cualquiera puede reproducir.
        storageState: { cookies: [], origins: [] },
      });
      const pagina = await contexto.newPage();
      if (tema === 'dark') {
        // El tema de VICINO no sigue al sistema: sale de localStorage. Para ver
        // la variante oscura hay que pedirla como la pide la app.
        await pagina.addInitScript(() => {
          try {
            localStorage.setItem('vicino-theme', 'dark');
          } catch {}
        });
      }
      await pagina.goto(base, { waitUntil: 'networkidle' });
      const r = await pagina.evaluate(leerBarra);

      const etiqueta = `webkit ${tema}`;
      if (!r.encontrada) problemas.push(`${etiqueta}: no hay barra inferior`);
      else if (!r.pildora) problemas.push(`${etiqueta}: la barra existe pero sin .liquid-nav`);
      else {
        console.log(
          `  ${etiqueta.padEnd(14)} tema=${r.tema}  alto=${r.alto}  ` +
            `separacion=${r.separacionDelBorde}  sombras=${r.capasDeSombra}\n` +
            `  ${''.padEnd(14)} desenfoque=${r.desenfoque}\n` +
            `  ${''.padEnd(14)} enlaces=${r.enlaces.join(', ')}`,
        );
        if (r.desenfoque === 'none') {
          problemas.push(`${etiqueta}: SIN desenfoque — el vidrio no se pinta en el iPhone`);
        }
        if (r.desenfoque.includes('url(')) {
          problemas.push(
            `${etiqueta}: el filtro referencia url(), que WebKit ignora — invalida el filtro entero`,
          );
        }
        if (!r.tieneGradiente) problemas.push(`${etiqueta}: sin gradiente de cuerpo`);
        if (r.capasDeSombra < 4) problemas.push(`${etiqueta}: faltan capas de sombra`);
        if (r.separacionDelBorde < 8) {
          problemas.push(`${etiqueta}: la barra queda pegada al borde (${r.separacionDelBorde}px)`);
        }
      }
      await contexto.close();
    }
  } finally {
    await navegador.close();
  }

  if (problemas.length === 0) {
    console.log('\nLa barra se pinta con su vidrio en WebKit, en los dos temas.\n');
    process.exit(0);
  }
  console.log(`\n${problemas.length} problema(s) en WebKit:\n`);
  for (const p of problemas) console.log('  ' + p);
  console.log('');
  process.exit(1);
};

main().catch((error) => {
  process.stderr.write(`${error.message}\n`);
  process.exit(1);
});
