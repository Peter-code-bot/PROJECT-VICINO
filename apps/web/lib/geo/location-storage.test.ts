import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { readLocation, writeLocation, updateLocationLabel, clearLocation, isValidRadius, COOKIE_LOCATION, COOKIE_RADIUS, STORAGE_KEY } from "./location-storage";

const prior = { lat: 19.04, lng: -98.2, radius: 10000, name: "Anterior" };
const next = { lat: 19.07238, lng: -98.22414, radius: 25000, name: "Centro", fullName: "Centro, Puebla, México" };
let cookies: Map<string, string>;
let cookieWrites: string[];
let storage: Map<string, string>;
let events: CustomEvent[];
let rejectRadius: boolean;
let blockCookieAccess: boolean;
let rejectMirror: boolean;
let mirrorWrites: number;
let descriptors: Record<string, PropertyDescriptor | undefined>;

beforeEach(() => {
  cookies = new Map([[COOKIE_LOCATION, "19.040,-98.200"], [COOKIE_RADIUS, "10000"]]);
  cookieWrites = [];
  storage = new Map([[STORAGE_KEY, JSON.stringify(prior)]]);
  events = [];
  rejectRadius = blockCookieAccess = rejectMirror = false;
  mirrorWrites = 0;
  descriptors = Object.fromEntries(["document", "window", "localStorage", "location"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    get cookie() {
      if (blockCookieAccess) throw new Error("blocked");
      return [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    set cookie(value: string) {
      if (blockCookieAccess) throw new Error("blocked");
      cookieWrites.push(value);
      const [pair] = value.split(";");
      const [key, data] = pair!.split("=");
      if (rejectRadius && key === COOKIE_RADIUS && data === "25000") return;
      if (value.includes("max-age=0")) cookies.delete(key!);
      else cookies.set(key!, data!);
    },
  } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent: (event: CustomEvent) => { events.push(event); } } });
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => { if (rejectMirror) throw new Error("quota"); mirrorWrites++; storage.set(key, value); },
    removeItem: (key: string) => { storage.delete(key); },
  } });
});

afterEach(() => {
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test("canonical cookies confirm success before one event; repeated Listo emits none", () => {
  assert.equal(writeLocation(next), true);
  assert.equal(cookies.get(COOKIE_LOCATION), "19.072,-98.224");
  assert.equal(cookies.get(COOKIE_RADIUS), "25000");
  assert.equal(events.length, 1);
  // El aviso lleva lo mismo que la cookie: 3 decimales y sin precisión del GPS.
  assert.deepEqual(events[0]!.detail, { ...next, lat: 19.072, lng: -98.224 });
  assert.equal(readLocation()?.fullName, next.fullName);
  assert.equal(writeLocation(next), true);
  assert.equal(events.length, 1);
});

test("a rejected radius cookie rolls back the point and preserves mirror/event/state", () => {
  rejectRadius = true;
  assert.equal(writeLocation(next), false);
  assert.equal(cookies.get(COOKIE_LOCATION), "19.040,-98.200");
  assert.equal(cookies.get(COOKIE_RADIUS), "10000");
  assert.equal(storage.get(STORAGE_KEY), JSON.stringify(prior));
  assert.equal(events.length, 0);
  assert.equal(readLocation()?.name, "Anterior");
});

test("mirror quota failure does not suppress canonical success or refresh event", () => {
  rejectMirror = true;
  assert.equal(writeLocation(next), true);
  assert.equal(events.length, 1);
  assert.equal(readLocation()?.lat, 19.072);
});

test("cookie denial is confirmed failure without event", () => {
  blockCookieAccess = true;
  assert.equal(writeLocation(next), false);
  assert.equal(events.length, 0);
});

test("corrupt radii cannot be persisted, and an existing corrupt cookie is sanitized", () => {
  for (const radius of [NaN, Infinity, -1, 0, 499, 50001]) {
    assert.equal(isValidRadius(radius), false);
    assert.equal(writeLocation({ ...next, radius }), false);
  }
  assert.equal(events.length, 0);
  cookies.set(COOKIE_RADIUS, "10000junk");
  assert.equal(readLocation()?.radius, 10000);
});

test("reading a local mirror without canonical cookie never applies it", () => {
  cookies.clear();
  assert.equal(readLocation(), null);
  assert.equal(cookies.size, 0);
  assert.equal(events.length, 0);
});

test("label enrichment updates only the mirror and label consumers, preserving radius", () => {
  assert.equal(writeLocation(next), true);
  const previousCookies = [...cookies];
  const label = { name: "Dirección GPS", fullName: "Dirección GPS, Puebla" };
  assert.equal(updateLocationLabel(next, label), true);
  assert.deepEqual([...cookies], previousCookies);
  assert.equal(readLocation()?.name, label.name);
  assert.equal(readLocation()?.radius, next.radius);
  assert.equal(events.filter(event => event.type === "vicino_location_updated").length, 1);
  assert.equal(events.filter(event => event.type === "vicino_location_label_updated").length, 1);
  // El espejo etiquetado tampoco recupera la precisión completa.
  assert.equal(JSON.parse(storage.get(STORAGE_KEY)!).lat, 19.072);
});

test("late labels cannot replace another point, including a newer point in the same grid", () => {
  assert.equal(writeLocation(next), true);
  const replacement = { ...next, lat: next.lat + 0.00001, name: "Elección más reciente" };
  assert.equal(writeLocation(replacement), true);
  assert.equal(updateLocationLabel(next, { name: "Antigua", fullName: "Antigua" }), false);
  assert.equal(updateLocationLabel(prior, { name: "Antigua", fullName: "Antigua" }), false);
  assert.equal(readLocation()?.name, replacement.name);
  assert.equal(events.filter(event => event.type === "vicino_location_label_updated").length, 0);
});

test("blocked metadata storage never undoes the confirmed point or emits a label event", () => {
  assert.equal(writeLocation(next), true);
  rejectMirror = true;
  assert.equal(updateLocationLabel(next, { name: "Dirección GPS", fullName: "Dirección GPS" }), false);
  assert.equal(readLocation()?.name, next.name);
  assert.equal(events.length, 1);
});

test("el espejo guarda 3 decimales y nunca la precisión del GPS, ni en el aviso", () => {
  assert.equal(writeLocation({ ...next, accuracy: 35 }), true);
  const espejo = JSON.parse(storage.get(STORAGE_KEY)!);
  assert.equal(espejo.lat, 19.072);
  assert.equal(espejo.lng, -98.224);
  assert.equal("accuracy" in espejo, false);
  assert.equal(typeof espejo.sel, "string");
  assert.equal("accuracy" in events[0]!.detail, false);
  // La marca de selección no se filtra a quien lee la ubicación.
  assert.equal("sel" in readLocation()!, false);
});

test("un espejo viejo con precisión completa y accuracy no las devuelve", () => {
  cookies.set(COOKIE_LOCATION, "19.072,-98.224");
  storage.set(STORAGE_KEY, JSON.stringify({ lat: 19.07238, lng: -98.22414, accuracy: 35, name: "Vieja" }));
  const leida = readLocation();
  assert.deepEqual({ lat: leida?.lat, lng: leida?.lng, name: leida?.name }, { lat: 19.072, lng: -98.224, name: "Vieja" });
  assert.equal(leida && "accuracy" in leida, false);
});

test("la etiqueta de la selección vigente se aplica aunque otra la precediera en la misma celda", () => {
  assert.equal(writeLocation(next), true);
  const replacement = { ...next, lat: next.lat + 0.00001, name: "Elección más reciente" };
  assert.equal(writeLocation(replacement), true);
  assert.equal(updateLocationLabel(replacement, { name: "Colonia", fullName: "Colonia, Puebla" }), true);
  assert.equal(readLocation()?.name, "Colonia");
});

test("una selección más nueva en OTRA pestaña (misma celda) gana a la etiqueta tardía de esta", () => {
  assert.equal(writeLocation(next), true);
  // La otra pestaña reescribe el espejo con su propia marca y el mismo punto a 3 decimales.
  storage.set(STORAGE_KEY, JSON.stringify({ lat: 19.072, lng: -98.224, radius: 25000, name: "Otra pestaña", sel: "otra-pestana" }));
  assert.equal(updateLocationLabel(next, { name: "Antigua", fullName: "Antigua" }), false);
  assert.equal(readLocation()?.name, "Otra pestaña");
});

test("Secure solo bajo https, también al restaurar y al borrar", () => {
  Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "https:" } });
  assert.equal(writeLocation({ ...prior, lat: 19.05 }), true);
  rejectRadius = true;
  assert.equal(writeLocation(next), false); // el radio 25000 se rechaza: fuerza restore()
  assert.equal(cookies.get(COOKIE_LOCATION), "19.050,-98.200");
  clearLocation();
  assert.ok(cookieWrites.length >= 6);
  for (const escrita of cookieWrites) assert.match(escrita, /; SameSite=Lax; Secure$/, escrita);

  cookieWrites = [];
  Object.defineProperty(globalThis, "location", { configurable: true, value: { protocol: "http:" } });
  assert.equal(writeLocation(prior), true);
  assert.ok(cookieWrites.length >= 2);
  for (const escrita of cookieWrites) assert.equal(escrita.includes("Secure"), false, escrita);
});

test("borrar la zona olvida la selección: una etiqueta tardía ya no se aplica", () => {
  assert.equal(writeLocation(next), true);
  clearLocation();
  cookies.set(COOKIE_LOCATION, "19.072,-98.224");
  storage.set(STORAGE_KEY, JSON.stringify({ lat: 19.072, lng: -98.224 }));
  assert.equal(updateLocationLabel(next, { name: "Tardía", fullName: "Tardía" }), false);
});

test("un espejo viejo en la misma celda se reescribe al leerlo: 3 decimales y sin accuracy", () => {
  cookies.set(COOKIE_LOCATION, "19.072,-98.224");
  cookies.set(COOKIE_RADIUS, "25000");
  storage.set(STORAGE_KEY, JSON.stringify({ lat: 19.07238, lng: -98.22414, accuracy: 35, radius: 10000, name: "Vieja", fullName: "Vieja, Puebla" }));
  assert.equal(readLocation()?.name, "Vieja");
  assert.deepEqual(JSON.parse(storage.get(STORAGE_KEY)!), { lat: 19.072, lng: -98.224, radius: 25000, name: "Vieja", fullName: "Vieja, Puebla" });
  // Ya depurado, leerlo otra vez no lo vuelve a escribir; nada toca la cookie ni avisa.
  const escrituras = mirrorWrites;
  assert.equal(readLocation()?.name, "Vieja");
  assert.equal(mirrorWrites, escrituras);
  assert.equal(cookieWrites.length, 0);
  assert.equal(events.length, 0);

  // Solo con `accuracy` (el punto ya tenía 3 decimales) también se depura.
  storage.set(STORAGE_KEY, JSON.stringify({ lat: 19.072, lng: -98.224, accuracy: 12, name: "Vieja" }));
  readLocation();
  assert.equal("accuracy" in JSON.parse(storage.get(STORAGE_KEY)!), false);
});

test("un espejo vigente no se reescribe al leerlo", () => {
  assert.equal(writeLocation(next), true);
  const escrito = storage.get(STORAGE_KEY);
  const escrituras = mirrorWrites;
  assert.equal(readLocation()?.name, next.name);
  assert.equal(mirrorWrites, escrituras);
  assert.equal(storage.get(STORAGE_KEY), escrito);
});

test("depurar el espejo conserva la marca: la etiqueta en curso se sigue aplicando", () => {
  assert.equal(writeLocation(next), true);
  const vigente = JSON.parse(storage.get(STORAGE_KEY)!);
  storage.set(STORAGE_KEY, JSON.stringify({ ...vigente, lat: next.lat, lng: next.lng, accuracy: 12 }));
  readLocation();
  const espejo = JSON.parse(storage.get(STORAGE_KEY)!);
  assert.equal(espejo.sel, vigente.sel);
  assert.equal(espejo.lat, 19.072);
  assert.equal("accuracy" in espejo, false);
  assert.equal(updateLocationLabel(next, { name: "Colonia", fullName: "Colonia, Puebla" }), true);
  assert.equal(readLocation()?.name, "Colonia");
});

test("un espejo viejo sin cookie (caducada o ilegible) también se depura y sigue sin aplicar zona", () => {
  for (const cookie of [null, "basura"]) {
    cookies.clear();
    if (cookie) cookies.set(COOKIE_LOCATION, cookie);
    storage.set(STORAGE_KEY, JSON.stringify({ lat: 19.07238, lng: -98.22414, accuracy: 35, radius: 25000, name: "Vieja" }));
    assert.equal(readLocation(), null);
    assert.deepEqual(JSON.parse(storage.get(STORAGE_KEY)!), { lat: 19.072, lng: -98.224, radius: 25000, name: "Vieja" });
  }
  assert.equal(cookieWrites.length, 0);
  assert.equal(events.length, 0);
});

test("si el espejo depurado no se puede escribir, la lectura sigue funcionando", () => {
  cookies.set(COOKIE_LOCATION, "19.072,-98.224");
  storage.set(STORAGE_KEY, JSON.stringify({ lat: 19.07238, lng: -98.22414, accuracy: 35, name: "Vieja" }));
  rejectMirror = true;
  assert.deepEqual(readLocation(), { lat: 19.072, lng: -98.224, radius: 10000, name: "Vieja", fullName: undefined });
});
