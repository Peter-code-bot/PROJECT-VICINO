import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseIntegration } from "@supabase/sentry-js-integration";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",
  // Al 0.05 solo se veia 1 de cada 20 navegaciones, insuficiente para
  // sacar una linea base. onRouterTransitionStart ya esta exportado en
  // instrumentation-client, asi que cada navegacion del App Router emite
  // una transaccion `navigation` cuya duracion ES el hueco entre el toque
  // y la pantalla nueva: la metrica exacta del problema. Subirlo no cambia
  // el comportamiento de la app, solo cuanto se mide. Bajar a ~0.2 cuando
  // haya volumen real: el plan gratis da 5M spans/mes.
  tracesSampleRate: 1.0,
  // Marketplace = PII heavy. Keep server PII off by default; opt in per
  // capture call when truly needed (e.g., user id but not email).
  sendDefaultPii: false,
  integrations: [
    supabaseIntegration(SupabaseClient, Sentry, {
      tracing: true,
      breadcrumbs: false,
      errors: true,
    }),
    // Prevent duplicate spans: supabaseIntegration creates named spans for
    // every query; if we also let the default fetch instrumentation trace
    // the underlying HTTP, we double-count toward the 5M span/month quota.
    Sentry.nativeNodeFetchIntegration({
      ignoreOutgoingRequests: (url) =>
        supabaseUrl !== "" &&
        (url.startsWith(`${supabaseUrl}/rest`) ||
          url.startsWith(`${supabaseUrl}/auth`)),
    }),
  ],
});
