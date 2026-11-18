import * as Sentry from "@sentry/nextjs";
import { SupabaseClient } from "@supabase/supabase-js";
import { supabaseIntegration } from "@supabase/sentry-js-integration";
import { sanitizeBodySupabase } from "./lib/observability/saneo-supabase";
import { sanearBreadcrumb, sanearEvento } from "./lib/observability/saneo-ubicacion";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

Sentry.init({
  dsn: process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN,
  environment: process.env.VERCEL_ENV ?? "development",
  // Release: el SHA del commit desplegado. Lo inyecta next.config.ts. Sin esto
  // ningun evento de produccion es atribuible a un despliegue, y "que se rompio
  // hoy" no se puede contestar.
  release: process.env.NEXT_PUBLIC_RELEASE,
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
  // Coordenadas, cuerpos y cookies fuera de Sentry. Aun con sendDefaultPii en
  // false, el SDK 10.75 adjunta la URL y la query de la peticion, su cuerpo
  // (los argumentos de las Server Actions), la cabecera cookie y las cookies
  // (la de sesion de Supabase incluida) y las cabeceras x-vercel-ip-*
  // (geolocalizacion por IP); onRequestError deja la ruta con query en
  // contexts.nextjs, y el fetch al snapshot de Apple deja en la miga y en el
  // span la query con center y la firma. Solo cambia lo que llevan los
  // eventos: beforeSend y beforeSendTransaction nunca devuelven null.
  beforeBreadcrumb: sanearBreadcrumb,
  beforeSend: sanearEvento,
  beforeSendTransaction: sanearEvento,
  integrations: [
    supabaseIntegration(SupabaseClient, Sentry, {
      tracing: true,
      breadcrumbs: false,
      errors: true,
      // Sin esto, un error de escritura manda en contexts.supabase.body los
      // valores de primer nivel del cuerpo (university_name entre ellos).
      sanitizeBody: sanitizeBodySupabase,
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
