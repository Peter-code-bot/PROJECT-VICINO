/**
 * MapKit falso para los E2E del staging (S05-cuenta-sintetica).
 *
 * En local MapKit no carga de verdad: no hay APPLE_MAPKIT_* en .env.local y
 * /api/mapkit/token solo firma para localhost:3000. Esto sustituye, DENTRO del
 * contexto de Playwright, las dos piezas que usa apps/web/hooks/use-mapkit.ts:
 *
 *   - GET /api/mapkit/token          -> 200 {"token":"fixture"}
 *   - https://cdn.apple-mapkit.com/mk/5.x.x/mapkit.js -> un SDK de juguete
 *
 * El script va con Access-Control-Allow-Origin: * porque use-mapkit.ts lo
 * inyecta con crossOrigin="anonymous": sin esa cabecera el navegador lo
 * rechaza, el buscador se queda deshabilitado y el fallo parece de la app.
 *
 * El SDK cubre solo lo que la app llama (ver use-mapkit.ts, location-search.ts,
 * apple-geocoder.ts y components/map/apple-map-container.tsx), con las mismas
 * formas de callback (error, data). Mismo molde que el SDK falso de
 * scripts/test-s05-map-browser.ts. Para los gestos expone en la pagina:
 *
 *   window.__mk.tocar(lat, lng)     single-tap en el mapa vivo
 *   window.__mk.arrastrar(lat, lng) drag-end del marcador del mapa vivo
 *   window.__mk.pin()               [lat, lng] del marcador del mapa vivo
 *
 * Lo que esto NO acredita: MapKit real, teselas, pinza, ni el tacto en iPhone.
 */

/** Consultas del buscador. `consulta` se compara sin acentos ni mayusculas. */
export const LUGARES = [
  { consulta: 'villahermosa', displayLines: ['Villahermosa', 'Tabasco, México'], lat: 17.9892, lng: -92.9281, countryCode: 'MX' },
  { consulta: 'merida', displayLines: ['Mérida', 'Yucatán, México'], lat: 20.9674, lng: -89.5926, countryCode: 'MX' },
];

/** Geocodificacion inversa: gana el sitio mas cercano dentro de `radioKm`. */
export const INVERSAS = [
  {
    lat: 18.0021, lng: -92.9447, radioKm: 3,
    place: { subLocality: 'Tabasco 2000', locality: 'Villahermosa', postCode: '86035', formattedAddress: 'Tabasco 2000, 86035 Villahermosa, Tab., México', countryCode: 'MX' },
  },
  {
    lat: 17.9892, lng: -92.9281, radioKm: 3,
    place: { subLocality: 'Centro', locality: 'Villahermosa', postCode: '86000', formattedAddress: 'Centro, 86000 Villahermosa, Tab., México', countryCode: 'MX' },
  },
  {
    lat: 20.9674, lng: -89.5926, radioKm: 5,
    place: { subLocality: 'Centro', locality: 'Mérida', postCode: '97000', formattedAddress: 'Centro, 97000 Mérida, Yuc., México', countryCode: 'MX' },
  },
  {
    lat: 14.6349, lng: -90.5069, radioKm: 20,
    place: { locality: 'Ciudad de Guatemala', formattedAddress: 'Ciudad de Guatemala, Guatemala', countryCode: 'GT' },
  },
];

const MAPKIT_JS = /^https:\/\/cdn\.apple-mapkit\.com\/mk\/5\.x\.x\/mapkit\.js(\?.*)?$/;
const OTRO_APPLE = /^https:\/\/[^/]*apple-mapkit\.com\//;

/** Codigo del SDK de juguete. Corre en la pagina, no en Node. */
const sdk = (lugares, inversas) => `(() => {
  'use strict';
  const LUGARES = ${JSON.stringify(lugares)};
  const INVERSAS = ${JSON.stringify(inversas)};
  const LATENCIA_MS = 40;
  const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g, '').trim();
  const km = (a, b, c, d) => {
    const r = Math.PI / 180;
    const h = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2;
    return 12742 * Math.asin(Math.sqrt(h));
  };
  const mk = { maps: [], token: null, llamadas: { init: 0, autocomplete: [], search: [], reverse: [] } };
  window.__mk = mk;

  class Coordinate { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } }
  class CoordinateSpan { constructor(latitudeDelta, longitudeDelta) { this.latitudeDelta = latitudeDelta; this.longitudeDelta = longitudeDelta; } }
  class CoordinateRegion { constructor(center, span) { this.center = center; this.span = span; } }
  class Style { constructor(options) { Object.assign(this, options || {}); } }
  class CircleOverlay { constructor(coordinate, radius, options) { this.coordinate = coordinate; this.radius = radius; Object.assign(this, options || {}); } }
  class MarkerAnnotation {
    constructor(coordinate, options) {
      this.coordinate = coordinate;
      this.draggable = !!(options && options.draggable);
      this.title = options && options.title;
      this._ev = {};
    }
    addEventListener(type, cb) { (this._ev[type] = this._ev[type] || []).push(cb); }
    removeEventListener(type, cb) { this._ev[type] = (this._ev[type] || []).filter((f) => f !== cb); }
    _emitir(type) { for (const cb of this._ev[type] || []) cb({ target: this }); }
  }
  class Map {
    constructor(element, options) {
      const o = options || {};
      this.element = element;
      this.region = o.region;
      this.colorScheme = o.colorScheme;
      this.annotations = [];
      this.overlays = [];
      this.destroyed = false;
      this._ev = {};
      this._punto = null;
      mk.maps.push(this);
      element.setAttribute('data-mapkit-falso', 'true');
      this._pintar();
    }
    addEventListener(type, cb) { (this._ev[type] = this._ev[type] || []).push(cb); }
    removeEventListener(type, cb) { this._ev[type] = (this._ev[type] || []).filter((f) => f !== cb); }
    convertPointOnPageToCoordinate() {
      if (!this._punto) throw new Error('mapkit falso: tocar() no fijo un punto');
      return this._punto;
    }
    setRegionAnimated(region) { this.region = region; }
    addAnnotation(a) { this.annotations.push(a); this._pintar(); }
    removeAnnotation(a) { this.annotations = this.annotations.filter((x) => x !== a); this._pintar(); }
    addOverlay(o) { this.overlays.push(o); }
    removeOverlay(o) { this.overlays = this.overlays.filter((x) => x !== o); }
    destroy() { this.destroyed = true; }
    _pintar() {
      const a = this.annotations[this.annotations.length - 1];
      this.element.textContent = a
        ? 'Mapa falso · pin ' + a.coordinate.latitude.toFixed(4) + ', ' + a.coordinate.longitude.toFixed(4)
        : 'Mapa falso';
    }
  }
  Map.ColorSchemes = { Dark: 'dark', Light: 'light', Auto: 'auto' };

  const buscar = (query) => {
    const n = norm(query);
    if (!n) return [];
    return LUGARES.filter((l) => norm(l.consulta).startsWith(n) || n.startsWith(norm(l.consulta)));
  };
  class Search {
    constructor(options) { this.options = options || {}; }
    autocomplete(query, cb) {
      mk.llamadas.autocomplete.push(query);
      const results = buscar(query).map((l) => ({
        displayLines: l.displayLines.slice(),
        coordinate: new Coordinate(l.lat, l.lng),
        countryCode: l.countryCode,
      }));
      setTimeout(() => cb(null, { results }), LATENCIA_MS);
    }
    search(query, cb) {
      mk.llamadas.search.push(query);
      const places = buscar(query).map((l) => ({
        name: l.displayLines[0],
        formattedAddress: l.displayLines.join(', '),
        coordinate: new Coordinate(l.lat, l.lng),
        countryCode: l.countryCode,
      }));
      setTimeout(() => cb(null, { places }), LATENCIA_MS);
    }
  }
  class Geocoder {
    constructor(options) { this.options = options || {}; }
    reverseLookup(coordinate, cb) {
      const lat = coordinate.latitude, lng = coordinate.longitude;
      mk.llamadas.reverse.push([lat, lng]);
      let mejor = null, dMejor = Infinity;
      for (const inv of INVERSAS) {
        const d = km(lat, lng, inv.lat, inv.lng);
        if (d <= inv.radioKm && d < dMejor) { mejor = inv; dMejor = d; }
      }
      const place = mejor
        ? Object.assign({ coordinate: new Coordinate(lat, lng) }, mejor.place)
        : { name: 'Punto sintetico', coordinate: new Coordinate(lat, lng) };
      setTimeout(() => cb(null, { results: [place] }), LATENCIA_MS);
    }
  }

  window.mapkit = {
    init(options) {
      mk.llamadas.init++;
      options.authorizationCallback((token) => { mk.token = token; });
    },
    addEventListener() {},
    removeEventListener() {},
    Map, Coordinate, CoordinateSpan, CoordinateRegion, MarkerAnnotation, CircleOverlay, Style, Search, Geocoder,
    FeatureVisibility: { Adaptive: 'adaptive', Hidden: 'hidden', Visible: 'visible' },
  };

  /** Mapa vivo: el ultimo sin destruir que sigue en el DOM (StrictMode crea dos). */
  mk.mapa = () => mk.maps.filter((m) => !m.destroyed && m.element.isConnected).pop() || null;
  const vivo = () => {
    const m = mk.mapa();
    if (!m) throw new Error('mapkit falso: no hay ningun mapa vivo en la pagina');
    return m;
  };
  mk.tocar = (lat, lng) => {
    const m = vivo();
    m._punto = new Coordinate(lat, lng);
    const oyentes = m._ev['single-tap'] || [];
    if (oyentes.length === 0) throw new Error('mapkit falso: el mapa no escucha single-tap');
    for (const cb of oyentes) cb({ pointOnPage: { x: 1, y: 1 } });
    return true;
  };
  mk.arrastrar = (lat, lng) => {
    const m = vivo();
    const a = m.annotations[m.annotations.length - 1];
    if (!a) throw new Error('mapkit falso: el mapa no tiene marcador');
    a.coordinate = new Coordinate(lat, lng);
    a._emitir('drag-end');
    return true;
  };
  mk.pin = () => {
    const m = mk.mapa();
    const a = m && m.annotations[m.annotations.length - 1];
    return a ? [a.coordinate.latitude, a.coordinate.longitude] : null;
  };
})();
`;

/**
 * Instala el proveedor falso en un BrowserContext de Playwright. Devuelve un
 * lector de cuantas veces la pagina pidio el token y el script, para poder
 * exigir que la prueba paso de verdad por el falso y no por el MapKit real.
 */
export const instalarMapkitFalso = async (context, { lugares = LUGARES, inversas = INVERSAS } = {}) => {
  const cuentas = { token: 0, script: 0, bloqueadas: 0 };
  const cuerpo = sdk(lugares, inversas);
  await context.route('**/api/mapkit/token', (route) => {
    cuentas.token++;
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({ token: 'fixture' }),
    });
  });
  // Cualquier otra cosa de Apple (teselas, el SDK real por otra ruta) se corta:
  // la prueba no debe depender de la red de Apple ni tocarla.
  await context.route(OTRO_APPLE, (route) => {
    if (MAPKIT_JS.test(route.request().url())) {
      cuentas.script++;
      return route.fulfill({
        status: 200,
        contentType: 'application/javascript; charset=utf-8',
        headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
        body: cuerpo,
      });
    }
    cuentas.bloqueadas++;
    return route.abort();
  });
  return () => ({ ...cuentas });
};
