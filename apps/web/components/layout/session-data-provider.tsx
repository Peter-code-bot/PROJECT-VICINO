"use client";
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { SessionCache } from "@/lib/session-cache";

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
      if (event === "INITIAL_SESSION" && !session && !userId) return;
      if ((session?.user.id ?? "") !== userId) {
        cache.clear();
        // A hard navigation also discards private RSC entries held by Next.
        window.location.replace(session ? "/" : "/login");
      }
    });
    const resume = () => { if (document.visibilityState === "visible" && navigator.onLine) cache.refreshActive(); };
    const invalidate = (event: Event) => cache.invalidate((event as CustomEvent<string | undefined>).detail);
    const zone = () => { cache.invalidate("/api/session/home"); router.refresh(); };
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
export function useSessionData<T>(key: string) {
  const cache = useContext(Context);
  if (!cache) throw new Error("SessionDataProvider missing");
  const subscribe = useCallback((listener: () => void) => cache.subscribe(key, listener), [cache, key]);
  const snapshot = useCallback(() => cache.snapshot<T>(key), [cache, key]);
  const value = useSyncExternalStore(subscribe, snapshot, snapshot);
  useEffect(() => { if (!key.endsWith("#unhydrated")) void cache.load(key); }, [cache, key]);
  return { ...value, retry: () => cache.load(key, true), mutate: (update: (data: T) => T) => cache.mutate(key, update), userId: cache.userId };
}
const subscribeLocation = (listener: () => void) => {
  window.addEventListener("vicino_location_updated", listener);
  return () => window.removeEventListener("vicino_location_updated", listener);
};
const locationScope = () => document.cookie.split(";").map(v => v.trim()).filter(v => /^vicino_(location|radius)=/.test(v)).sort().join(";");
export function useLocationScope() { return useSyncExternalStore(subscribeLocation, locationScope, () => "unhydrated"); }

export function useSessionUI<T>(key: string, initial: T): [T, (value: T) => void] {
  const cache = useContext(Context);
  const [value, setValue] = useState<T>(() => (cache?.ui.get(key) as T | undefined) ?? initial);
  return [value, (next: T) => { cache?.ui.set(key, next); setValue(next); }];
}
export function DataRetry({ error, retry }: { error?: string; retry: () => void }) {
  return error ? <p role="status" className="py-2 text-sm text-fg-muted">{error} <button type="button" onClick={retry} className="underline">Reintentar</button></p> : null;
}

export function SessionScroll({ route, scope = route }: { route: string; scope?: string }) {
  const cache = useContext(Context);
  useLayoutEffect(() => {
    if (!cache) return;
    const key = `scroll:${scope}`;
    const y = cache.ui.get(key);
    const frame = requestAnimationFrame(() => {
      if (typeof y === "number" && location.pathname === route) window.scrollTo({ top: y, behavior: "instant" });
    });
    const save = () => { if (location.pathname === route) cache.ui.set(key, window.scrollY); };
    window.addEventListener("scroll", save, { passive: true });
    return () => { cancelAnimationFrame(frame); window.removeEventListener("scroll", save); };
  }, [cache, route, scope]);
  return null;
}
