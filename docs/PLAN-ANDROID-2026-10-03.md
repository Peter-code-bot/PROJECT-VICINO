# Plan: error del preview del mapa y optimización de la app Android

**Fecha:** 3-oct-2026 · **Pedido por:** Pedro (captura del home en Android a las 15:18)
**Estado:** Fase 1 implementada y probada en la rama `fix/preview-mapa-caducidad`
(sin push; falta el OK de Pedro para llevarla a master = producción). Fase 2 con el código hecho
en `feat/android-renderer-y-sin-red` (sale de la Fase 1); falta probarla en un teléfono y armar el
AAB 10. El resto es propuesta.
Todo está medido o verificado el 3-oct, salvo donde dice "decisión" o "sin verificar".

---

## 0. Resumen

1. **El error no es de Android.** "Vista previa no disponible" + "Reintentar" sale **a los 5
   minutos exactos** de haber cargado el home, en cualquier plataforma. El preview del mapa
   caduca a propósito (TTL de 5 min) y el componente pinta la caducidad como si fuera un fallo.
   Reproducido el 3-oct en un navegador de escritorio contra producción: la imagen cargó a las
   15:22:47 y a las 15:27:55 apareció exactamente la pantalla de la captura.
2. **Sí aparece en iPhone.** Es el mismo código web dentro del WebView. En iOS es incluso más
   seguro que salga: WKWebView congela los temporizadores en segundo plano y, al volver, el de
   5 minutos se dispara de golpe.
3. **El arreglo es pequeño (Fase 1, ~medio día con pruebas)** y no cambia la apariencia.
4. **La app Android es la web.** `server.url = https://vicinomarket.com`, así que el 80-90 % del
   rendimiento que nota un usuario Android se decide en la web. La medición móvil del home da
   **35/100, LCP 10.9 s y 5.5 s de bloqueo del hilo principal**; el JS es el problema principal.
5. **Lo nativo tiene cuatro huecos concretos:** R8 apagado (15.5 MB de dex), nada maneja la muerte
   del proceso del WebView, no hay página local de error sin red, y en Android se cargan **dos**
   SDK de Sentry. El requisito de 16 KB de Google Play ya se cumple (verificado).

---

## 1. El error "Vista previa no disponible"

### 1.1 Qué es

El recuadro de arriba del home es `LocationMapPreview`
([location-map-preview.tsx](../apps/web/components/map/location-map-preview.tsx)). Pide un PNG a
`POST /api/map-preview`, que firma en el servidor una petición al snapshot de Apple Maps, y lo
guarda como `blob:` en una caché de documento
([map-preview-cache.ts](../apps/web/lib/geo/map-preview-cache.ts)).

### 1.2 Causa raíz

- `map-preview-cache.ts:4` → `TTL_MS = 300_000` (5 min). Decisión de diseño de S11 ("imagen
  temporal… cinco minutos", `docs/S11-DESCUBRIMIENTO-MAPA-2026-09-30.md`).
- `map-preview-cache.ts:61` → al vencer el TTL revoca la imagen y pone `status: "expired"`, **sin
  volver a pedirla**. Está probado así a propósito (`scripts/test-s11-preview.ts`, "expiry … makes
  no automatic request").
- `location-map-preview.tsx:50` → `const unavailable = status === "error" || status === "expired"`.
  **Aquí está el fallo:** la caducidad normal se pinta igual que un error del proveedor
  (`:60` "Vista previa no disponible", `:66` botón "Reintentar").

En un teléfono el camino típico es: abrir la app → salir a WhatsApp → volver a los 6 minutos →
el mapa ya no está y la app dice que "no está disponible".

### 1.3 Causa secundaria (mismo síntoma, menos frecuente)

Un fallo transitorio también se queda pegado: la caché lo recuerda "hasta reintento explícito"
(`map-preview-cache.ts:67`, probado en `test-s11-preview.ts`). Ejemplos en móvil: la petición estaba
en vuelo cuando la app pasó a segundo plano, o tardó más de los 15 s del cliente
(`map-preview-cache.ts:44`; el PNG pesa 200 KB para México y ~780 KB para una zona). Nada vuelve a
intentar al recuperar la red ni al volver a la app, aunque el patrón ya existe en el proyecto
(`session-data-provider.tsx:73-88`, `use-coverage-listings.ts:73-75`).

Descartado el 3-oct: el endpoint funciona en producción (200, `image/png`, tema claro y oscuro,
con y sin centro).

### 1.4 Arreglo propuesto → Fase 1

Ver Fase 1 abajo. La caché no se toca (sigue sin pedir nada por su cuenta); la política vive en el
componente.

---

## 2. Línea base medida (3-oct-2026)

| Qué | Valor | Cómo se midió |
|---|---|---|
| Lighthouse móvil, home visitante | **35/100** | Lighthouse 12, emulación de gama media (CPU ×4, 4G lenta) |
| FCP / LCP | 2.0 s / **10.9 s** | ídem |
| Total Blocking Time | **5,520 ms** | ídem |
| Time to Interactive | 11.1 s | ídem |
| Elemento LCP | **el preview del mapa** (`blob:`) | 86 % del LCP es espera: necesita hidratar, luego POST, luego Apple |
| Trabajo del hilo principal | 18.9 s (11.8 s evaluando JS) | ídem |
| Chunk `8416-…js` | 276 KB comprimido / **903 KB** sin comprimir; 11.2 s de arranque en la emulación | Contiene React DOM, Sentry (con Replay y profiling), Supabase Auth/Realtime y workbox |
| JS total del home | 652 KB comprimido / 1.97 MB, 38 archivos | Resource Timing en producción |
| HTML del home | 468 KB sin comprimir (24 KB con brotli) | curl |
| Nodos DOM del home | ~2,500 | Lighthouse y DOM real |
| Imagen del preview | 202 KB PNG; Lighthouse estima 159 KB de ahorro con formato moderno | Lighthouse |
| Dex en el AAB (versionCode 9) | **15.5 MB** (`classes.dex` 7.9 + `classes2.dex` 7.5), R8 apagado | `unzip -l` del AAB |
| Librerías nativas y 16 KB | **Todas alineadas a 16 KB** (`libsentry*.so`, `libdatastore_shared_counter.so`, arm64 y x86_64) | lectura de cabeceras ELF del AAB |

Referencia de presupuesto: Alex Russell (2026) propone ~0.3 MiB de JS para cargar en 3 s en un
sitio ligero en JS y ~0.62 MiB para uno pesado. El home ya está en 1.97 MB sin comprimir.

---

## 3. Qué se usa para optimizar Android (investigación)

**V** = verificado en documentación oficial. **C** = comunidad o blog.

| Técnica | Aplica con `server.url`? | Impacto | Esfuerzo | Fuente |
|---|---|---|---|---|
| Bajar JS y costo de hidratación de la web | Sí, es lo principal | Alto | M-L | V: Lighthouse; C: Russell 2026 |
| Manejar `onRenderProcessGone` (devolver `true` y recrear el WebView) | Sí | Alto en gama baja | M | V: Android "Handle WebView termination" |
| `server.errorPath` con página local sin red | Sí | Medio (y riesgo de revisión de tienda) | S | V: Capacitor config |
| R8 + `shrinkResources` + `proguard-android-optimize.txt` | Sí | Medio (tamaño, arranque nativo) | M, con riesgo | C: issue de Capacitor #6189 y #8589 (R8 full mode con AGP 8.13) |
| `WebViewCompat.startUpWebView` (arranque del WebView en segundo plano) | Sí | Bajo-medio | M | V: estable en androidx.webkit **1.16.0**; el proyecto usa 1.14.0 |
| `Profile.preconnect` a vicinomarket.com / Supabase | Sí | Bajo | S-M | V: estable desde androidx.webkit 1.15.0 |
| Prefetch / prerender de WebView | Poco: Next ya hace su prefetch | Bajo | M | V |
| Live Updates (Capgo, Capawesome) en vez de URL remota | **No** sin un export estático de Next | Alto, pero es otra arquitectura | L | V: Capacitor dice que `server.url` "is not intended for use in production" |
| Soporte de páginas de 16 KB | Ya cumplido | (obligatorio) | Hecho | C: plazo extendido al 31-may-2026 |
| Edge-to-edge (SDK 36) | Ya se maneja con `env(safe-area-inset-*)` y `density` en `configChanges` | — | Hecho | V: Capacitor 8 |
| Android vitals: crash ≥1.09 %, ANR ≥0.47 % (8 % por modelo) | Sí | Visibilidad en Play | S (vigilar) | V: Play Console Help |
| web-vitals en campo, etiquetado por plataforma | Sí | Medición | S | `GoogleChrome/web-vitals` |
| Lighthouse CI con presupuestos | Sí | Evita regresiones | S | `GoogleChrome/lighthouse-ci`, `treosh/lighthouse-ci-action` |
| Baseline Profiles / Macrobenchmark | Poco: el contenido es web | Bajo | M | `android/performance-samples` |

**Repositorios revisados (existen y tienen actividad reciente, 3-oct-2026):**

- `ionic-team/capacitor` (★16.7k): fuente del `BridgeWebViewClient`. Confirmado en
  `node_modules`: si ningún listener maneja `onRenderProcessGone`, devuelve `false` y Android mata la app.
- `Cap-go/capacitor-webview-crash` (★2, sep-2026): plugin que registra un `WebViewListener` y
  recrea la actividad. Es pequeño y nuevo: **sirve como referencia, no como dependencia**.
- `Cap-go/capacitor-updater` (★864) y `capawesome-team/capacitor-plugins` (★488): live updates.
  Solo valen para assets empaquetados, así que no aplican hoy.
- `android/performance-samples` (★1.4k): Macrobenchmark y Baseline Profiles.
- `GoogleChrome/web-vitals` (★8.6k), `GoogleChrome/lighthouse-ci` (★7.1k),
  `treosh/lighthouse-ci-action` (★1.3k): medición y guardas.

---

## 4. Plan por fases

Reglas que aplican a todas las fases (de `docs/PENDIENTES-2026-09-26.md` y `CLAUDE.md`): la
apariencia no cambia sin Javier; `pnpm build` local antes de cada push; loop CODEX después de
tocar código; push a master = producción, así que necesita el OK de Pedro.

### Fase 0: medir antes de tocar (S, ~2 h)

- Guardar como baseline el JSON de Lighthouse de hoy (35 / 10.9 s / 5.5 s).
- `pnpm --filter web analyze` para ver de qué está hecho el chunk de 903 KB (cuánto es React DOM,
  cuánto Sentry Replay, cuánto Supabase Realtime).
- Medir en un Android real de gama baja con `chrome://inspect`. Hace falta un build de depuración
  porque `webContentsDebuggingEnabled` solo se enciende en desarrollo (`capacitor.config.ts`).
- Anotar crash y ANR actuales de Android vitals (la app sigue en prueba cerrada, así que habrá pocos datos).

### Fase 1: arreglar el preview — HECHA (rama `fix/preview-mapa-caducidad`)

Lo que se implementó:

1. Nueva política pura en `apps/web/lib/geo/map-preview-recarga.ts`; `map-preview-cache.ts` no cambia
   y sigue sin pedir nada por su cuenta.
2. `location-map-preview.tsx`: la caducidad ya **no** se pinta como "Vista previa no disponible";
   se vuelve a pedir sola con la página a la vista y con red. Si caducó en segundo plano, espera a
   que el usuario vuelva (`visibilitychange`, `resume` de Capacitor o `focus`). Si caducó sin red,
   espera al evento `online`.
3. Un fallo real se sigue mostrando y **no** se reintenta en el acto. Se reintenta una sola vez al
   volver o al recuperar la red; después queda el botón.
4. Tope: 6 recargas automáticas **seguidas sin nadie mirando** (media hora de inicio olvidado en
   pantalla). Volver a la app o pulsar "Reintentar" repone el presupuesto. Se descartó un tope fijo
   por documento: en Capacitor el documento vive días, y ese tope le devolvía el error a quien entra
   y sale muchas veces.
5. Hallazgo de Capacitor que lo condiciona: en Android el WebView **no se pausa** al salir de la app
   (`KeepRunning` vale `true` por defecto en `Bridge.shouldKeepRunning`), así que el TTL vence en
   segundo plano. Al volver, Capacitor dispara `resume` en `document`.

Pruebas (todas en verde el 3-oct):
- `scripts/test-preview-recarga.ts`: 13/13, la política pura.
- `scripts/test-preview-recarga-browser.ts`: 9/9. Es el componente real en Chromium con reloj falso:
  caducidad visible, en segundo plano, sin red, fallo, botón, tope y que volver lo reponga.
  **Falla con el componente anterior**, o sea que reproduce el bug.
- Regresión: `test-s11-preview.ts` 10/10, `test-s12-preview-browser.ts` 14/14, `tsc`, `eslint` y
  `pnpm build`.
- Arreglo del arnés de S12: el PNG falso se genera una sola vez. Un `toBlob` dentro de cada fetch
  falso se colgaba en Chromium tras algunos clics y la suite fallaba de forma intermitente, también
  sin este cambio. Queda otra intermitencia **previa y ajena**: la comprobación de desbordamiento
  horizontal del cajón en tema oscuro (`test-s12-preview-browser.ts:154`), que falla de vez en
  cuando con y sin el arreglo.

Pendiente: probarlo en un teléfono Android y en un iPhone (abrir la app, salir 6 minutos, volver).

Coste: a lo más una petición a Apple más por cada vuelta a la app después de 5 min. Es lo mismo
que hoy cuesta que el usuario pulse "Reintentar".

### Fase 2: robustez del contenedor nativo — CÓDIGO HECHO (rama `feat/android-renderer-y-sin-red`); falta probarla en un teléfono

Lo que se implementó:

1. **Muerte del renderer** (`android/app/src/main/java/com/vicino/mx/MainActivity.java`): un
   `WebViewListener` cuyo `onRenderProcessGone` devuelve `true` y hace `recreate()`. La actividad
   nueva trae un WebView nuevo que vuelve a cargar `server.url`. El WebView muerto lo destruye
   Capacitor al desmontar (`BridgeActivity.onDetachedFromWindow` → `bridge.onDetachedFromWindow`
   → `webView.destroy()`). Freno de bucle: si vuelve a morir antes de 30 s, cierra la actividad
   en lugar de recrearla. Cada caso se reporta a Sentry (proyecto Android) sin PII, con las
   etiquetas `renderer.crash`, `renderer.prioridad` y `renderer.accion`. Los métodos llevan
   `@RequiresApi(O)` porque el callback solo existe desde API 26 y el `minSdk` es 24.
2. `app/build.gradle`: `io.sentry:sentry-android:8.35.0`, el mismo artefacto y versión que ya
   trae `@sentry/capacitor` (lo declara como `implementation` y por eso no se veía desde el módulo
   de la app). **Si se actualiza `@sentry/capacitor`, igualar esta versión.**
3. **Sin red al abrir:** `server.errorPath: 'offline.html'` y `apps/web/dist/offline.html`: página
   autocontenida, con los colores del tema claro y un botón de 48 px que se reintenta sola con el
   evento `online` y se reactiva a los 10 s si la navegación se cuelga. Capacitor la sirve desde
   `https://localhost/offline.html`; comprobado en `Bridge.getErrorUrl` y en el servidor local, que
   atiende `localhost` desde los assets. **Texto y diseño provisionales: los revisa Javier.**
4. `.gitignore`: `dist/` estaba ignorado también desde el `.gitignore` raíz. Ahora se versionan
   solo `dist/index.html` (lo exige `cap sync`) y `dist/offline.html`; un clon limpio ya puede
   hacer `cap sync`.

Verificado aquí: `gradlew :app:compileDebugJavaWithJavac` OK, Android lint 0 errores (20 avisos
previos, ninguno en `MainActivity`), `tsc` OK, `cap sync`/`cap copy` dejan `offline.html` en
`assets/public`, la página se ve bien a 375 px (sin desbordamiento) y no hay descargas por
navegación en la web que `errorPath` pudiera tapar. **No probado en dispositivo:** esta máquina
tiene 7.4 GB de RAM con 1.2 GB libres, y un emulador la habría trabado.

**Protocolo de prueba en teléfono (Pedro, con USB debugging):**

1. Build de depuración con inspección del WebView. En PowerShell:
   `cd apps/web; $env:NODE_ENV='development'; npx cap sync android; cd android; ./gradlew assembleDebug`.
   Luego `adb install -r app/build/outputs/apk/debug/app-debug.apk`. Ojo: tiene el mismo
   `applicationId` que la de Play con otra firma, así que hay que desinstalar la de Play antes
   (se pierde la sesión).
2. **Sin red:** modo avión → abrir la app → debe salir "Sin conexión" (no la página genérica de
   Android). "Reintentar" con modo avión → "Conectando…" y vuelve la misma página. Quitar el modo
   avión → entra sola al inicio.
3. **Renderer:** con la app abierta, `chrome://inspect` en la PC → inspeccionar el WebView → en
   la consola: `let a=[]; while(true) a.push(new Array(1e7).fill(1))`. Se acaba la memoria del
   renderer. Con `adb logcat -s VicinoWebView` debe verse
   `Renderer del WebView terminado: crash=true ... bucle=false` y la app **sigue abierta** y vuelve
   a cargar el inicio. Repetirlo antes de 30 s → `bucle=true` y la actividad se cierra sin
   crash. Revisar el evento en Sentry (proyecto Android).
4. Antes del AAB de release: volver a `npx cap sync android` **sin** `NODE_ENV=development` (si
   no, el WebView de producción queda inspeccionable) y subir `versionCode` a 10. El AAB 9 está
   en revisión desde el 3-oct.
5. iOS: `errorPath` también aplica en el siguiente build de iOS. Hay que probar ahí el modo avión.

### Fase 3: bajar el peso de la web (M-L, por partes; es la de más impacto)

Por orden de rendimiento esperado contra riesgo:

1. **Un solo Sentry en Android.** `instrumentation-client.ts` importa `@sentry/nextjs` (con Replay
   y `supabaseIntegration`) de forma estática; en Capacitor no lo inicializa, pero igual se descarga
   y se evalúa, y además `sentry-nativo.ts` carga `@sentry/capacitor` + `@sentry/react`. Mover el
   SDK web a `import()` solo cuando no es Capacitor, y cargar Replay después del arranque
   (`Sentry.addIntegration(...)`, como recomienda la guía de Replay de Sentry). Verificar con el
   analizador que el chunk baja.
2. **`tracesSampleRate: 1.0`** en web (`instrumentation-client.ts:25`) y en nativo
   (`sentry-nativo.ts:84`): bajarlo a 0.1-0.2 en producción. Ahorra CPU y cuota.
   Decisión de Pedro, porque el comentario dice que se dejó en 1.0 "durante verificación".
3. **Preview del mapa como LCP.** Hoy no puede empezar a bajar hasta que React hidrata.
   - a) Convertir el PNG a WebP en `/api/map-preview` (con `sharp`, que ya trae Next):
     unos 160 KB menos por imagen y menos riesgo de pasar los 15 s con datos móviles.
   - b) Para el caso sin ubicación (México, igual para todos los visitantes) servir una imagen que
     entre en el HTML del servidor con `fetchpriority="high"`. **Decisión de Pedro:** S11 eligió a
     propósito no guardar imágenes del proveedor; hay que revisar los términos de Apple sobre
     caché de snapshots antes de hacerlo.
4. **Hidratar menos en el home.** ~2,500 nodos y 468 KB de HTML. Opciones: pintar en el servidor
   solo las primeras filas de carrusel y dejar las demás para cuando se acerquen a pantalla
   (`content-visibility: auto` o carga por intersección), y revisar qué partes del home son
   `"use client"` sin necesitarlo. Medir cada paso con Lighthouse.
5. **Fuentes.** Dos `woff2` precargadas no se usan en los primeros segundos (aviso de consola en
   producción). Quitar `preload` a la fuente que no es crítica.
6. **Prefetch.** El home dispara 25 peticiones RSC de prefetch (12 rutas). Con datos móviles,
   valorar `prefetch={false}` en las tarjetas de producto. Impacto bajo: 60 KB en total.

Criterio de aceptación de la fase: Lighthouse móvil del home ≥ 60, TBT < 2 s, LCP < 4 s, sin
cambio visual (capturas antes y después a 375 y 1280).

### Fase 4: build nativo (M, ~1-2 días con pruebas en dispositivo)

1. **R8.** En `android/app/build.gradle:38-39`: `minifyEnabled true`, `shrinkResources true` y
   `proguard-android-optimize.txt`. Reglas de keep para Capacitor (`@CapacitorPlugin`,
   `@PluginMethod`, `@JavascriptInterface`, puente de Cordova, y las anotaciones por el bug de R8
   full mode con AGP 8.13, issue #8589), FCM y Sentry. Subir `mapping.txt` a Play y a Sentry.
   Probar **cada** plugin (cámara, geolocalización, push/FCM, browser, haptics, keyboard,
   network, splash, status bar, app) en prueba interna antes de producción. Riesgo alto si se
   salta una regla: el fallo sale solo en release.
2. **androidx.webkit 1.16+** y `WebViewCompat.startUpWebView` desde una clase `Application`
   propia, para adelantar el arranque del WebView mientras se ve el splash. Añadir
   `Profile.preconnect` a `vicinomarket.com` y al host de Supabase. Medir el arranque en frío
   antes y después; si no gana más de ~100 ms en gama baja, no vale la complejidad.
3. **`android:largeHeap="true"`**: el renderer del WebView es otro proceso, así que esto no le da
   memoria al contenido web. Quitarlo solo después de medir memoria en un teléfono de 3-4 GB.

### Fase 5: guardas para no volver a empeorar (S-M)

- `web-vitals` (LCP, INP, CLS) enviados a Sentry con etiqueta `platform: android | ios | web`.
  Hoy no hay ningún dato de campo de Android.
- Lighthouse CI en GitHub Actions sobre `/` en móvil, con presupuesto de JS y de TBT. Primero
  hay que arreglar el CI, que está rojo por lint desde septiembre.
- Revisar Android vitals cada semana cuando haya usuarios en producción.

### Fase 6: decisión de arquitectura (no ahora)

Capacitor dice que `server.url` "is not intended for use in production". La salida estándar es
empaquetar la web y actualizar con Live Updates. Con Next.js App Router, Server Actions, rutas
`/api` y SSR, eso exige un export estático y una separación de cliente y API: un proyecto
grande. **Recomendación: mantener la URL remota** y cubrir sus riesgos con las Fases 2 y 3.
Revisarlo solo si una tienda lo pide o si se necesita funcionar sin red.

---

## 5. Decisiones que necesito de Pedro

1. OK para llevar la Fase 1 a master (producción).
2. Tope del preview: aplicado como 6 recargas seguidas sin nadie mirando, que volver a la app repone.
3. `tracesSampleRate` de producción (propuesta: 0.1 web y nativo).
4. ¿Imagen de México en el HTML del servidor (Fase 3.3b)? Antes hay que revisar los términos de Apple.
5. Orden de las Fases 2-4. Propuesta: 1 → 2 → 3.1/3.2 → 4.1 → el resto.

---

## 6. Fuentes

- Android, "Handle WebView termination": https://developer.android.com/develop/ui/views/layout/webapps/handle-termination
- Android, "Optimize WebView startup": https://developer.android.com/develop/ui/views/layout/webapps/optimize-webview-startup
- Android, "Speculative loading in WebView": https://developer.android.com/develop/ui/views/layout/webapps/speculative-loading
- androidx.webkit releases: https://developer.android.com/jetpack/androidx/releases/webkit
- Capacitor config: https://capacitorjs.com/docs/config
- Capacitor 8 upgrade: https://capacitorjs.com/docs/updating/8-0
- Capacitor, `minifyEnabled` crash: https://github.com/ionic-team/capacitor/issues/6189
- Capacitor, R8 full mode y anotaciones: https://github.com/ionic-team/capacitor/issues/8589
- Capawesome, actualizar sin `server.url`: https://capawesome.io/blog/the-right-way-to-update-your-capacitor-app-remotely/
- Play Console, Android vitals: https://support.google.com/googleplay/android-developer/answer/9844486
- Sentry, Session Replay en Next.js: https://docs.sentry.io/platforms/javascript/guides/nextjs/session-replay/
- Alex Russell, "The Performance Inequality Gap, 2026": https://infrequently.org/2025/11/performance-inequality-gap-2026/
- 16 KB, plazo de Google Play (blog): https://medium.com/@venkatraman230/androids-16kb-page-size-migration-everything-you-need-to-know-november-2025-b5c3ccbd2a7a
- Cap-go/capacitor-webview-crash: https://github.com/Cap-go/capacitor-webview-crash
