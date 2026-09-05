"use client";

import { useEffect } from "react";
import { Capacitor } from "@capacitor/core";

// Module-level guard: Sentry.init may panic if called twice. The Next.js
// router can re-mount client components during navigation; we only ever
// want a single init across the lifetime of the WebView session.
let initialized = false;

export function CapacitorSentryInit() {
  useEffect(() => {
    if (initialized) return;
    if (!Capacitor.isNativePlatform()) return;
    initialized = true;

    // Dynamic imports so the @sentry/capacitor + @sentry/react chunks do NOT
    // ship to the regular web bundle (where instrumentation-client.ts handles
    // init via @sentry/nextjs instead — D2 gate).
    Promise.all([import("@sentry/capacitor"), import("@sentry/react")]).then(
      ([SentryCapacitor, SentryReact]) => {
        SentryCapacitor.init(
          {
            dsn: process.env.NEXT_PUBLIC_SENTRY_DSN_MOBILE,
            environment: "android-production",
            release: `vicino@${process.env.NEXT_PUBLIC_VERSION ?? "dev"}`,
            dist: process.env.NEXT_PUBLIC_ANDROID_BUILD ?? "1",
            sampleRate: 1.0,
            // Al 0.05 solo se veia 1 de cada 20 navegaciones, insuficiente para
            // sacar una linea base. onRouterTransitionStart ya esta exportado en
            // instrumentation-client, asi que cada navegacion del App Router emite
            // una transaccion `navigation` cuya duracion ES el hueco entre el toque
            // y la pantalla nueva: la metrica exacta del problema. Subirlo no cambia
            // el comportamiento de la app, solo cuanto se mide. Bajar a ~0.2 cuando
            // haya volumen real: el plan gratis da 5M spans/mes.
            tracesSampleRate: 1.0,
            // Session Replay intentionally omitted: removed entirely in
            // @sentry/capacitor v4.x. Native crash capture (Java/Kotlin/NDK)
            // is still automatic via the bundled sentry-android lib.
          },
          SentryReact.init,
        );
      },
    );
  }, []);

  return null;
}
