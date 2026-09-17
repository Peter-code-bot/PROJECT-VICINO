"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SessionCache, type Snapshot } from "@/lib/session-cache";
import { locationScopeFromDocumentCookie } from "@/lib/session-scope";
import { consumirRestauracion } from "@/lib/navigation/restauracion-ui";

const Context = createContext<SessionCache | null>(null);
export function SessionDataProvider({ userId, revision, children }: { userId: string; revision: string; children: React.ReactNode }) {
  const [cache] = useState(() => new SessionCache(userId, fetch, () => window.location.replace(`/login?next=${encodeURIComponent(location.pathname)}`)));
  const previousRevision = useRef(revision);
  useEffect(() => {
    if (previousRevision.current !== revision) { previousRevision.current = revision; cache.invalidate(); }
  }, [cache, revision]);
  const lifecycle = useRef(0);
  const pathname = usePathname();
  const router = useRouter();
  useEffect(() => {
    const generation = ++lifecycle.current;
    const supabase = createClient();
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const sessionUser = session?.user.id ?? "";
      if (sessionUser === userId) return;
      // INITIAL_SESSION sale de la cookie local sin ir a la red. Si difiere
      // de lo que el servidor vio (una caida de Auth durante el render, por
      // ejemplo), recargar la pagina no lo arreglaria: volveria a diferir y
      // el bucle no acabaria nunca. Solo un cambio REAL de sesion (entrar,
      // salir, otra cuenta en otra pestaña) justifica tirar la pagina.
      if (event === "INITIAL_SESSION") return;
      cache.clear();
      // A hard navigation also discards private RSC entries held by Next.
      if (!sessionUser) window.location.replace("/login");
      else if (!userId) window.location.reload();
      else window.location.replace("/");
    });
    const resume = () => { if (document.visibilityState === "visible" && navigator.onLine) cache.refreshActive(); };
    // CustomEvent convierte un `detail` undefined en null, y null NO activa el
    // prefijo por defecto de invalidate(): sin este `?? undefined` las cuatro
    // llamadas a invalidateSessionData() sin argumento eran un no-op mudo.
    const invalidate = (event: Event) => cache.invalidate((event as CustomEvent<string | null | undefined>).detail ?? undefined);
    // Cambio de zona: lo guardado del inicio pertenece a la zona anterior y su
    // clave la lleva dentro. Se OLVIDA, no se invalida: invalidar lo volveria a
    // pedir con la cookie nueva y guardaria el feed de la zona nueva bajo la
    // clave de la vieja, y el consumidor —que ya calcula su clave con la zona
    // nueva— pediria otra vez. Con drop, la clave nueva se pide una sola vez.
    const zone = () => { cache.drop("/api/session/home"); router.refresh(); };
    window.addEventListener("vicino:data-invalidated", invalidate);
    window.addEventListener("vicino_location_updated", zone);
    window.addEventListener("focus", resume);
    window.addEventListener("online", resume);
    document.addEventListener("visibilitychange", resume);
    return () => {
      queueMicrotask(() => { if (lifecycle.current === generation) cache.clear(); });
      subscription.unsubscribe();
      window.removeEventListener("vicino:data-invalidated", invalidate);
      window.removeEventListener("vicino_location_updated", zone);
      window.removeEventListener("focus", resume); window.removeEventListener("online", resume);
      document.removeEventListener("visibilitychange", resume);
    };
  }, [cache, router, userId]);
  useEffect(() => { cache.refreshActive(); }, [cache, pathname]);
  return <Context.Provider value={cache}>{children}</Context.Provider>;
}

/**
 * Lo que trajo el render del servidor para esta clave.
 *
 * `key` es opcional y sirve cuando el consumidor todavia no puede calcular su
 * clave definitiva (el inicio, cuya clave lleva la zona leida de
 * `document.cookie` y durante la hidratacion vale `#unhydrated`): la semilla
 * se guarda bajo la clave que el servidor si conocia.
 */
export interface SessionSeed<T> { value: T; renderId: string; key?: string }

export function useSessionData<T>(key: string, seed?: SessionSeed<T>) {
  const cache = useContext(Context);
  if (!cache) throw new Error("SessionDataProvider missing");
  const subscribe = useCallback((listener: () => void) => cache.subscribe(key, listener), [cache, key]);
  const snapshot = useCallback(() => cache.snapshot<T>(key), [cache, key]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  const seedKey = seed?.key ?? key;
  // Antes que cualquier efecto pasivo: la lectura de abajo y el refreshActive
  // del proveedor tienen que encontrar la semilla ya guardada, o pedirian al
  // servidor lo que acaba de llegar con el HTML.
  useLayoutEffect(() => {
    if (seed) cache.seed(seedKey, seed.value, seed.renderId);
  }, [cache, seedKey, seed]);
  // La lectura de montaje se DEMORA un instante a proposito. Cuando se vuelve
  // a una pestaña, `loading.tsx` monta este mismo consumidor mientras el
  // servidor ya esta renderizando la pagina con las mismas consultas: pedir la
  // API en ese momento paga el trabajo dos veces. Si el render llega dentro de
  // la ventana, su semilla siembra la memoria y esta lectura ya no hace falta
  // (el TTL la descarta). Si no llega, se pide igual y la pestaña se pinta sin
  // esperar al servidor. Una revalidacion forzada (retry, aviso, foco) no pasa
  // por aqui y sigue siendo inmediata.
  useEffect(() => {
    if (key.endsWith("#unhydrated")) return;
    const timer = setTimeout(() => void cache.load(key), 250);
    return () => clearTimeout(timer);
  }, [cache, key]);
  // En el servidor y durante la hidratacion la memoria esta vacia: se pinta
  // la semilla, que es exactamente lo que el HTML lleva. Con la cache vaciada
  // (cierre de sesion) no se vuelve a ella: ya no es de nadie.
  const shown: Snapshot<T> = value.data === undefined && seed && cache.active
    ? { data: seed.value, updatedAt: 0, pending: false }
    : value;
  return { ...shown, retry: () => cache.load(key, true), mutate: (update: (data: T) => T) => cache.mutate(key, update), userId: cache.userId };
}
const subscribeLocation = (listener: () => void) => {
  window.addEventListener("vicino_location_updated", listener);
  return () => window.removeEventListener("vicino_location_updated", listener);
};
const locationScope = () => locationScopeFromDocumentCookie(document.cookie);
export function useLocationScope() { return useSyncExternalStore(subscribeLocation, locationScope, () => "unhydrated"); }

export function useSessionUI<T>(key: string, initial: T): [T, (value: T) => void] {
  const cache = useContext(Context);
  const [value, setValue] = useState<T>(() => (cache?.ui.get(key) as T | undefined) ?? initial);
  return [value, (next: T) => { cache?.ui.set(key, next); setValue(next); }];
}
export function DataRetry({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <p role="status" className="py-2 text-sm text-fg-muted">{error} <button type="button" onClick={retry} className="underline">Reintentar</button></p> : null;
}

/**
 * Recuerda el scroll de una pestaña y lo devuelve al volver por navegacion de
 * pestaña (barra inferior, barra lateral, deslizar).
 *
 * Solo restaura si hay una navegacion de pestaña pendiente hacia esta ruta
 * (ver lib/navigation/restauracion-ui.ts): esos enlaces navegan con
 * `scroll: false`, asi que aqui se coloca el scroll en un efecto de layout,
 * antes de pintar y sin salto. Un enlace cualquiera a la misma ruta (el logo,
 * un «Ver mas») no marca nada, Next hace su scroll al inicio de siempre y
 * aqui no se toca. Se consume UNA sola vez: cuando el contenido en espera se
 * sustituye por el render del servidor, el segundo montaje ya no salta sobre
 * lo que la persona esta mirando.
 */
export function SessionScroll({ route, scope = route }: { route: string; scope?: string }) {
  const cache = useContext(Context);
  useLayoutEffect(() => {
    if (!cache) return;
    const key = `scroll:${scope}`;
    const restauracion = location.pathname === route ? consumirRestauracion(route) : "nada";
    if (restauracion !== "nada") {
      // «arriba» es una marca que ya no sirve (caducada o de otra ruta): la
      // navegacion fue con scroll:false, asi que hay que subir o la pestaña
      // heredaria el scroll de la anterior.
      const y = restauracion === "restaurar" ? cache.ui.get(key) : 0;
      window.scrollTo({ top: typeof y === "number" ? y : 0, behavior: "instant" });
    }
    const save = () => { if (location.pathname === route) cache.ui.set(key, window.scrollY); };
    window.addEventListener("scroll", save, { passive: true });
    return () => { window.removeEventListener("scroll", save); };
  }, [cache, route, scope]);
  return null;
}
