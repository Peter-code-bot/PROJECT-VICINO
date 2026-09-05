import * as Sentry from "@sentry/nextjs";

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
});
