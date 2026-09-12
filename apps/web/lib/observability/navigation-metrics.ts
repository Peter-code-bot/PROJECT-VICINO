export type NavigationKind = "home" | "search" | "profile" | "chat_list" | "chat_detail" | "product" | "other";
export function navigationKind(path: string): NavigationKind {
  if (path === "/") return "home";
  if (path === "/buscar") return "search";
  if (path === "/perfil") return "profile";
  if (path === "/chat") return "chat_list";
  if (path.startsWith("/chat/")) return "chat_detail";
  if (/^\/[^/]+\/[^/]+$/.test(path) && !/^\/(seller|admin|perfil|vendedor|vender|historial|api|solicitudes|citas)\//.test(path)) return "product";
  return "other";
}
type Source = "link" | "swipe" | "refresh" | "back_forward";
export type NavigationSample = {
  id: number; from: NavigationKind; to: NavigationKind; source: Source;
  feedback_ms: number | null; route_commit_ms: number | null; core_dom_ms: number | null;
  result: "ready" | "cancelled" | "timeout" | "redirected";
};

/** Raw destinations exist only while matching a navigation. Exported samples
 * contain fixed categories/timings, never URLs, query strings or user data. */
export function createNavigationMetrics(now: () => number = () => performance.now()) {
  let sequence = 0;
  const samples: NavigationSample[] = [];
  let pending: { sample: NavigationSample; target: string; start: number; previous: Set<string> } | undefined;
  function close(result: NavigationSample["result"]) {
    if (!pending) return;
    samples.push({ ...pending.sample, result });
    if (samples.length > 40) samples.shift();
    pending = undefined;
  }
  return {
    begin(target: string, current: string, source: Source, previous: string[]) {
      close("cancelled");
      const from = navigationKind(new URL(current, "https://local.invalid").pathname);
      const to = navigationKind(new URL(target, "https://local.invalid").pathname);
      const id = ++sequence;
      pending = { target, previous: new Set(previous), start: now(), sample: {
        id, from, to, source, feedback_ms: null, route_commit_ms: null, core_dom_ms: null, result: "cancelled",
      } };
      return id;
    },
    feedback(id: number) { if (pending?.sample.id === id && pending.sample.feedback_ms === null) pending.sample.feedback_ms = now() - pending.start; },
    commit(target: string) {
      if (!pending) return;
      if (target !== pending.target) { close("redirected"); return; }
      pending.sample.route_commit_ms ??= now() - pending.start;
    },
    ready(token: string, kind: string) {
      if (!pending || pending.previous.has(token) || pending.sample.to !== kind) return;
      // A refresh does not change URL: its new server marker is the commit.
      if (pending.sample.source === "refresh") pending.sample.route_commit_ms ??= now() - pending.start;
      if (pending.sample.route_commit_ms === null) return;
      pending.sample.core_dom_ms = now() - pending.start;
      close("ready");
    },
    close,
    active: () => Boolean(pending),
    read: () => samples.map(sample => ({ ...sample })),
    clear: () => { pending = undefined; samples.length = 0; },
  };
}

// Installed by the mounted marketplace observer; no-op during SSR or tests
// that do not mount it. No second SDK or remote analytics transport.
let driver: { begin: (target: string, source: Source) => number; feedback: (id: number) => void } | undefined;
export function installNavigationMetrics(value: typeof driver) { driver = value; }
export const beginNavigation = (target: string, source: Source) => driver?.begin(target, source) ?? 0;
export const navigationFeedback = (id: number) => driver?.feedback(id);
