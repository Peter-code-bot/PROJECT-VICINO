import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseIntegration } from "@supabase/sentry-js-integration";

// Anti-double-counting gate (D2): when the Next.js bundle runs inside the
// Capacitor Android WebView, we let @sentry/capacitor handle init instead.
// Without this, every JS error would be reported to both vicino-web and
// vicino-android, burning through the 5K/month free quota in days.
const isCapacitor =
  typeof window !== "undefined" &&
  (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    ?.isNativePlatform?.() === true;

if (!isCapacitor) {
  Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    // ERRORS: capture everything; quota is generous for typical pre-launch.
    sampleRate: 1.0,
    // TRACING: tiny slice — 5M span quota is per-month and shared org-wide.
    tracesSampleRate: 0.05,
    // SESSION REPLAY: do NOT record idle sessions; only when an error fires.
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 1.0,
    integrations: [
      Sentry.replayIntegration({
        // Marketplace data is PII-heavy (names, addresses, prices, messages).
        // Keep aggressive defaults — D4 in the integration plan.
        maskAllText: true,
        blockAllMedia: true,
      }),
      supabaseIntegration(SupabaseClient, Sentry, {
        tracing: true,
        breadcrumbs: true,
        errors: true,
      }),
    ],
    beforeSend(event, hint) {
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
}

// Required by App Router for client-side navigation transactions.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
