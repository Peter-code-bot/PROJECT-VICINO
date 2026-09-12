type Modules = [typeof import("@sentry/capacitor"), typeof import("@sentry/react")];
type Estado = "idle" | "initializing" | "ready" | "failed";
type EstadoNativo = { state: Estado; jsClient: boolean; nativeBridge: "unverified" | "unavailable" };
type PlataformaNativa = "android" | "ios";

/** Plataforma nativa con SDK de Sentry enlazado, o undefined en web y SSR. */
export function plataformaNativa(): PlataformaNativa | undefined {
  if (typeof window === "undefined") return undefined;
  const p = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();
  return p === "android" || p === "ios" ? p : undefined;
}

/** Inyectable para transporte de pruebas. El callback publico de init acredita
 * el cliente JS; el SDK no expone aqui confirmacion publica del puente Android.
 */
export function crearInicializadorSentry(load: () => Promise<Modules>) {
  let status: EstadoNativo = { state: "idle", jsClient: false, nativeBridge: "unverified" };
  let promise: Promise<EstadoNativo> | undefined;
  let attempts = 0;
  let importFailed = false;
  let modules: Modules | undefined;

  const init = (retry = false): Promise<EstadoNativo> => {
    // El callback nativo puede completar despues del timeout local. En ese
    // caso el estado listo es la fuente vigente para llamadas posteriores.
    if (status.state === "ready") return Promise.resolve(status);
    if (promise && !(retry && status.state === "failed" && importFailed && attempts < 2)) return promise;
    attempts++;
    importFailed = false;
    status = { ...status, state: "initializing" };
    promise = (async () => {
      try { modules = await load(); }
      catch {
        importFailed = true;
        status = { state: "failed", jsClient: false, nativeBridge: "unavailable" };
        return status;
      }
      const [native, react] = modules;
      if (react.getClient()) {
        status = { state: "ready", jsClient: true, nativeBridge: "unverified" };
        return status;
      }
      return new Promise<EstadoNativo>((resolve) => {
        let initialized = false;
        const timer = setTimeout(() => {
          status = { state: "failed", jsClient: Boolean(react.getClient()), nativeBridge: "unavailable" };
          resolve(status);
        }, 5_000);
        const finish = (state: Estado) => {
          clearTimeout(timer);
          status = { state, jsClient: Boolean(react.getClient()), nativeBridge: state === "ready" ? "unverified" : "unavailable" };
          resolve(status);
        };
        try {
          // Se lee aqui y no al cargar el modulo: iniciarSentryNativo ya
          // garantizo que hay plataforma nativa antes de llegar a este punto.
          // Si aun asi faltara, se falla en vez de adivinar: etiquetar eventos
          // de iOS como android-production corromperia lo que vinimos a medir.
          const plataforma = plataformaNativa();
          if (!plataforma) return finish("failed");
          native.init({
            // Mientras no exista proyecto iOS propio, iOS cae en el DSN movil
            // y se distingue por environment. Separarlos es anadir la variable.
            dsn: plataforma === "ios"
              ? (process.env.NEXT_PUBLIC_SENTRY_DSN_IOS ?? process.env.NEXT_PUBLIC_SENTRY_DSN_MOBILE)
              : process.env.NEXT_PUBLIC_SENTRY_DSN_MOBILE,
            environment: `${plataforma}-production`,
            release: `vicino@${process.env.NEXT_PUBLIC_VERSION ?? "dev"}`,
            dist: (plataforma === "ios"
              ? process.env.NEXT_PUBLIC_IOS_BUILD
              : process.env.NEXT_PUBLIC_ANDROID_BUILD) ?? "1",
            sampleRate: 1.0,
            tracesSampleRate: 1.0,
            integrations: [react.browserTracingIntegration({
              instrumentNavigation: false, instrumentPageLoad: false,
              traceFetch: false, traceXHR: false, enableLongTask: false,
              enableLongAnimationFrame: false, enableInp: false,
            })],
            // Las metricas manuales no deben heredar URL, query ni breadcrumbs
            // con datos de chats. La captura de errores mantiene su SDK nativo.
            beforeSendTransaction(event) {
              event.request = undefined;
              event.user = undefined;
              event.breadcrumbs = undefined;
              event.contexts = event.contexts?.trace ? { trace: event.contexts.trace } : undefined;
              event.spans = [];
              return event;
            },
          }, (options) => {
            // Capacitor llama asincronamente a este callback, incluso tras
            // fallback del puente. No arrojar hacia su cadena interna de promesas.
            if (initialized) return;
            initialized = true;
            try {
              react.init(options);
              finish(react.getClient() ? "ready" : "failed");
            } catch { finish("failed"); }
          });
        } catch { finish("failed"); }
      });
    })();
    return promise;
  };
  return { init, estado: () => status, sdk: () => status.jsClient ? modules?.[1] : undefined };
}

const bootstrap = crearInicializadorSentry(() => Promise.all([import("@sentry/capacitor"), import("@sentry/react")]));
export function iniciarSentryNativo(retry = false) {
  if (!plataformaNativa()) {
    return Promise.resolve<EstadoNativo>({ state: "idle", jsClient: false, nativeBridge: "unavailable" });
  }
  return bootstrap.init(retry);
}

export function categoriaRuta(path: string) {
  if (path === "/") return "home";
  if (path === "/buscar") return "search";
  if (path === "/perfil") return "profile";
  if (path === "/chat") return "chat_list";
  if (path.startsWith("/chat/")) return "chat_detail";
  if (path === "/seller" || path.startsWith("/seller/")) return "seller";
  return "other";
}

type Span = ReturnType<Modules[1]["startInactiveSpan"]>;
export function crearObservadorRutas(sdk: () => Pick<Modules[1], "startInactiveSpan"> | undefined) {
  let pending: { path: string; start: number; span: Span; timer: ReturnType<typeof setTimeout> } | undefined;
  const close = (result: "committed" | "cancelled" | "timeout") => {
    if (!pending) return;
    const current = pending;
    pending = undefined;
    clearTimeout(current.timer);
    current.span.setAttribute("result", result);
    if (result === "committed") current.span.setAttribute("native.route_commit_ms", performance.now() - current.start);
    current.span.end();
  };
  return {
    start(url: string, currentPath: string) {
      close("cancelled");
      const client = sdk();
      if (!client) return "not_ready";
      let path: string;
      try { path = new URL(url, "https://local.invalid").pathname; } catch { return "unmeasured"; }
      // Query-only transitions quedan explicitamente fuera de la medida.
      if (path === currentPath) return "unmeasured_query";
      const span = client.startInactiveSpan({
        name: "native.route_commit_ms", op: "navigation", forceTransaction: true,
        attributes: { route_category: categoriaRuta(path) },
      });
      pending = { path, span, start: performance.now(), timer: setTimeout(() => close("timeout"), 30_000) };
      return "started";
    },
    commit(path: string) { if (pending?.path === path) close("committed"); },
    dispose() { close("cancelled"); },
  };
}
const routes = crearObservadorRutas(() => bootstrap.sdk());
export const empezarRutaNativa = routes.start;
export const confirmarRutaNativa = routes.commit;
export const cerrarRutaNativa = routes.dispose;
