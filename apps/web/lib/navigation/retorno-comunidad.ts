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

/** Per-entry provenance survives reload and popstate without guessing from history.length. */
export function installCommunityNavigation() {
  const push = history.pushState;
  const replace = history.replaceState;
  const path = () => location.pathname + location.search + location.hash;
  const read = (): CommunityNavigation | null => {
    const record = history.state?.[KEY] as CommunityNavigation | undefined;
    return record?.path === path() ? record : null;
  };
  let current = read();
  current ??= nextCommunityNavigation(null, path(), true);
  replace.call(history, { ...history.state, [KEY]: current }, "");
  const wrap = (original: History["pushState"], replacing: boolean): History["pushState"] => function (data, unused, url) {
    const target = new URL(url ?? location.href, location.href);
    const nextPath = target.pathname + target.search + target.hash;
    const next = nextPath === current?.path ? current : nextCommunityNavigation(current, nextPath, replacing);
    original.call(history, { ...data, [KEY]: next }, unused, url);
    current = next;
  };
  history.pushState = wrap(push, false);
  history.replaceState = wrap(replace, true);
  const pop = () => { current = read(); };
  window.addEventListener("popstate", pop);
  return () => {
    history.pushState = push;
    history.replaceState = replace;
    window.removeEventListener("popstate", pop);
  };
}

export function currentCommunityReturn(id: string, admin: boolean) {
  return communityReturn(history.state?.[KEY] ?? null, location.pathname + location.search + location.hash, id, admin);
}
