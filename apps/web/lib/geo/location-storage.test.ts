import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { readLocation, writeLocation, isValidRadius, COOKIE_LOCATION, COOKIE_RADIUS, STORAGE_KEY } from "./location-storage";

const prior = { lat: 19.04, lng: -98.2, radius: 10000, name: "Anterior" };
const next = { lat: 19.07238, lng: -98.22414, radius: 25000, name: "Centro", fullName: "Centro, Puebla, México" };
let cookies: Map<string, string>;
let storage: Map<string, string>;
let events: CustomEvent[];
let rejectRadius: boolean;
let blockCookieAccess: boolean;
let rejectMirror: boolean;
let descriptors: Record<string, PropertyDescriptor | undefined>;

beforeEach(() => {
  cookies = new Map([[COOKIE_LOCATION, "19.040,-98.200"], [COOKIE_RADIUS, "10000"]]);
  storage = new Map([[STORAGE_KEY, JSON.stringify(prior)]]);
  events = [];
  rejectRadius = blockCookieAccess = rejectMirror = false;
  descriptors = Object.fromEntries(["document", "window", "localStorage"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    get cookie() {
      if (blockCookieAccess) throw new Error("blocked");
      return [...cookies].map(([key, value]) => `${key}=${value}`).join("; ");
    },
    set cookie(value: string) {
      if (blockCookieAccess) throw new Error("blocked");
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
    setItem: (key: string, value: string) => { if (rejectMirror) throw new Error("quota"); storage.set(key, value); },
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
  assert.deepEqual(events[0]!.detail, { ...next, lat: 19.072, lng: -98.224, accuracy: undefined });
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
