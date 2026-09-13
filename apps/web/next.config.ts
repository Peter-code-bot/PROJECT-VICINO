import { withSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import withPWAInit from "@ducanh2912/next-pwa";
import bundleAnalyzer from "@next/bundle-analyzer";

// El HTML de navegacion NO se cachea. Es el punto 0 del plan de onboarding, y
// es un arreglo independiente de el.
//
// Por defecto next-pwa mete la navegacion en tres cachES NetworkFirst
// —"pages", "pages-rsc" y "pages-rsc-prefetch"— con maxAgeSeconds: 86400 y sin
// networkTimeoutSeconds. Ninguna de las tres es inofensiva aqui: cuando la red
// falla o tarda, sirven el HTML de hasta 24 h de antes, y ese HTML apunta a
// chunks de JS que el deploy siguiente ya borro. El resultado no es "la app un
// poco desactualizada": es pantalla en blanco por un 404 de chunk. Por eso
// tambien se apagan cacheStartUrl Y dynamicStartUrl, que entre las dos ponen
// una entrada "start-url" NetworkFirst y se comerian el home —justo la
// pantalla mas importante— antes de llegar a las reglas de abajo.
//
// HACEN FALTA LAS DOS, y no es redundancia: comprobado en el sw.js generado.
// La documentacion del paquete dice que dynamicStartUrl solo aplica "cuando
// cacheStartUrl es true", pero su implementacion registra la ruta mirando
// UNICAMENTE dynamicStartUrl. Con cacheStartUrl: false a solas, el sw.js
// seguia trayendo registerRoute("/", NetworkFirst, "start-url") por delante de
// todo lo demas — o sea el home cacheado, que es justo lo que se venia a
// arreglar. cacheStartUrl gobierna el precache; dynamicStartUrl, la ruta.
//
// EL CAMBIO TIENE UN COSTE, y conviene tenerlo escrito: navegar sin red deja
// de mostrar la ultima pagina vista y pasa a mostrar el error del navegador.
// Se acepta porque una pantalla en blanco intermitente estando ONLINE es peor
// que un error honesto estando offline, y porque la app ya avisa de la falta
// de red por su cuenta (OfflineDetector en app/layout.tsx). Los estaticos
// —JS, CSS, imagenes, fuentes— siguen cacheados igual: aqui solo se toca el
// documento.
//
// extendDefaultRuntimeCaching: true es OBLIGATORIO, no cosmetico. Su valor por
// defecto es false, y con false pasar `runtimeCaching` REEMPLAZA la lista
// entera de defaults en vez de completarla: se perderia el cacheado de todos
// los estaticos de golpe. Con true, una entrada con el mismo `cacheName` que
// una default la sobreescribe y el resto se conserva intacto.
//
// OJO AL TOCAR LOS urlPattern DE ABAJO: workbox NO los ejecuta aqui, los
// SERIALIZA con .toString() y los escribe dentro de sw.js. O sea que cada
// matcher tiene que bastarse a si mismo. Cualquier cosa que venga del ambito
// de este archivo —un helper, una constante, un import— existe al construir
// pero NO existe en el service worker, y alli se convierte en un
// ReferenceError en cada fetch.
//
// El modo de fallo es de los feos: el build pasa, el sw.js generado ensena las
// estrategias correctas, y la app se rompe solo en el navegador del usuario.
// Aqui ya habia un helper `sinApi(pathname)` compartido por los tres matchers
// y hacia exactamente eso; por eso la condicion va repetida y en crudo.
const withPWA = withPWAInit({
  dest: "public",
  disable: process.env.NODE_ENV === "development",
  register: true,
  cacheStartUrl: false,
  dynamicStartUrl: false,
  // Su default es true, y significa un location.reload() DURO en cada evento
  // "online", sin debounce ni guarda. Salir de casa (WiFi a datos) o ir en
  // camion tira la pagina entera y con ella lo que el vendedor estuviera
  // escribiendo. Y como el HTML ya es NetworkOnly, la recarga sale por un
  // enlace que todavia no transporta datos. El OfflineDetector ya avisa de la
  // vuelta de la red y ya ofrece un boton de reintentar: la recarga automatica
  // es redundante y destructiva.
  reloadOnOnline: false,
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    runtimeCaching: [
      {
        urlPattern: ({ request, url: { pathname }, sameOrigin }) =>
          request.headers.get("RSC") === "1" &&
          request.headers.get("Next-Router-Prefetch") === "1" &&
          sameOrigin &&
          !pathname.startsWith("/api/"),
        handler: "NetworkOnly",
        options: { cacheName: "pages-rsc-prefetch" },
      },
      {
        urlPattern: ({ request, url: { pathname }, sameOrigin }) =>
          request.headers.get("RSC") === "1" && sameOrigin && !pathname.startsWith("/api/"),
        handler: "NetworkOnly",
        options: { cacheName: "pages-rsc" },
      },
      {
        // Solo NAVEGACIONES. Antes esta condicion era `sameOrigin && no /api/`,
        // que es un cajon de sastre: casaba tambien /_next/image, los chunks y
        // todo lo demas del mismo origen.
        //
        // Eso no era inofensivo por como funciona extendDefaultRuntimeCaching:
        // NO conserva el orden, empuja las entradas propias PRIMERO y anexa las
        // por defecto detras. `pages` estaba en la posicion 16 de 17, detras de
        // todos los estaticos; el override la subio a la 3. Y como el router de
        // workbox devuelve la PRIMERA coincidencia, tapaba 10 de las 17 reglas
        // — entre ellas next-image, que se quedo sin cache ninguna.
        //
        // request.mode === "navigate" es exactamente lo que esta cache pretende
        // cubrir, y no puede tapar a nadie mas.
        urlPattern: ({ request, sameOrigin }) =>
          request.mode === "navigate" && sameOrigin,
        handler: "NetworkOnly",
        options: { cacheName: "pages" },
      },
      {
        // Las respuestas REST y de Auth de Supabase NUNCA se cachean.
        //
        // La regla por defecto de APIs las guardaba una hora indexadas SOLO por
        // URL, sin distinguir quien las pidio. En un telefono compartido eso
        // deja que la segunda cuenta reciba datos de la primera, y se sirven
        // justo cuando la red va mal, que es cuando nadie sospecha. No es
        // rendimiento: es una fuga entre cuentas.
        //
        // Se acota a /rest/v1/ y /auth/v1/ a proposito: las fotos publicas de
        // /storage/v1/object/public/ no llevan datos de nadie y conviene que
        // sigan cacheandose.
        urlPattern: ({ url }) =>
          url.hostname.endsWith(".supabase.co") &&
          (url.pathname.startsWith("/rest/v1/") ||
            url.pathname.startsWith("/auth/v1/")),
        handler: "NetworkOnly",
        options: { cacheName: "supabase-sin-cache" },
      },
    ],
  },
});

// A3 sub-fase 3.7: bundle analyzer solo activo con ANALYZE=true env.
// Builds normales (Vercel, dev) NO se afectan — pasa-through cuando enabled=false.
const withBundleAnalyzer = bundleAnalyzer({
  enabled: process.env.ANALYZE === "true",
});

// Content-Security-Policy
//
// Starts as Report-Only so the PWA service-worker registration, Realtime
// websocket, and Leaflet tile loads cannot break production silently if a
// directive is misjudged. Promote to "Content-Security-Policy" (enforce)
// after monitoring the browser console for blocked requests for 1–2 days.
//
// connect-src must include both https://*.supabase.co (REST/Auth/Storage)
// AND wss://*.supabase.co (chat Realtime) — without wss the chat breaks.
// https://*.upstash.io is pre-listed for the rate-limit helper in Bloque 3.
// worker-src 'self' blob: is required by @ducanh2912/next-pwa, which can
// register the SW from a blob URL during hot-reload.
// manifest-src 'self' keeps the PWA manifest fetchable for "Add to Home".
/**
 * Endpoint de reportes de CSP, derivado del DSN de Sentry.
 *
 * La politica lleva meses en Report-Only con la intencion de "monitorear la
 * consola del navegador 1-2 dias y luego promoverla a enforce". Nunca se
 * promovio, y no por descuido: sin un destino donde reportar, las violaciones
 * solo aparecen en la consola de quien casualmente tenga las DevTools abiertas.
 * No hay forma de saber si es seguro promoverla.
 *
 * Con esto las violaciones llegan a Sentry y la decision pasa a tener datos.
 * Anadir report-uri no puede romper nada: los reportes de CSP no estan sujetos a
 * la propia CSP, asi que no hace falta tocar connect-src.
 *
 * Se usa report-uri y no el Report-To moderno a proposito: es lo que documenta
 * Sentry y lo que entienden todos los navegadores hoy.
 */
function sentryCspReportUri(): string | null {
  const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (!dsn) return null;

  try {
    const u = new URL(dsn);
    const projectId = u.pathname.replace(/^\//, "");
    if (!projectId || !u.username) return null;
    return `${u.protocol}//${u.host}/api/${projectId}/security/?sentry_key=${u.username}`;
  } catch {
    // Un DSN mal formado no puede tumbar el build: se queda sin reportes y ya.
    return null;
  }
}

/**
 * Solo PRODUCCION reporta.
 *
 * Estas cabeceras tambien las sirve Vercel en cada preview, y encima de la
 * pagina de deployment-protection, que es suya y no nuestra. De ahi salian los
 * "Blocked 'font' from 'vercel.com'" y los "Blocked 'connect' from
 * 'vicinomarket-<hash>-peters-projects-*.vercel.app'": violaciones reales de
 * una pagina que no es de la app, mezcladas con las nuestras en el mismo
 * proyecto de Sentry. Ademas el flujo de despliegue no usa el preview como
 * puerta, asi que esos reportes no tenian lector.
 */
const cspReportUri =
  process.env.VERCEL_ENV === "production" ? sentryCspReportUri() : null;

const cspDirectives = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.apple-mapkit.com",
  "style-src 'self' 'unsafe-inline'",
  // unpkg.com se cae: solo servia los iconos por defecto de Leaflet y b4718dd
  // borro las tres urls que los pedian. *.tile.openstreetmap.org SE QUEDA: la
  // migracion a MapKit no fue total, comunidades/admin/centro-map.tsx sigue
  // montando react-leaflet con TileLayer de OSM.
  "img-src 'self' data: blob: https://*.supabase.co https://firebasestorage.googleapis.com https://picsum.photos https://i.pravatar.cc https://images.unsplash.com https://*.googleusercontent.com https://*.tile.openstreetmap.org https://*.apple-mapkit.com https://*.apple.com",
  // media-src NO EXISTIA, asi que el video caia en default-src 'self' y cada
  // reproduccion se reportaba: los .mov/.mp4 de product-media en Supabase y las
  // previsualizaciones blob: de /vender y de la resena.
  "media-src 'self' blob: https://*.supabase.co",
  "font-src 'self' data:",
  // Dos anadidos que NO son laxitud, son cosas que la app de verdad pide:
  // - *.tile.openstreetmap.org: el service worker de next-pwa registra un
  //   NetworkFirst para TODO lo cross-origin, asi que vuelve a pedir cada tile
  //   por fetch() y eso se mide contra connect-src, no contra img-src.
  // - *.ingest.us.sentry.io: en el shell de Capacitor, si el SDK nativo no
  //   arranca, @sentry/capacitor reinicia el SDK de JS con su transporte fetch
  //   por defecto y manda los envelopes directo al ingest, sin pasar por el
  //   tunel. Sin esta entrada, promover la CSP apagaria el Sentry del movil.
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://*.upstash.io https://nominatim.openstreetmap.org https://*.tile.openstreetmap.org https://*.apple-mapkit.com https://*.apple.com https://*.ingest.us.sentry.io",
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(cspReportUri ? [`report-uri ${cspReportUri}`] : []),
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "geolocation=(self), camera=(), microphone=()",
  },
  { key: "Content-Security-Policy-Report-Only", value: cspDirectives },
];

const nextConfig: NextConfig = {
  turbopack: {},
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  images: {
    formats: ["image/avif", "image/webp"],
    // Sin estas dos listas, Next usa sus defaults: 8 deviceSizes + 8 imageSizes,
    // o sea hasta 16 anchos distintos por imagen, cada uno en avif y webp. Eso
    // no es un problema de velocidad, es de CUOTA: el plan Hobby de Vercel tiene
    // topes duros de optimizacion de imagenes y al superarlos pausa el proyecto
    // hasta el siguiente ciclo. Con un marketplace donde cada publicacion lleva
    // galeria, se llega antes de lo que parece.
    //
    // Se recortan los extremos que VICINO no usa:
    //   - 2048 y 3840 son pantallas 4K/5K. La app es movil primero y su vista
    //     mas ancha en escritorio es una tarjeta dentro de una rejilla.
    //   - de los imageSizes se quitan 16, 32 y 64: los avatares mas pequeños
    //     del producto son de 48 px, y por debajo de eso no hay nada.
    //
    // Degrada con gracia: si un componente pide un ancho que ya no esta, Next
    // sirve el siguiente mayor. Se ve igual, pesa un poco mas, no se rompe nada.
    deviceSizes: [640, 750, 828, 1080, 1200, 1920],
    // Se anade 480. Sin el, una tarjeta de 160 px a DPR2 pide 393 px de
    // dispositivo, se pasa por NUEVE pixeles del candidato de 384 y salta al
    // siguiente, que es 640: 19.551 B en vez de 9.012 B por foto.
    imageSizes: [48, 96, 128, 256, 384, 480],
    // Sin esto Vercel tira la variante optimizada a las 4 h y la vuelve a
    // transformar, y cada re-transformacion vuelve a bajar el original desde
    // Supabase. Con seis anchos vivos por foto en AVIF y WebP, es cuota
    // quemada en repetir trabajo ya hecho — la misma cuota que, agotada,
    // pausa el proyecto. 31 dias es el maximo que acepta Next.
    // Un dia, no un mes. Con 31 dias, borrar una foto dejaba de borrarla: la
    // variante optimizada se sigue sirviendo desde la cache aunque el original ya
    // no exista en Storage, porque la clave es (url, ancho, calidad) y esa url se
    // puede volver a pedir. Un dia ya quita de encima el grueso de las
    // re-transformaciones frente a las 4 h por defecto.
    minimumCacheTTL: 86400,
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.supabase.co",
      },
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
      },
      {
        protocol: "https",
        hostname: "picsum.photos",
      },
      {
        protocol: "https",
        hostname: "i.pravatar.cc",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
      },
      {
        protocol: "https",
        hostname: "**.googleusercontent.com",
      },
    ],
  },
  experimental: {
    // A3 sub-fase 3.2: tree-shake barrel exports of the UI libraries we actually
    // import. Confirmed against apps/web/package.json — only these 6 packages
    // are direct deps. Next.js will silently skip any package here that isn't
    // installed, so the list is safe even if a Radix dep is removed later.
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "@radix-ui/react-dialog",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-popover",
    ],
    // A5.3 (historico): aqui vivia `viewTransition: true`. Next 16.3.0 quito
    // la clave del esquema ("Remove inert experimental.viewTransition flag",
    // vercel/next.js#96098): ya era INERTE en 16.2, porque el App Router usa
    // React canary y las navegaciones son transiciones de React de serie, asi
    // que `<ViewTransition>` y los `viewTransitionName` inline de
    // product-card.tsx / product-gallery-carousel.tsx funcionan sin bandera.
    // Con 16.3 la clave rompe `tsc` (TS2353) y el esquema `strictObject` de
    // next.config la rechaza. No hay kill-switch que preservar: no hacia nada.
  },
};

// Sentry wraps PWA's transformed config (Sentry outermost). tunnelRoute keeps
// ingest requests same-origin so CSP/ad-blockers don't drop them; the
// middleware matcher excludes /sentry-tunnel so it stays a pass-through.
// A3 sub-fase 3.7: bundleAnalyzer en medio (entre Sentry y PWA) — solo
// intercepta build stats cuando ANALYZE=true; con enabled=false es identity.
export default withSentryConfig(withBundleAnalyzer(withPWA(nextConfig)), {
  org: "vicino-5r",
  project: "vicino-web",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  tunnelRoute: "/sentry-tunnel",
  // hideSourceMaps was removed in @sentry/nextjs 8+. The equivalent is now
  // nested under sourcemaps — uploads still happen, but the public client
  // bundle does not ship the .map files alongside.
  sourcemaps: {
    deleteSourcemapsAfterUpload: true,
  },
  disableLogger: true,
  // Saca del bundle del navegador codigo que aqui no se usa nunca. El chunk
  // compartido pesa 277.979 B gzip y es el 73% de lo que se descarga en TODA
  // pagina; buena parte es @sentry/nextjs con instrumentacion que no aplica a
  // un navegador.
  bundleSizeOptimizations: {
    excludeDebugStatements: true,
    // shadowDom e iframe son seguras: la app no usa ninguna (Radix no monta shadow
    // DOM). excludeReplayWorker NO se pone: sin un workerUrl propio que lo
    // sustituya, quitar el worker no ahorra red, solo hace que los replays de
    // error se suban SIN comprimir.
    excludeReplayShadowDom: true,
    excludeReplayIframe: true,
  },
  automaticVercelMonitors: false,
});
