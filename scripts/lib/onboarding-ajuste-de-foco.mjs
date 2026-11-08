// keyboard-focus-390 del arnés del onboarding (scripts/test-onboarding-ui.mjs): el ajuste
// de foco de components/onboarding/onboarding-shell.tsx ante una bajada de la altura
// visible (390×844 → 390×560). Modo 'aislado': enfoca con preventScroll y mide solo ese
// efecto (lleva el criterio: radio, casilla y botón no se mueven; los campos conservan su
// ajuste). Modo 'toque': toca la tarjeta como lo haría una persona y solo registra, también
// si Chromium desplazó la ventana para mostrar un input sr-only.
// Ninguna aserción fija 68 ni 89 px: dependen de la geometría y del método de foco.

export const VIEWPORT_INICIAL = { width: 390, height: 844 };
const VIEWPORT_CON_TECLADO = { width: 390, height: 560 };
// Selector de 192876f (onboarding-shell.tsx:27): solo para saber si la regla vieja lo movería.
const SELECTOR_AJUSTE_192876F = "input, textarea, select, [contenteditable='true']";
const MARGEN_AJUSTE_PX = 8;

const redondear1 = (valor) => Math.round(valor * 10) / 10;
const dosCuadros = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
const unCuadro = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

async function esperarQuietud(page) {
  // La ventana y el scroll interno quietos 3 frames: el scroll suave de html puede seguir.
  await page.evaluate(() => new Promise((resolve) => {
    const scroll = document.querySelector('[data-onboarding-scroll]');
    let previo = '';
    let quietos = 0;
    const limite = performance.now() + 1500;
    const cuadro = () => {
      const actual = window.scrollY + ':' + (scroll ? scroll.scrollTop : '');
      quietos = actual === previo ? quietos + 1 : 0;
      previo = actual;
      if (quietos >= 3 || performance.now() > limite) resolve();
      else requestAnimationFrame(cuadro);
    };
    requestAnimationFrame(cuadro);
  }));
}

async function esperarPregunta(page) {
  // CompletarPerfil enfoca el h1 en un frame cuando la sesión queda lista: esperar a que los
  // controles estén habilitados y dejar pasar ese frame antes de enfocar nada.
  await page.waitForFunction(() => document.querySelector('[data-onboarding-scroll] :is(input,textarea,button)')?.matches(':enabled') === true);
  await dosCuadros(page);
}

async function bajarListaHasta(tarjeta) {
  // Solo el scroll interno, nunca la ventana: la tarjeta queda al fondo de la vista.
  await tarjeta.evaluate((elemento) => {
    const scroll = elemento.closest('[data-onboarding-scroll]');
    const b = scroll.getBoundingClientRect();
    const r = elemento.getBoundingClientRect();
    if (r.bottom > b.bottom - 16) scroll.scrollTop += r.bottom - (b.bottom - 16);
  });
}

async function opcionDeLista(page, selector, elegir) {
  // El input sr-only va dentro de su label: la label es la tarjeta que se ve y se toca.
  const opciones = page.locator(selector);
  const total = await opciones.count();
  const indice = Math.min(total - 1, Math.max(0, elegir(total)));
  const control = opciones.nth(indice);
  const tarjeta = control.locator('xpath=..');
  await bajarListaHasta(tarjeta);
  await esperarQuietud(page);
  return { tarjeta, control, detalle: { indice, total } };
}

async function medirVista(page) {
  return page.evaluate(() => {
    const redondear = (valor) => Math.round(valor * 10) / 10;
    const caja = (elemento) => {
      if (!elemento) return null;
      const r = elemento.getBoundingClientRect();
      return { top: redondear(r.top), bottom: redondear(r.bottom), height: redondear(r.height) };
    };
    const scroll = document.querySelector('[data-onboarding-scroll]');
    const activo = document.activeElement;
    const documento = document.scrollingElement || document.documentElement;
    const centro = document.elementFromPoint(innerWidth / 2, innerHeight / 2);
    const abajo = document.elementFromPoint(innerWidth / 2, innerHeight - 4);
    return {
      // position 'absolute' delata un input sr-only sin ancestro posicionado.
      activo: activo ? {
        tag: activo.localName,
        type: activo.getAttribute('type'),
        position: getComputedStyle(activo).position,
        esControl: activo.hasAttribute('data-prueba-control'),
        abreTeclado: window.__abreTeclado(activo),
      } : null,
      scrollTop: scroll ? redondear(scroll.scrollTop) : null,
      bounds: caja(scroll),
      tarjeta: caja(document.querySelector('[data-prueba-tarjeta]')),
      control: caja(document.querySelector('[data-prueba-control]')),
      ventanaScrollY: redondear(window.scrollY),
      documento: { scrollHeight: documento.scrollHeight, clientHeight: documento.clientHeight },
      contenedor: caja(document.getElementById('fixture-root')?.firstElementChild),
      // html o body en el centro o abajo: la persona vería el fondo, no la pregunta.
      puntoCentro: centro?.localName ?? null,
      puntoAbajo: abajo?.localName ?? null,
    };
  });
}

const volverVentanaArriba = (page) => page.evaluate(() => window.scrollTo({ top: 0, left: 0, behavior: 'instant' }));

/** Devuelve los números del caso; `fallas` vacío si cumple el criterio. */
export async function medirAjusteDeFoco(page, { caso, tipo, modo, preparar }) {
  const { tarjeta, control, detalle = null } = await preparar(page);
  await tarjeta.evaluate((elemento) => elemento.setAttribute('data-prueba-tarjeta', ''));
  await control.evaluate((elemento) => elemento.setAttribute('data-prueba-control', ''));
  const coincideReglaAnterior = await control.evaluate((elemento, selector) => elemento.matches(selector), SELECTOR_AJUSTE_192876F);
  const antesDelFoco = await medirVista(page);
  if (modo === 'aislado') await control.evaluate((elemento) => elemento.focus({ preventScroll: true }));
  else await tarjeta.tap();
  await esperarQuietud(page);
  const trasElFoco = await medirVista(page);
  // Si Chromium desplazó la ventana para mostrar el input enfocado, queda registrado y se
  // devuelve a 0 sin animación: con la pregunta fuera de pantalla, metrics() vería el pie tapado.
  const ventanaDesplazada = trasElFoco.ventanaScrollY !== 0;
  if (ventanaDesplazada) {
    await volverVentanaArriba(page);
    await esperarQuietud(page);
  }
  const antes = await medirVista(page);
  await page.setViewportSize(VIEWPORT_CON_TECLADO);
  await page.waitForFunction((alto) => document.querySelector('section[aria-labelledby]')?.getBoundingClientRect().bottom <= alto + 1, VIEWPORT_CON_TECLADO.height);
  await dosCuadros(page);
  const despues = await medirVista(page);
  await unCuadro(page);
  const estable = await medirVista(page);
  if (estable.ventanaScrollY !== 0) await volverVentanaArriba(page);
  return {
    caso, tipo, modo, metodoDeFoco: modo === 'aislado' ? 'focus({preventScroll:true})' : 'tap() en la tarjeta', detalle,
    coincideReglaAnterior, ventanaDesplazada, antesDelFoco, trasElFoco, antes, despues, estable,
    ...evaluarAjuste({ caso, tipo, modo, coincideReglaAnterior, antes, despues, estable }),
  };
}

/**
 * Criterio, sobre mediciones ya tomadas (función pura). `antes` es la vista con el control
 * enfocado y la altura completa; `despues`, 2 frames tras bajar la altura; `estable`, 1 más.
 */
export function evaluarAjuste({ caso, tipo, modo, coincideReglaAnterior, antes, despues, estable }) {
  if ([antes, despues, estable].some((vista) => typeof vista.scrollTop !== 'number')) {
    return { delta: null, derivaTrasMedir: null, fueraDelMargen: false, visibleDespues: false, discrimina: false, fallas: [`${caso}: no se encontró [data-onboarding-scroll]`] };
  }
  const delta = redondear1(despues.scrollTop - antes.scrollTop);
  const derivaTrasMedir = redondear1(estable.scrollTop - despues.scrollTop);
  // Sin ajuste el control seguiría donde estaba antes de bajar la altura: ¿quedaría fuera del margen?
  const fueraDelMargen = !!antes.control && !!despues.bounds
    && (antes.control.bottom > despues.bounds.bottom - MARGEN_AJUSTE_PX || antes.control.top < despues.bounds.top + MARGEN_AJUSTE_PX);
  const visibleDespues = !!despues.control && !!despues.bounds
    && despues.control.top >= despues.bounds.top - 1 && despues.control.bottom <= despues.bounds.bottom + 1;
  // Solo si la regla de 192876f lo habría movido el caso prueba el arreglo; si no, es un control.
  const discrimina = tipo === 'control' && coincideReglaAnterior && fueraDelMargen;
  const fallas = [];
  if (Math.abs(derivaTrasMedir) > 1) fallas.push(`${caso}: el scroll siguió moviéndose después de medir (${derivaTrasMedir} px)`);
  if (modo === 'aislado') {
    if (!antes.activo?.esControl) fallas.push(`${caso}: el control no recibió el foco`);
    if (tipo === 'control' && Math.abs(delta) > 1) fallas.push(`${caso}: el ajuste movió ${delta} px un control que no abre teclado`);
    if (tipo === 'campo' && fueraDelMargen && delta <= 1) fallas.push(`${caso}: el campo necesitaba ajuste y no se movió`);
    if (tipo === 'campo' && !fueraDelMargen && Math.abs(delta) > 1) fallas.push(`${caso}: el campo se movió ${delta} px sin necesitarlo`);
    if (tipo === 'campo' && !visibleDespues) fallas.push(`${caso}: el campo enfocado no quedó visible`);
  }
  return { delta, derivaTrasMedir, fueraDelMargen, visibleDespues, discrimina, fallas };
}

/** `esperarIdDisponible` es availableUsername del arnés (el paso Usuario carga sugerencias). */
export function casosAjusteDeFoco({ esperarIdDisponible }) {
  const campo = (paso, etiqueta) => ({
    caso: `${paso}-campo`, tipo: 'campo', ruta: `/completar-perfil/${paso}?camino=explorar`, modos: ['aislado', 'toque'],
    preparar: async (page) => {
      if (paso === 'usuario') await esperarIdDisponible(page);
      await esperarPregunta(page);
      const control = page.getByLabel(etiqueta, { exact: true });
      return { tarjeta: control, control };
    },
  });
  return [
    // Controles: no abren teclado, el ajuste no debe moverlos.
    { caso: 'bienvenida-radio', tipo: 'control', ruta: '/bienvenida', modos: ['aislado', 'toque'], preparar: async (page) => {
      await esperarPregunta(page);
      return { tarjeta: page.getByText('Quiero vender', { exact: true }), control: page.locator('input[type=radio][value=vender]') };
    } },
    { caso: 'categoria-radio', tipo: 'control', ruta: '/completar-perfil/categoria?camino=vender', modos: ['aislado', 'toque'], preparar: async (page) => {
      await esperarPregunta(page);
      // Una opción de la mitad inferior de la lista, después de bajarla.
      return opcionDeLista(page, '[data-onboarding-scroll] input[type=radio]', (total) => Math.floor(total * 0.75));
    } },
    { caso: 'tipo-radio', tipo: 'control', ruta: '/completar-perfil/tipo?camino=vender', modos: ['aislado', 'toque'], preparar: async (page) => {
      await esperarPregunta(page);
      return { tarjeta: page.getByText('Negocio', { exact: true }), control: page.locator('input[type=radio][value=business]') };
    } },
    { caso: 'pagos-casilla', tipo: 'control', ruta: '/completar-perfil/pagos?camino=vender&tipo=business', modos: ['aislado', 'toque'], preparar: async (page) => {
      await esperarPregunta(page);
      await page.getByRole('button', { name: 'Selecciona métodos de pago...', exact: true }).click();
      // El desplegable abre con una transición de 300 ms (grid-rows y opacidad).
      await page.waitForFunction(() => {
        const grid = document.querySelector('[data-onboarding-scroll] input[type=checkbox]')?.closest('.grid');
        return !!grid && getComputedStyle(grid).opacity === '1';
      });
      await dosCuadros(page);
      return opcionDeLista(page, '[data-onboarding-scroll] input[type=checkbox]', (total) => total - 2);
    } },
    { caso: 'sugerencia-boton', tipo: 'control', ruta: '/completar-perfil/usuario?camino=explorar', modos: ['aislado'], preparar: async (page) => {
      // Solo se enfoca: pulsarla cambiaría el ID y lanzaría consultas.
      await esperarIdDisponible(page);
      await esperarPregunta(page);
      const control = page.getByRole('button', { name: '@javier_1001', exact: true });
      return { tarjeta: control, control };
    } },
    // Campos: abren teclado y conservan su ajuste.
    campo('usuario', 'ID de usuario'),
    campo('nombre', 'Tu nombre'),
    campo('descripcion', 'Tu descripción'),
  ];
}

/** Resumen corto para la consola; el detalle completo queda en el JSON de resultados. */
export function resumirAjusteDeFoco(results) {
  return results.filter((result) => result.medicion?.caso).map(({ name, passed, medicion: m }) => ({
    name, passed, delta: m.delta, discrimina: m.discrimina, fueraDelMargen: m.fueraDelMargen,
    activoTrasElFoco: m.trasElFoco.activo && [m.trasElFoco.activo.tag, m.trasElFoco.activo.type, m.trasElFoco.activo.position].filter(Boolean).join(':'),
    ventanaScrollYTrasElFoco: m.trasElFoco.ventanaScrollY,
    puntosTrasElFoco: `${m.trasElFoco.puntoCentro}/${m.trasElFoco.puntoAbajo}`,
  }));
}
