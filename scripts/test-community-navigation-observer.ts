/** Route provenance only: fake browser history, no accounts or remote requests. */
import assert from "node:assert/strict";
import { test } from "node:test";
import { COMMUNITY_NAVIGATION_UPDATED, createCommunityNavigationObserver, currentCommunityReturn, markCommunityNavigationReplace, notifyCommunityNavigationReplacement } from "../apps/web/lib/navigation/retorno-comunidad";

const KEY = "vicinoCommunityNavigation";
const root = "/comunidades/one";

function browser(start = "/buscar?q=grupo") {
  const previous = { window: globalThis.window, history: globalThis.history, location: globalThis.location };
  const listeners = new Map<string, Set<() => void>>();
  const location = { href: "https://vicino.test" + start, pathname: "", search: "", hash: "" };
  const entries: { url: string; state: Record<string, unknown> | null }[] = [{ url: location.href, state: { framework: { opaque: "preserved" } } }];
  let index = 0;
  let writes = 0;
  const updateUrl = (value: string) => {
    const parsed = new URL(value, location.href);
    Object.assign(location, { href: parsed.href, pathname: parsed.pathname, search: parsed.search, hash: parsed.hash });
  };
  updateUrl(location.href);
  const history = {
    get state() { return entries[index]!.state; },
    pushState(data: Record<string, unknown> | null, _unused: string, url?: string | URL | null) {
      const target = new URL(url?.toString() ?? location.href, location.href).href;
      entries.splice(index + 1); entries.push({ url: target, state: data }); index += 1; updateUrl(target);
    },
    replaceState(data: Record<string, unknown> | null, _unused: string, url?: string | URL | null) {
      writes += 1;
      const target = new URL(url?.toString() ?? location.href, location.href).href;
      entries[index] = { url: target, state: data }; updateUrl(target);
    },
  };
  Object.assign(globalThis, { location, history, window: {
    addEventListener(type: string, listener: () => void) {
      if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: () => void) { listeners.get(type)?.delete(listener); },
    dispatchEvent(event: Event) { listeners.get(event.type)?.forEach(listener => listener()); return true; },
  } });
  const observer = createCommunityNavigationObserver();
  observer.observe();
  return { observer, history, entries, listeners, writes: () => writes,
    navigate(path: string, replacing = false, preserveState = false) {
      history[replacing ? "replaceState" : "pushState"](preserveState ? history.state : { framework: { opaque: "preserved" } }, "", path);
      observer.observe();
    },
    traverse(next: number) { index = next; updateUrl(entries[index]!.url); listeners.get("popstate")?.forEach(listener => listener()); },
    corrupt(value: unknown) { history.replaceState({ [KEY]: value }, ""); },
    close() { observer.dispose(); Object.assign(globalThis, previous); },
  };
}

test("observer and disposal preserve history methods, including a later router patch", () => {
  const fixture = browser();
  try {
    const originalPush = fixture.history.pushState;
    const originalReplace = fixture.history.replaceState;
    fixture.observer.observe();
    assert.equal(fixture.history.pushState, originalPush);
    assert.equal(fixture.history.replaceState, originalReplace);
    const laterPush: typeof originalPush = () => {};
    const laterReplace: typeof originalReplace = () => {};
    fixture.history.pushState = laterPush; fixture.history.replaceState = laterReplace;
    fixture.observer.dispose();
    assert.equal(fixture.history.pushState, laterPush);
    assert.equal(fixture.history.replaceState, laterReplace);
    assert.equal(fixture.listeners.get("popstate")?.size, 0);
    assert.equal(fixture.listeners.get("hashchange")?.size, 0);
    assert.equal(fixture.listeners.get(COMMUNITY_NAVIGATION_UPDATED)?.size, 0);
  } finally { fixture.close(); }
});

test("route metadata preserves opaque state and does not change URL or add history entries", () => {
  const fixture = browser();
  try {
    assert.equal(fixture.entries.length, 1);
    assert.equal(fixture.entries[0]!.url, "https://vicino.test/buscar?q=grupo");
    assert.deepEqual(fixture.history.state?.framework, { opaque: "preserved" });
    const metadata = fixture.history.state?.[KEY] as { version: number; entryId: string };
    assert.equal(metadata.version, 1);
    assert.match(metadata.entryId, /^[0-9a-f-]{36}$/);
    const writes = fixture.writes(); fixture.observer.dispose(); fixture.observer.observe();
    assert.equal(fixture.writes(), writes);
  } finally { fixture.close(); }
});

test("five community/admin cycles restore the origin across browser back and forward", () => {
  const fixture = browser();
  try {
    fixture.navigate(root);
    for (let cycle = 0; cycle < 5; cycle += 1) {
      fixture.navigate(root + "/administrar");
      assert.deepEqual(currentCommunityReturn("one", true), { back: true, href: root });
      fixture.traverse(1);
      assert.deepEqual(currentCommunityReturn("one", false), { back: true, href: "/buscar?q=grupo" });
      fixture.traverse(2);
      assert.deepEqual(currentCommunityReturn("one", true), { back: true, href: root });
      fixture.traverse(1);
    }
    fixture.traverse(0);
    assert.equal(fixture.entries.length, 3);
  } finally { fixture.close(); }
});

test("replacing community filters keeps the actual previous entry and original origin", () => {
  const fixture = browser();
  try {
    fixture.navigate(root);
    fixture.navigate(root + "?categoria=comida", true, true);
    assert.equal(fixture.entries.length, 2);
    assert.deepEqual(currentCommunityReturn("one", false), { back: true, href: "/buscar?q=grupo" });
    fixture.navigate(root + "?categoria=hogar", true, true);
    assert.deepEqual(currentCommunityReturn("one", false), { back: true, href: "/buscar?q=grupo" });
    fixture.traverse(0);
  } finally { fixture.close(); }
});

test("explicit local filter notification observes a URL replacement without a router render", () => {
  const fixture = browser();
  try {
    fixture.navigate(root);
    const filtered = root + "?tab=descubrir";
    fixture.history.replaceState(fixture.history.state, "", filtered);
    notifyCommunityNavigationReplacement();
    assert.deepEqual(currentCommunityReturn("one", false), { back: true, href: "/buscar?q=grupo" });
    assert.deepEqual(fixture.history.state?.framework, { opaque: "preserved" });
    fixture.navigate("/comunidades/two");
    assert.deepEqual(currentCommunityReturn("two", false), { back: true, href: filtered });
  } finally { fixture.close(); }
});

test("direct admin uses explicit replace fallback without inventing a previous entry", () => {
  const fixture = browser(root + "/administrar");
  try {
    assert.deepEqual(currentCommunityReturn("one", true), { back: false, href: root });
    markCommunityNavigationReplace(root); fixture.navigate(root, true);
    assert.equal(fixture.entries.length, 1);
    assert.deepEqual(currentCommunityReturn("one", false), { back: false, href: "/" });
  } finally { fixture.close(); }
});

test("reload and a second observer preserve the current entry's validated provenance", () => {
  const fixture = browser();
  try {
    fixture.navigate(root); fixture.navigate(root + "/administrar");
    fixture.observer.dispose();
    const reloaded = createCommunityNavigationObserver();
    try {
      reloaded.observe();
      assert.deepEqual(currentCommunityReturn("one", true), { back: true, href: root });
    } finally { reloaded.dispose(); }
  } finally { fixture.close(); }
});

test("legacy metadata remains readable; corrupt or external provenance falls back safely", () => {
  const fixture = browser(root);
  try {
    fixture.corrupt({ path: root, previous: "/perfil", community: { id: "one", origin: "/perfil" } });
    assert.deepEqual(currentCommunityReturn("one", false), { back: true, href: "/perfil" });
    for (const value of [null, "broken", { path: root, previous: "//evil.test", community: null },
      { path: root, previous: "/perfil", community: { id: "other", origin: "/perfil" } },
      { path: root, previous: "/perfil", community: { id: "one", origin: "/login" } },
      { path: root, previous: "/perfil", community: null, version: 2, entryId: "future" }]) {
      fixture.corrupt(value);
      assert.deepEqual(currentCommunityReturn("one", false), { back: false, href: "/" });
    }
  } finally { fixture.close(); }
});

test("traversing an untracked entry never borrows the most recently visited community", () => {
  const fixture = browser();
  try {
    fixture.navigate(root); fixture.navigate("/comunidades/two");
    fixture.entries[1]!.state = null;
    fixture.traverse(1);
    assert.deepEqual(currentCommunityReturn("one", false), { back: false, href: "/" });
  } finally { fixture.close(); }
});

test("a denied metadata write does not block navigation or overwrite router functions", () => {
  const fixture = browser(root);
  try {
    fixture.history.replaceState = () => { throw new Error("History unavailable"); };
    const original = fixture.history.replaceState;
    assert.doesNotThrow(() => fixture.observer.observe());
    assert.equal(fixture.history.replaceState, original);
    fixture.observer.dispose();
    assert.equal(fixture.history.replaceState, original);
  } finally { fixture.close(); }
});
