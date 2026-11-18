import type { Page } from "@playwright/test";
import type { ElementoEnfocado } from "../../lib/onboarding/abre-teclado";

/**
 * Traza de vista para diagnosticar saltos de pantalla y franjas en blanco
 * (BUG-AND-VIEW). Solo vive en pruebas: nunca se importa desde la app.
 *
 * - Pruebas: `instalarAntesDeNavegar(page)` antes del goto, o `instalarAhora(page)`
 *   después de un `setContent` (ahí un init script ya no correría).
 * - Dispositivo (chrome://inspect): imprimir la fuente con
 *   `node -e "import('./apps/web/tests/helpers/view-trace.ts').then(m=>console.log(m.FUENTE_TRAZA_VISTA))"`
 *   y pegarla en la consola. Se pasa como texto: nunca como fn.toString() de código
 *   cargado con tsx, que inyecta `__name(...)` y rompe en el navegador.
 *
 * Apagada hasta `window.__vicinoViewTrace.start()`: antes no hay listeners,
 * observers ni frames. Guarda un anillo de 3000 eventos en memoria y no usa red.
 * Nunca guarda textos, valores, id, clases, name, placeholder, aria-*, alt, href,
 * URLs ni parámetros: la ruta va como categoría de una lista cerrada y las x/y
 * son de pantalla, redondeadas. Listeners pasivos y en captura (salvo uno de
 * burbuja que solo mira si el clic volvió a window); nunca llaman a
 * preventDefault ni a stopPropagation. Sintaxis hasta ES2020 para WebView viejos.
 */
export const FUENTE_TRAZA_VISTA = String.raw`(function () {
  "use strict";
  if (typeof window === "undefined" || window.__vicinoViewTrace) return;

  // Copias de TAB_ROUTES (lib/navigation/tab-routes.ts) y PASOS_ONBOARDING
  // (lib/onboarding/steps.ts); scripts/test-view-trace.ts falla si divergen.
  var RUTAS_PESTANA = ["/", "/buscar", "/chat", "/perfil"];
  var PASOS_ONBOARDING = ["categoria", "tipo", "usuario", "nombre", "foto", "descripcion", "pagos", "intereses", "ubicacion", "notificaciones", "listo"];
  var RUTAS_FIJAS = [["/bienvenida", "onboarding:bienvenida"], ["/empezar-a-vender", "empezar-a-vender"]];
  var PREFIJO_PASO = "/completar-perfil/";
  // COPIA de TIPOS_CON_TECLADO (lib/onboarding/abre-teclado.ts), solo para leer la traza a
  // mano en el dispositivo; scripts/test-view-trace.ts falla si diverge de abreTeclado.
  var TIPOS_CON_TECLADO = ["text", "email", "number", "search", "tel", "url", "password"];
  var CAPACIDAD = 3000;
  var VENTANA_TRANSFORM_MS = 500;
  var LIMITE_TRANSFORM_MS = 10000;
  var SONDA_CADA_MS = 100;
  var SONDA_DURANTE_MS = 1000;
  var REBUSCAR_SCROLLER_MS = 250;
  var PROFUNDIDAD_MAXIMA = 40;
  var MOVIMIENTO_MINIMO_PX = 0.05;
  var ROL_VALIDO = /^[a-z]{1,20}$/;
  var MARCA_VALIDA = /^[a-z0-9_-]{1,32}$/i;
  // [fracción del ancho visible, distancia al borde inferior visible en px]; null = centro.
  var PUNTOS_SONDA = [[0.1, 4], [0.5, 4], [0.9, 4], [0.5, 24], [0.5, null]];

  var anillo = [];
  var inicioAnillo = 0;
  var total = 0;
  var sondas = 0;
  var errores = 0;
  var activa = false;
  var epoch = null;
  var limpiezas = [];
  var cuadroPendiente = 0;
  var intervaloSonda = 0;
  var sondaHasta = 0;
  var sondaPendiente = null;
  var observador = null;
  var muestreo = null;
  var ultimo = {};
  var primerToque = true;
  var scrollerGuardado = null;
  var scrollerBuscadoEn = -Infinity;
  var propagados = typeof WeakSet === "function" ? new WeakSet() : null;

  function ahora() { return Math.round(window.performance.now()); }
  function entero(valor) { return typeof valor === "number" && isFinite(valor) ? Math.round(valor) : null; }
  function decimal(valor) { return typeof valor === "number" && isFinite(valor) ? Math.round(valor * 10) / 10 : null; }
  function fallo() { errores += 1; }

  function registrar(evento, t) {
    if (!activa) return;
    var entrada = Object.freeze(Object.assign({ t: typeof t === "number" ? t : ahora() }, evento));
    if (anillo.length < CAPACIDAD) anillo.push(entrada);
    else { anillo[inicioAnillo] = entrada; inicioAnillo = (inicioAnillo + 1) % CAPACIDAD; }
    total += 1;
  }

  function eventos() { return anillo.slice(inicioAnillo).concat(anillo.slice(0, inicioAnillo)); }

  function escuchar(objetivo, tipo, manejador, enCaptura) {
    if (!objetivo || typeof objetivo.addEventListener !== "function") return;
    var opciones = { capture: enCaptura !== false, passive: true };
    objetivo.addEventListener(tipo, manejador, opciones);
    limpiezas.push(function () { objetivo.removeEventListener(tipo, manejador, opciones); });
  }

  function categoriaDeRuta(ruta) {
    if (typeof ruta !== "string" || !ruta) return "[dinamica]";
    var limpia = ruta.length > 1 && ruta.charAt(ruta.length - 1) === "/" ? ruta.slice(0, -1) : ruta;
    if (RUTAS_PESTANA.indexOf(limpia) >= 0) return limpia;
    for (var i = 0; i < RUTAS_FIJAS.length; i += 1) if (RUTAS_FIJAS[i][0] === limpia) return RUTAS_FIJAS[i][1];
    if (limpia.indexOf(PREFIJO_PASO) === 0) {
      var paso = limpia.slice(PREFIJO_PASO.length);
      if (PASOS_ONBOARDING.indexOf(paso) >= 0) return "onboarding:" + paso;
    }
    return "[dinamica]";
  }

  function esElemento(nodo) { return !!nodo && nodo.nodeType === 1; }
  function elementoDe(nodo) {
    if (esElemento(nodo)) return nodo;
    return nodo && esElemento(nodo.parentElement) ? nodo.parentElement : null;
  }
  function dentroDe(el, selector) {
    try { return !!(el.closest && el.closest(selector)); } catch (e) { fallo(); return false; }
  }
  function coincide(el, selector) {
    try { return !!(el.matches && el.matches(selector)); } catch (e) { fallo(); return false; }
  }
  function tipoDeControl(el) {
    var nombre = el.localName;
    if (nombre !== "input" && nombre !== "button" && nombre !== "select" && nombre !== "textarea") return null;
    // La propiedad IDL normaliza a una lista cerrada (un type desconocido da "text").
    return typeof el.type === "string" ? el.type : null;
  }
  function rolDe(el) {
    var rol = typeof el.getAttribute === "function" ? el.getAttribute("role") : null;
    if (!rol) return null;
    return ROL_VALIDO.test(rol) ? rol : "otro";
  }
  function descriptor(nodo) {
    var el = elementoDe(nodo);
    if (!el) return { tag: nodo === window.document ? "document" : nodo === window ? "window" : "nada" };
    return {
      tag: el.localName,
      type: tipoDeControl(el),
      role: rolDe(el),
      noPageSwipe: dentroDe(el, "[data-no-page-swipe]"),
      enOnboardingScroll: dentroDe(el, "[data-onboarding-scroll]")
    };
  }
  function cajaDe(el) {
    try {
      var r = el.getBoundingClientRect();
      return { top: entero(r.top), bottom: entero(r.bottom), height: entero(r.height) };
    } catch (e) { fallo(); return null; }
  }
  function descriptorFoco(nodo) {
    var base = descriptor(nodo);
    var el = elementoDe(nodo);
    if (!el) return base;
    var position = null;
    try { position = window.getComputedStyle(el).position; } catch (e) { fallo(); }
    var scroller = null;
    try { scroller = el.closest ? el.closest("[data-onboarding-scroll]") : null; } catch (e) { fallo(); }
    var dentroDeBounds = null;
    if (scroller) {
      var r = cajaDe(el);
      var b = cajaDe(scroller);
      dentroDeBounds = !!(r && b) && r.top >= b.top - 1 && r.bottom <= b.bottom + 1;
    }
    // Lo que necesita abreTeclado (lib/onboarding/abre-teclado.ts), más su resultado (copia).
    var campos = {
      readOnly: el.readOnly === true,
      disabled: coincide(el, ":disabled"),
      inputMode: typeof el.inputMode === "string" ? el.inputMode.toLowerCase() : "",
      isContentEditable: el.isContentEditable === true
    };
    return Object.assign({}, base, campos, {
      abreTeclado: abreTecladoCopia(base.tag, base.type, campos),
      position: position,
      dentroDeBounds: dentroDeBounds
    });
  }
  // COPIA de abreTeclado (lib/onboarding/abre-teclado.ts) para leer la traza a mano.
  function abreTecladoCopia(tag, tipo, campos) {
    if (campos.readOnly || campos.inputMode === "none" || campos.disabled) return false;
    if (tag === "input") return TIPOS_CON_TECLADO.indexOf(String(tipo || "text").toLowerCase()) >= 0;
    if (tag === "textarea") return true;
    return campos.isContentEditable;
  }

  function documento() {
    var d = window.document;
    var raiz = d.scrollingElement || d.documentElement;
    return {
      scrollY: entero(window.scrollY),
      docScrollHeight: raiz ? entero(raiz.scrollHeight) : null,
      docClientHeight: raiz ? entero(raiz.clientHeight) : null
    };
  }
  function tecladoNativo() {
    var d = window.document;
    var abierto = !!(d.body && d.body.classList && d.body.classList.contains("keyboard-open"));
    var alto = null;
    try { alto = entero(parseFloat(d.documentElement.style.getPropertyValue("--keyboard-height"))); } catch (e) { fallo(); }
    return { abierto: abierto, alto: alto };
  }
  function medidasVista() {
    var vv = window.visualViewport;
    var raiz = window.document.documentElement;
    return {
      vvAlto: vv ? decimal(vv.height) : null,
      vvAncho: vv ? decimal(vv.width) : null,
      vvOffsetTop: vv ? decimal(vv.offsetTop) : null,
      vvOffsetLeft: vv ? decimal(vv.offsetLeft) : null,
      vvEscala: vv && typeof vv.scale === "number" ? Math.round(vv.scale * 1000) / 1000 : null,
      innerHeight: entero(window.innerHeight),
      innerWidth: entero(window.innerWidth),
      clientHeight: raiz ? entero(raiz.clientHeight) : null,
      tecladoNativo: tecladoNativo()
    };
  }
  function coincideMedia(consulta) {
    try { return typeof window.matchMedia === "function" ? window.matchMedia(consulta).matches === true : null; }
    catch (e) { fallo(); return null; }
  }
  function temaOscuro() {
    var raiz = window.document.documentElement;
    return !!(raiz && raiz.classList && raiz.classList.contains("dark"));
  }
  function preferencias() {
    return {
      reducirMovimiento: coincideMedia("(prefers-reduced-motion: reduce)"),
      sistemaOscuro: coincideMedia("(prefers-color-scheme: dark)"),
      temaOscuro: temaOscuro()
    };
  }

  function buscarScroller() {
    var t = ahora();
    if (scrollerGuardado && scrollerGuardado.isConnected !== false) return scrollerGuardado;
    if (t - scrollerBuscadoEn < REBUSCAR_SCROLLER_MS) return null;
    scrollerBuscadoEn = t;
    scrollerGuardado = window.document.querySelector("[data-onboarding-scroll]");
    return scrollerGuardado;
  }
  function contenedorDe(scroller) {
    if (!scroller || !scroller.closest) return null;
    var seccion = scroller.closest("section");
    return seccion ? seccion.parentElement : null;
  }

  // Transform de los ancestros del objetivo: durante el toque y 500 ms después.
  function traslacion(valor) {
    if (!valor || valor === "none") return [0, 0];
    var partes = /^matrix(3d)?\(([^)]*)\)$/.exec(valor);
    if (!partes) return [0, 0];
    var numeros = partes[2].split(",").map(function (parte) { return parseFloat(parte); });
    var tx = partes[1] ? numeros[12] : numeros[4];
    var ty = partes[1] ? numeros[13] : numeros[5];
    return [isFinite(tx) ? tx : 0, isFinite(ty) ? ty : 0];
  }
  function iniciarMuestreo(objetivo, t) {
    if (muestreo) emitirTransform();
    var cadena = [];
    var raiz = window.document.documentElement;
    var nodo = elementoDe(objetivo);
    for (var profundidad = 0; nodo && nodo !== raiz && profundidad < PROFUNDIDAD_MAXIMA; profundidad += 1) {
      cadena.push({ el: nodo, profundidad: profundidad, tag: nodo.localName, maxTx: 0, maxTy: 0 });
      nodo = nodo.parentElement;
    }
    muestreo = { desde: t, hasta: null, muestras: 0, cadena: cadena };
    muestrearTransform();
  }
  function muestrearTransform() {
    if (!muestreo) return;
    var cadena = muestreo.cadena.map(function (eslabon) {
      var valor = null;
      try { valor = window.getComputedStyle(eslabon.el).transform; } catch (e) { fallo(); }
      var par = traslacion(valor);
      return Object.assign({}, eslabon, {
        maxTx: Math.max(eslabon.maxTx, Math.abs(par[0])),
        maxTy: Math.max(eslabon.maxTy, Math.abs(par[1]))
      });
    });
    muestreo = Object.assign({}, muestreo, { cadena: cadena, muestras: muestreo.muestras + 1 });
  }
  function cerrarMuestreo(t) {
    if (muestreo && muestreo.hasta === null) muestreo = Object.assign({}, muestreo, { hasta: t + VENTANA_TRANSFORM_MS });
  }
  function emitirTransform() {
    if (!muestreo) return;
    var terminado = muestreo;
    muestreo = null;
    registrar({
      tipo: "transform",
      desde: terminado.desde,
      muestras: terminado.muestras,
      ancestros: terminado.cadena
        .filter(function (eslabon) { return eslabon.maxTx > MOVIMIENTO_MINIMO_PX || eslabon.maxTy > MOVIMIENTO_MINIMO_PX; })
        .map(function (eslabon) {
          return { profundidad: eslabon.profundidad, tag: eslabon.tag, maxTx: decimal(eslabon.maxTx), maxTy: decimal(eslabon.maxTy) };
        })
    });
  }

  // Sonda de blanco, en coordenadas del viewport VISUAL (un offsetTop > 0 deja la franja abajo).
  function vistaVisual() {
    var vv = window.visualViewport;
    return vv
      ? { ancho: vv.width, alto: vv.height, x0: vv.offsetLeft || 0, y0: vv.offsetTop || 0 }
      : { ancho: window.innerWidth, alto: window.innerHeight, x0: 0, y0: 0 };
  }
  function esVacio(el) {
    var d = window.document;
    return !el || el === d.documentElement || el === d.body;
  }
  function altoEnBlanco(v) {
    var d = window.document;
    var x = v.x0 + v.ancho / 2;
    var fondo = v.y0 + v.alto;
    if (!esVacio(d.elementFromPoint(x, fondo - 4))) return 0;
    for (var y = fondo - 12; y >= v.y0; y -= 8) if (!esVacio(d.elementFromPoint(x, y))) return entero(fondo - y);
    return entero(v.alto);
  }
  function sondear(motivo) {
    var d = window.document;
    var v = vistaVisual();
    if (typeof d.elementFromPoint !== "function" || !(v.alto > 0) || !(v.ancho > 0)) return;
    sondas += 1;
    var vacios = [];
    for (var i = 0; i < PUNTOS_SONDA.length; i += 1) {
      var fraccion = PUNTOS_SONDA[i][0];
      var distancia = PUNTOS_SONDA[i][1];
      var y = distancia === null ? v.y0 + v.alto / 2 : v.y0 + v.alto - distancia;
      var el = d.elementFromPoint(v.x0 + fraccion * v.ancho, y);
      if (esVacio(el)) vacios.push({ f: fraccion, k: distancia === null ? "centro" : distancia, tag: el ? el.localName : "nada" });
    }
    if (!vacios.length) return;
    registrar(Object.assign({ tipo: "blank", motivo: motivo, puntos: vacios, altoEstimado: altoEnBlanco(v) }, medidasVista(), documento()));
  }
  function pedirSonda(motivo) { if (!sondaPendiente) sondaPendiente = motivo; }
  function sondasTrasToque() {
    sondaHasta = ahora() + SONDA_DURANTE_MS;
    if (intervaloSonda) return;
    intervaloSonda = window.setInterval(function () {
      if (!activa || ahora() > sondaHasta) { window.clearInterval(intervaloSonda); intervaloSonda = 0; return; }
      sondear("tras-toque");
    }, SONDA_CADA_MS);
  }

  function alToque(evento) {
    var t = ahora();
    var tipo = evento.type;
    var final = tipo === "touchend" || tipo === "touchcancel";
    var lista = final ? evento.changedTouches : evento.touches;
    var toque = lista && lista.length ? lista[0] : null;
    var base = {
      tipo: tipo,
      toques: evento.touches ? evento.touches.length : null,
      x: toque ? entero(toque.clientX) : null,
      y: toque ? entero(toque.clientY) : null,
      cancelable: evento.cancelable === true,
      objetivo: tipo === "touchmove" ? undefined : descriptor(evento.target)
    };
    if (tipo === "touchstart") {
      if (primerToque) { primerToque = false; registrar({ tipo: "mark", nombre: "primer-toque" }, t); }
      iniciarMuestreo(evento.target, t);
    }
    if (final) { cerrarMuestreo(t); sondasTrasToque(); }
    // defaultPrevented se lee cuando el evento terminó de despacharse.
    window.setTimeout(function () { registrar(Object.assign({}, base, { defaultPrevented: evento.defaultPrevented === true }), t); }, 0);
  }
  function alClicCaptura(evento) {
    var t = ahora();
    var base = { tipo: "clic", objetivo: descriptor(evento.target), detail: entero(evento.detail) };
    window.setTimeout(function () {
      registrar(Object.assign({}, base, {
        propagado: propagados ? propagados.has(evento) : null,
        cancelado: evento.defaultPrevented === true
      }), t);
    }, 0);
  }
  function alClicBurbuja(evento) { if (propagados) propagados.add(evento); }
  function alFoco(evento) { registrar({ tipo: evento.type, objetivo: descriptorFoco(evento.target) }); }
  function alViewportVisual(evento) {
    registrar(Object.assign({ tipo: "viewport", origen: "vv-" + evento.type }, medidasVista(), documento()));
    pedirSonda("vv-" + evento.type);
  }
  function alResizeVentana() {
    registrar(Object.assign({ tipo: "viewport", origen: "ventana-resize" }, medidasVista(), documento()));
    pedirSonda("ventana-resize");
  }
  function alScroll(evento) {
    // Los scroll de elementos se muestrean por frame; aquí solo el de la ventana dispara la sonda.
    if (evento.target === window.document || evento.target === window) pedirSonda("scroll-ventana");
  }
  function alVisibilidad() { registrar({ tipo: "visibilidad", estado: window.document.visibilityState }); }
  function alPageshow(evento) { registrar({ tipo: "pageshow", persisted: evento.persisted === true }); }

  function escucharMedia(consulta) {
    if (typeof window.matchMedia !== "function") return;
    var lista = null;
    try { lista = window.matchMedia(consulta); } catch (e) { fallo(); return; }
    var manejador = function () { registrar(Object.assign({ tipo: "preferencias" }, preferencias())); };
    if (typeof lista.addEventListener === "function") {
      lista.addEventListener("change", manejador);
      limpiezas.push(function () { lista.removeEventListener("change", manejador); });
    } else if (typeof lista.addListener === "function") {
      lista.addListener(manejador);
      limpiezas.push(function () { lista.removeListener(manejador); });
    }
  }
  function observarLayoutShift() {
    if (typeof window.PerformanceObserver !== "function") return;
    try {
      observador = new window.PerformanceObserver(function (lista) {
        var entradas = lista.getEntries();
        for (var i = 0; i < entradas.length; i += 1) {
          var entrada = entradas[i];
          // Solo valor, hadRecentInput y cuántos nodos se movieron: nunca los nodos.
          registrar({
            tipo: "layout-shift",
            valor: Math.round((entrada.value || 0) * 10000) / 10000,
            hadRecentInput: entrada.hadRecentInput === true,
            fuentes: entrada.sources ? entrada.sources.length : 0
          }, entero(entrada.startTime) === null ? undefined : entero(entrada.startTime));
        }
      });
      observador.observe({ type: "layout-shift", buffered: false });
    } catch (e) { fallo(); observador = null; }
  }

  function cuadro() {
    cuadroPendiente = 0;
    if (!activa) return;
    var ruta = categoriaDeRuta(window.location.pathname);
    if (ruta !== ultimo.ruta) {
      ultimo = Object.assign({}, ultimo, { ruta: ruta });
      registrar({ tipo: "ruta", categoria: ruta });
      pedirSonda("ruta");
    }
    var scroller = buscarScroller();
    var scrollY = entero(window.scrollY);
    var scrollTop = scroller ? entero(scroller.scrollTop) : null;
    if (scrollY !== ultimo.scrollY || scrollTop !== ultimo.scrollTop) {
      ultimo = Object.assign({}, ultimo, { scrollY: scrollY, scrollTop: scrollTop });
      registrar(Object.assign({ tipo: "scroll", interno: scrollTop }, documento()));
    }
    var contenedor = contenedorDe(scroller);
    var caja = contenedor ? cajaDe(contenedor) : null;
    var clave = caja ? caja.top + ":" + caja.bottom + ":" + caja.height : "";
    if (clave !== ultimo.contenedor) {
      ultimo = Object.assign({}, ultimo, { contenedor: clave });
      if (caja) registrar(Object.assign({ tipo: "contenedor" }, caja));
    }
    var oscuro = temaOscuro();
    if (oscuro !== ultimo.temaOscuro) {
      var primera = ultimo.temaOscuro === undefined;
      ultimo = Object.assign({}, ultimo, { temaOscuro: oscuro });
      if (!primera) registrar(Object.assign({ tipo: "preferencias" }, preferencias()));
    }
    var teclado = tecladoNativo();
    if (teclado.abierto !== ultimo.tecladoAbierto) {
      ultimo = Object.assign({}, ultimo, { tecladoAbierto: teclado.abierto });
      registrar({ tipo: "teclado-nativo", abierto: teclado.abierto, alto: teclado.alto });
    }
    if (muestreo) {
      muestrearTransform();
      var t = ahora();
      if ((muestreo.hasta !== null && t >= muestreo.hasta) || t - muestreo.desde > LIMITE_TRANSFORM_MS) emitirTransform();
    }
    if (sondaPendiente) {
      var motivo = sondaPendiente;
      sondaPendiente = null;
      sondear(motivo);
    }
    cuadroPendiente = window.requestAnimationFrame(cuadro);
  }

  function iniciar() {
    if (activa) return true;
    if (window.top !== window) return false;
    activa = true;
    epoch = Date.now();
    primerToque = true;
    ultimo = {};
    registrar(Object.assign({ tipo: "inicio", ruta: categoriaDeRuta(window.location.pathname) }, preferencias(), medidasVista(), documento()));
    ["touchstart", "touchmove", "touchend", "touchcancel"].forEach(function (tipo) { escuchar(window, tipo, alToque); });
    escuchar(window, "click", alClicCaptura);
    escuchar(window, "click", alClicBurbuja, false);
    escuchar(window, "focusin", alFoco);
    escuchar(window, "focusout", alFoco);
    escuchar(window.visualViewport, "resize", alViewportVisual);
    escuchar(window.visualViewport, "scroll", alViewportVisual);
    escuchar(window, "resize", alResizeVentana);
    escuchar(window, "scroll", alScroll);
    escuchar(window.document, "visibilitychange", alVisibilidad);
    escuchar(window, "pageshow", alPageshow);
    escucharMedia("(prefers-reduced-motion: reduce)");
    escucharMedia("(prefers-color-scheme: dark)");
    observarLayoutShift();
    cuadroPendiente = window.requestAnimationFrame(cuadro);
    return true;
  }
  function detener() {
    if (!activa) return;
    emitirTransform();
    registrar({ tipo: "fin" });
    activa = false;
    var pendientes = limpiezas;
    limpiezas = [];
    for (var i = 0; i < pendientes.length; i += 1) { try { pendientes[i](); } catch (e) { fallo(); } }
    if (cuadroPendiente) { window.cancelAnimationFrame(cuadroPendiente); cuadroPendiente = 0; }
    if (intervaloSonda) { window.clearInterval(intervaloSonda); intervaloSonda = 0; }
    if (observador) { try { observador.disconnect(); } catch (e) { fallo(); } observador = null; }
    muestreo = null;
    sondaPendiente = null;
    scrollerGuardado = null;
    scrollerBuscadoEn = -Infinity;
  }
  function limpiar() {
    anillo = [];
    inicioAnillo = 0;
    total = 0;
    sondas = 0;
    errores = 0;
  }
  function marcar(nombre) {
    if (!activa || typeof nombre !== "string" || !MARCA_VALIDA.test(nombre)) return false;
    registrar({ tipo: "mark", nombre: nombre });
    return true;
  }
  function volcar() {
    return JSON.stringify({
      version: 1,
      activa: activa,
      epoch: epoch,
      capacidad: CAPACIDAD,
      total: total,
      descartados: Math.max(0, total - anillo.length),
      sondas: sondas,
      errores: errores,
      eventos: eventos()
    });
  }

  var api = Object.freeze({ start: iniciar, stop: detener, clear: limpiar, mark: marcar, dump: volcar });
  try { Object.defineProperty(window, "__vicinoViewTrace", { value: api, configurable: true, enumerable: false, writable: false }); }
  catch (e) { window.__vicinoViewTrace = api; }
})();
`;

export interface ApiTrazaVista {
  start(): boolean;
  stop(): void;
  clear(): void;
  mark(nombre: string): boolean;
  dump(): string;
}

export interface EventoTraza {
  t: number;
  tipo: string;
  [campo: string]: unknown;
}

export interface VolcadoTraza {
  version: number;
  activa: boolean;
  epoch: number | null;
  capacidad: number;
  total: number;
  descartados: number;
  sondas: number;
  errores: number;
  eventos: EventoTraza[];
}

/** Lo que la traza guarda del elemento en focusin y focusout. */
export interface DescriptorFoco {
  tag: string;
  type: string | null;
  role: string | null;
  noPageSwipe: boolean;
  enOnboardingScroll: boolean;
  readOnly: boolean;
  disabled: boolean;
  inputMode: string;
  isContentEditable: boolean;
  /** Copia de la regla para leer a mano; en pruebas, usar abreTeclado(comoElementoEnfocado(...)). */
  abreTeclado: boolean;
  /** "absolute" delata un input sr-only sin ancestro posicionado. */
  position: string | null;
  dentroDeBounds: boolean | null;
}

/**
 * Para aplicar abreTeclado (lib/onboarding/abre-teclado.ts) a un focusin de la
 * traza sin copiar la regla: `abreTeclado(comoElementoEnfocado(evento.objetivo))`.
 */
export function comoElementoEnfocado(descriptor: DescriptorFoco): ElementoEnfocado {
  return {
    localName: descriptor.tag,
    type: descriptor.type ?? undefined,
    readOnly: descriptor.readOnly,
    inputMode: descriptor.inputMode,
    isContentEditable: descriptor.isContentEditable,
    matches: (selector: string) => selector === ":disabled" && descriptor.disabled,
  };
}

export type VentanaConTraza = Window & { __vicinoViewTrace?: ApiTrazaVista };

/** Arnés: corre en cada documento nuevo, antes que los scripts de la página. */
export async function instalarAntesDeNavegar(page: Page): Promise<void> {
  await page.addInitScript({ content: FUENTE_TRAZA_VISTA });
}

/** Fixtures montados con setContent: un init script registrado después ya no correría. */
export async function instalarAhora(page: Page): Promise<void> {
  await page.addScriptTag({ content: FUENTE_TRAZA_VISTA });
}

export async function iniciarTraza(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const traza = (window as VentanaConTraza).__vicinoViewTrace;
    if (!traza) throw new Error("La traza de vista no está instalada en esta página.");
    return traza.start();
  });
}

export async function detenerTraza(page: Page): Promise<void> {
  await page.evaluate(() => { (window as VentanaConTraza).__vicinoViewTrace?.stop(); });
}

export async function limpiarTraza(page: Page): Promise<void> {
  await page.evaluate(() => { (window as VentanaConTraza).__vicinoViewTrace?.clear(); });
}

export async function leerTraza(page: Page): Promise<VolcadoTraza> {
  const json = await page.evaluate(() => {
    const traza = (window as VentanaConTraza).__vicinoViewTrace;
    if (!traza) throw new Error("La traza de vista no está instalada en esta página.");
    return traza.dump();
  });
  return JSON.parse(json) as VolcadoTraza;
}
