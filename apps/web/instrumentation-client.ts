import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseIntegration } from "@supabase/sentry-js-integration";
import { iniciarSentryNativo, empezarRutaNativa } from "./lib/observability/sentry-nativo";

// Anti-double-counting gate (D2): when the Next.js bundle runs inside the
// Capacitor Android WebView, we let @sentry/capacitor handle init instead.
// Without this, every JS error would be reported to both vicino-web and
// vicino-android, burning through the 5K/month free quota in days.
const isCapacitor =
  typeof window !== "undefined" &&
  (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform?.() === true;

/**
 * Lo unico que @supabase/sentry-js-integration lee del SDK (v8.js:156-232 en
 * 0.3.0). Si una version nueva de la integracion usa algo mas, hay que anadirlo
 * aqui: su tipo (index.d.ts) exige las tres funciones.
 */
const sentryParaSupabase = {
  startInactiveSpan: Sentry.startInactiveSpan,
  captureException: Sentry.captureException,
  addBreadcrumb: Sentry.addBreadcrumb,
  SEMANTIC_ATTRIBUTE_SENTRY_OP: Sentry.SEMANTIC_ATTRIBUTE_SENTRY_OP,
  SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN: Sentry.SEMANTIC_ATTRIBUTE_SENTRY_ORIGIN,
};

if (!isCapacitor) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    // Mismo release que el servidor, para que un evento de navegador y uno de
    // servidor del mismo despliegue caigan bajo la misma version.
    release: process.env.NEXT_PUBLIC_RELEASE,
    // ERRORS: capture everything; quota is generous for typical pre-launch.
    sampleRate: 1.0,
    // Conservar muestreo durante verificacion; las cuotas requieren consumo real.
    tracesSampleRate: 1.0,
    // SESSION REPLAY: do NOT record idle sessions; only when an error fires.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      // Replay NO va aqui: se carga despues del arranque (cargarReplay, abajo).
      // NO pasar el namespace `Sentry` entero: un `import * as` usado como VALOR
      // obliga a webpack a dar por usadas todas sus exportaciones y metia el SDK
      // completo (Replay, Feedback, profiling...) en el chunk de arranque.
      supabaseIntegration(SupabaseClient, sentryParaSupabase, {
        tracing: true,
        breadcrumbs: false,
        errors: true,
      }),
    ],
    beforeSend(event: Sentry.ErrorEvent, hint: Sentry.EventHint) {
      // Drop known noise that does not represent real bugs.
      const exception = hint?.originalException;
      const msg =
        exception instanceof Error
          ? exception.message
          : String(exception ?? "");
      if (/ResizeObserver loop|Non-Error promise rejection captured/.test(msg)) {
        return null;
      }
      return event;
    },
  });
  void cargarReplay();
} else {
  // Arranca imports del SDK antes de hidratar; el componente es fallback.
  void iniciarSentryNativo().catch(() => {});
}

export function onRouterTransitionStart(url: string, navigationType: "push" | "replace" | "traverse") {
  if (isCapacitor) {
    empezarRutaNativa(url, window.location.pathname);
  } else {
    Sentry.captureRouterTransitionStart(url, navigationType);
  }
}

/**
 * Session Replay (rrweb) es de lo mas pesado del SDK y no hace falta para
 * arrancar. Antes iba en `integrations` de Sentry.init, o sea dentro del chunk
 * principal que TODOS descargan y evaluan antes de hidratar, incluida la app
 * Android, que ni siquiera usa Replay (alli Sentry lo inicia @sentry/capacitor).
 * Patron de la guia de Replay de Sentry para Next.js: import dinamico +
 * addIntegration. Plan Android 3-oct-2026, Fase 3.1.
 */
async function cargarReplay(): Promise<void> {
  try {
    const { replayIntegration } = await import("@sentry/nextjs");
    Sentry.addIntegration(
      replayIntegration({
        // Marketplace data is PII-heavy (names, addresses, prices, messages).
        // Keep aggressive defaults — D4 in the integration plan.
        maskAllText: true,
        blockAllMedia: true,
      }),
    );
  } catch {
    // Sin Replay los errores se siguen reportando; no vale la pena tirar nada.
  }
}
