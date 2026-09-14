import assert from "node:assert/strict";
import test from "node:test";
import {
  calculateDistanceKm,
  esResultadoValido,
  buildDeterministicId,
  clasificarResultado,
  resolveLocationCoordinates,
  COVERAGE_RADIUS_KM,
  searchLocations,
} from "./location-search";

const PUEBLA_CENTER = { lat: 19.0414, lng: -98.2063 };
const CDMX = { lat: 19.4326, lng: -99.1332 };
const CHOLULA = { lat: 19.0625, lng: -98.3075 };
const BIELEFELD_GERMANY = { lat: 52.0302, lng: 8.5325 };
const GUATEMALA_CITY = { lat: 14.6349, lng: -90.5069 };

test("calculateDistanceKm calculates accurate Haversine distance", () => {
  const distCholula = calculateDistanceKm(
    PUEBLA_CENTER.lat,
    PUEBLA_CENTER.lng,
    CHOLULA.lat,
    CHOLULA.lng
  );
  assert.ok(distCholula > 10 && distCholula < 15, `Esperado ~12km, obtenido ${distCholula}`);

  const distCdmx = calculateDistanceKm(
    PUEBLA_CENTER.lat,
    PUEBLA_CENTER.lng,
    CDMX.lat,
    CDMX.lng
  );
  assert.ok(distCdmx > 95 && distCdmx < 120, `Esperado ~105km, obtenido ${distCdmx}`);

  const distAlemania = calculateDistanceKm(
    PUEBLA_CENTER.lat,
    PUEBLA_CENTER.lng,
    BIELEFELD_GERMANY.lat,
    BIELEFELD_GERMANY.lng
  );
  assert.ok(distAlemania > 9000, `Esperado >9000km, obtenido ${distAlemania}`);
});

test("esResultadoValido accepts valid places within Mexico and within distance", () => {
  const okCholula = esResultadoValido(
    { lat: CHOLULA.lat, lng: CHOLULA.lng, countryCode: "MX" },
    PUEBLA_CENTER,
    150
  );
  assert.equal(okCholula, true);

  const okCdmx = esResultadoValido(
    { lat: CDMX.lat, lng: CDMX.lng, countryCode: "mx" },
    PUEBLA_CENTER,
    150
  );
  assert.equal(okCdmx, true);
});

test("esResultadoValido rejects Germany (Bielefeld) outside Mexico bounding box", () => {
  const result = esResultadoValido(
    { lat: BIELEFELD_GERMANY.lat, lng: BIELEFELD_GERMANY.lng, countryCode: "DE" },
    PUEBLA_CENTER,
    150
  );
  assert.equal(result, false);

  const resultSinPais = esResultadoValido(
    { lat: BIELEFELD_GERMANY.lat, lng: BIELEFELD_GERMANY.lng },
    PUEBLA_CENTER,
    150
  );
  assert.equal(resultSinPais, false);
});

test("esResultadoValido rejects foreign countries even if near southern border", () => {
  const resultConPais = esResultadoValido(
    { lat: GUATEMALA_CITY.lat, lng: GUATEMALA_CITY.lng, countryCode: "GT" },
    PUEBLA_CENTER,
    150
  );
  assert.equal(resultConPais, false);

  const resultPorDistancia = esResultadoValido(
    { lat: GUATEMALA_CITY.lat, lng: GUATEMALA_CITY.lng },
    PUEBLA_CENTER,
    150
  );
  assert.equal(resultPorDistancia, false);
});

test("esResultadoValido rejects invalid, NaN or null coordinates", () => {
  assert.equal(esResultadoValido({ lat: NaN, lng: -98.2 }, PUEBLA_CENTER), false);
  assert.equal(esResultadoValido({ lat: 19.0, lng: Infinity }, PUEBLA_CENTER), false);
  assert.equal(esResultadoValido({ lat: null, lng: -98.2 }, PUEBLA_CENTER), false);
  assert.equal(esResultadoValido({ lat: undefined, lng: -98.2 }, PUEBLA_CENTER), false);
});

test("buildDeterministicId generates stable, index-independent IDs", () => {
  const id1 = buildDeterministicId(19.04141, -98.20632, "Universidad Anáhuac Puebla");
  const id2 = buildDeterministicId(19.04141, -98.20632, "Universidad Anáhuac Puebla");
  assert.equal(id1, id2);
  assert.ok(id1.startsWith("mk-19.04141--98.20632-universidad-anahuac-puebla"));
  assert.ok(!id1.includes("NaN"));
});

// ---------------------------------------------------------------------------
// Regresiones de la revision del 13-sep-2026
// ---------------------------------------------------------------------------

const MONTERREY = { lat: 25.7385, lng: -100.3379 };

test("clasificarResultado distingue 'lejos' de 'no existe'", () => {
  // Monterrey esta a ~776 km de Puebla: es Mexico valido, solo fuera de cobertura.
  assert.equal(
    clasificarResultado({ ...MONTERREY, countryCode: "MX" }, PUEBLA_CENTER, 200),
    "fuera-de-cobertura"
  );
  // Alemania no es "lejos", es otro pais. La UI no debe ofrecer ampliar cobertura.
  assert.equal(
    clasificarResultado({ ...BIELEFELD_GERMANY, countryCode: "DE" }, PUEBLA_CENTER, 200),
    "fuera-de-mexico"
  );
  assert.equal(
    clasificarResultado({ ...CHOLULA, countryCode: "MX" }, PUEBLA_CENTER, 200),
    "ok"
  );
  assert.equal(
    clasificarResultado({ lat: NaN, lng: -98.2 }, PUEBLA_CENTER, 200),
    "coordenadas"
  );
});

test("el radio de cobertura es configurable y aplica de verdad", () => {
  // Con la cobertura por defecto, Monterrey queda fuera desde Puebla...
  assert.equal(esResultadoValido({ ...MONTERREY, countryCode: "MX" }, PUEBLA_CENTER, 200), false);
  // ...y con una cobertura nacional, entra. Esto es lo que cambia
  // NEXT_PUBLIC_COVERAGE_RADIUS_KM sin tocar codigo.
  assert.equal(esResultadoValido({ ...MONTERREY, countryCode: "MX" }, PUEBLA_CENTER, 3000), true);
  assert.ok(COVERAGE_RADIUS_KM > 0);
});

/**
 * EL BUG: una sugerencia sin coordenadas llevaba las del centro del mapa como
 * relleno, y si la resolucion fallaba se devolvia tal cual. Quien llamaba
 * guardaba esas coordenadas creyendo que eran del sitio elegido: el usuario
 * pedia "Monterrey Centro" y terminaba en Puebla con esa etiqueta.
 */
test("resolveLocationCoordinates nunca devuelve el centro disfrazado de resultado", async () => {
  const sugerencia = {
    id: "mk-sug-monterrey-centro",
    name: "Monterrey Centro",
    fullName: "Monterrey Centro",
    lat: Number.NaN,
    lng: Number.NaN,
    needsResolution: true,
  };

  // 1. Sin MapKit disponible (script caido, offline): no puede inventar nada.
  const g = globalThis as unknown as { window?: unknown };
  const previo = g.window;
  g.window = {};
  const sinMapkit = await resolveLocationCoordinates(sugerencia, PUEBLA_CENTER);
  assert.equal(sinMapkit.needsResolution, true, "debe seguir marcada como NO resuelta");
  assert.ok(
    !Number.isFinite(sinMapkit.lat) && !Number.isFinite(sinMapkit.lng),
    "no debe traer coordenadas utilizables"
  );

  // 2. MapKit responde, pero el sitio cae fuera de cobertura: se rechaza Y se
  //    explica por que, para que la UI no diga "no existe".
  g.window = { mapkit: fakeMapkit([{ name: "Centro", countryCode: "MX", coordinate: { latitude: MONTERREY.lat, longitude: MONTERREY.lng } }]) };
  const lejos = await resolveLocationCoordinates(sugerencia, PUEBLA_CENTER, 200);
  assert.equal(lejos.needsResolution, true);
  assert.equal(lejos.outOfCoverage, true);
  assert.equal(lejos.rejectionReason, "fuera-de-cobertura");
  assert.ok(!Number.isFinite(lejos.lat), "tampoco aqui debe filtrarse una coordenada");

  // 3. Camino bueno: dentro de cobertura, se resuelve y queda utilizable.
  g.window = { mapkit: fakeMapkit([{ name: "Cholula", countryCode: "MX", coordinate: { latitude: CHOLULA.lat, longitude: CHOLULA.lng } }]) };
  const ok = await resolveLocationCoordinates(sugerencia, PUEBLA_CENTER, 200);
  assert.equal(ok.needsResolution, false);
  assert.equal(ok.lat, CHOLULA.lat);
  assert.ok(Number.isFinite(ok.lng));

  g.window = previo;
});

/**
 * ESTE es el test que clava el bug en su origen. Apple devuelve sugerencias de
 * autocompletado sin coordenadas; el codigo viejo las rellenaba con las del
 * centro del mapa, y a partir de ahi ya nadie podia distinguir un resultado real
 * de un relleno. Si alguien vuelve a poner `center.lat` ahi, esto se pone rojo.
 */
test("una sugerencia sin coordenadas NUNCA sale con las del centro", async () => {
  const g = globalThis as unknown as { window?: unknown };
  const previo = g.window;

  g.window = {
    mapkit: fakeMapkit([], [{ displayLines: ["Zona sin coords"], countryCode: "MX" }]),
  };

  const { results } = await searchLocations("zona sin coordenadas unica", {
    center: PUEBLA_CENTER,
  });

  assert.equal(results.length, 1);
  const sugerencia = results[0]!;
  assert.equal(sugerencia.needsResolution, true);
  assert.notEqual(sugerencia.lat, PUEBLA_CENTER.lat, "no debe heredar la lat del centro");
  assert.notEqual(sugerencia.lng, PUEBLA_CENTER.lng, "no debe heredar la lng del centro");
  assert.ok(
    !Number.isFinite(sugerencia.lat) && !Number.isFinite(sugerencia.lng),
    "sin coordenadas reales, lat/lng tienen que ser NaN"
  );

  g.window = previo;
});

test("searchLocations avisa cuando lo unico que sobro fue la distancia", async () => {
  const g = globalThis as unknown as { window?: unknown };
  const previo = g.window;

  g.window = {
    mapkit: fakeMapkit(
      [],
      [
        {
          displayLines: ["Monterrey Centro"],
          countryCode: "MX",
          coordinate: { latitude: MONTERREY.lat, longitude: MONTERREY.lng },
        },
      ]
    ),
  };

  const outcome = await searchLocations("monterrey centro unico", {
    center: PUEBLA_CENTER,
    maxDistanceKm: 200,
  });

  assert.equal(outcome.results.length, 0);
  assert.equal(
    outcome.outOfCoverage,
    true,
    "lista vacia + outOfCoverage: la UI puede decir 'fuera de cobertura' en vez de 'no existe'"
  );
  assert.equal(outcome.reason, "fuera-de-cobertura");

  g.window = previo;
});

test("la búsqueda distingue un lugar fuera de México de uno sin resultados", async () => {
  const g = globalThis as unknown as { window?: unknown };
  const previo = g.window;
  g.window = {
    mapkit: fakeMapkit([], [{
      displayLines: ["Ciudad de Guatemala"],
      countryCode: "GT",
      coordinate: { latitude: GUATEMALA_CITY.lat, longitude: GUATEMALA_CITY.lng },
    }]),
  };
  try {
    const result = await searchLocations("ciudad guatemala fuera mexico", { center: PUEBLA_CENTER });
    assert.deepEqual(result.results, []);
    assert.equal(result.reason, "fuera-de-mexico");
    assert.equal(result.outOfCoverage, false);
  } finally {
    g.window = previo;
  }
});

/** MapKit de mentira: solo lo que resolveLocationCoordinates toca. */
function fakeMapkit(places: unknown[], autocompleteResults?: unknown[]) {
  return {
    Coordinate: function (this: unknown, lat: number, lng: number) {
      return { latitude: lat, longitude: lng };
    },
    CoordinateSpan: function () {
      return {};
    },
    CoordinateRegion: function () {
      return {};
    },
    Search: function (this: Record<string, unknown>) {
      this.search = (_q: string, cb: (e: unknown, d: unknown) => void) => {
        setImmediate(() => cb(null, { places }));
      };
      if (autocompleteResults) {
        this.autocomplete = (_q: string, cb: (e: unknown, d: unknown) => void) => {
          setImmediate(() => cb(null, { results: autocompleteResults }));
        };
      }
      return this;
    },
  };
}
