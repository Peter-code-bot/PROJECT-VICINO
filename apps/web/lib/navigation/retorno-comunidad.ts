import { destinoAutenticadoSeguro } from "../auth/destino-seguro";

const KEY = "vicinoCommunityNavigation";
export interface CommunityNavigation {
  path: string;
  previous: string | null;
  community: { id: string; origin: string } | null;
}
const communityRoute = (path: string) => /^\/comunidades\/([^/?#]+)(?:\/administrar)?\/?$/.exec(path.split(/[?#]/)[0]!);
const isAdmin = (path: string) => /^\/comunidades\/[^/]+\/administrar\/?$/.test(path.split(/[?#]/)[0]!);

export function nextCommunityNavigation(previous: CommunityNavigation | null, path: string, replace: boolean): CommunityNavigation {
  const safe = destinoAutenticadoSeguro(path);
  const match = communityRoute(safe);
  const same = previous?.community?.id === match?.[1];
  const origin = previous && !isAdmin(previous.path) ? destinoAutenticadoSeguro(previous.path) : "/";
  return {
    path: safe,
    previous: replace ? previous?.previous ?? null : previous?.path ?? null,
    community: match ? { id: match[1]!, origin: same ? previous!.community!.origin : origin } : null,
  };
}

export function communityReturn(state: CommunityNavigation | null, path: string, id: string, admin: boolean) {
  const root = `/comunidades/${encodeURIComponent(id)}`;
  const current = state?.path === path ? state : null;
  const previous = current?.previous;
  const safePrevious = previous && destinoAutenticadoSeguro(previous) === previous;
  if (admin) return { back: Boolean(safePrevious && previous.split(/[?#]/)[0] === root), href: root };
  const origin = current?.community?.id === id ? destinoAutenticadoSeguro(current.community.origin) : "/";
  const href = origin.split(/[?#]/)[0] === root || isAdmin(origin) ? "/" : origin;
  return { back: Boolean(safePrevious && previous === href && previous !== path), href };
}

interface CommunityHistoryEntry extends CommunityNavigation {
  version: 1;
  entryId: string;
}
interface RestoredEntry { navigation: CommunityNavigation; entryId: string | null }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COMMUNITY_NAVIGATION_UPDATED = "vicino:community-navigation-updated";
const currentPath = () => location.pathname + location.search + location.hash;
let replacement: { from: string; target: string; expires: number } | null = null;

function safePath(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 && destinoAutenticadoSeguro(value) === value;
}

/** History state is untrusted. Older entries are accepted without guessing their position. */
function readEntry(value: unknown): RestoredEntry | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const item = value as Record<string, unknown>;
  if (!safePath(item.path) || (item.previous !== null && !safePath(item.previous))) return null;
  let community: CommunityNavigation["community"] = null;
  if (item.community !== null) {
    if (!item.community || typeof item.community !== "object" || Array.isArray(item.community)) return null;
    const details = item.community as Record<string, unknown>;
    if (typeof details.id !== "string" || details.id.length > 200 || !safePath(details.origin)
      || communityRoute(item.path)?.[1] !== details.id) return null;
    community = { id: details.id, origin: details.origin };
  }
  if (item.version !== undefined || item.entryId !== undefined) {
    if (item.version !== 1 || typeof item.entryId !== "string" || !UUID.test(item.entryId)) return null;
  }
  return { navigation: { path: item.path, previous: item.previous as string | null, community },
    entryId: typeof item.entryId === "string" ? item.entryId : null };
}

/** Record our own replace intent before a community return; no router internals are read. */
export function markCommunityNavigationReplace(target: string): void {
  if (typeof window === "undefined" || !safePath(target)) return;
  replacement = { from: currentPath(), target, expires: Date.now() + 10_000 };
}

/** Local filter controls already update their UI; tell route provenance about their URL replacement. */
export function notifyCommunityNavigationReplacement(): void {
  window.dispatchEvent(new Event(COMMUNITY_NAVIGATION_UPDATED));
}

export interface CommunityNavigationObserver {
  observe: () => void;
  dispose: () => void;
}

/**
 * Observe committed routes and keep our metadata on each entry. Never replace
 * History methods: restoring a captured method can remove Next's URL observer.
 */
export function createCommunityNavigationObserver(): CommunityNavigationObserver {
  let current: CommunityHistoryEntry | null = null;
  let disposed = false;

  function observe(traversing = false) {
    if (disposed) return;
    const path = currentPath();
    const restored = readEntry(history.state?.[KEY]);
    let navigation: CommunityNavigation;
    let entryId: string;
    if (restored?.navigation.path === path) {
      navigation = restored.navigation;
      entryId = restored.entryId ?? crypto.randomUUID();
    } else {
      // Filters may replace the URL while preserving the same entry's metadata.
      const sameEntry = !!current && restored?.entryId === current.entryId;
      const requestedReplace = !traversing && !!replacement && replacement.expires > Date.now()
        && replacement.from === current?.path && replacement.target === path;
      navigation = nextCommunityNavigation(traversing ? null : current, path, sameEntry || requestedReplace);
      entryId = sameEntry ? current!.entryId : crypto.randomUUID();
    }
    if (replacement && (replacement.target === path || replacement.expires <= Date.now() || traversing)) replacement = null;
    current = { ...navigation, version: 1, entryId };
    try {
      // Preserve the framework's state opaquely; only our key is added. Omitting
      // the URL updates metadata without another navigation or router dispatch.
      const existing = history.state;
      history.replaceState({ ...(existing && typeof existing === "object" ? existing : {}), [KEY]: current }, "");
    } catch { /* Missing provenance uses the safe explicit return instead of blocking navigation. */ }
  }
  const traverse = () => observe(true);
  const hash = () => observe();
  window.addEventListener("popstate", traverse);
  window.addEventListener("hashchange", hash);
  window.addEventListener(COMMUNITY_NAVIGATION_UPDATED, hash);
  return { observe: () => observe(), dispose: () => {
    disposed = true;
    window.removeEventListener("popstate", traverse);
    window.removeEventListener("hashchange", hash);
    window.removeEventListener(COMMUNITY_NAVIGATION_UPDATED, hash);
  } };
}

export function currentCommunityReturn(id: string, admin: boolean) {
  return communityReturn(readEntry(history.state?.[KEY])?.navigation ?? null, currentPath(), id, admin);
}
