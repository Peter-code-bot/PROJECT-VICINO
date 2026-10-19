# Android sin red: por qué no salía offline.html (19-oct-2026)

Rama `fix/sw-offline-fallback-20261019`, sin push. Capturas y logcat en la carpeta de notas de la
sesión (`side-session-notes/local_3363794b-…/sin-red-20261019/`).

## Resumen

Al abrir la app Android sin red salía la página genérica del WebView ("Webpage not available —
net::ERR_FAILED") aunque `server.errorPath: 'offline.html'` está en `capacitor.config.ts` y
`offline.html` está en los assets del APK. **No es un fallo de Capacitor ni de la versión
(8.3.0 / 8.4.3): es el service worker.** Con el SW instalado, el WebView nunca le avisa a
Capacitor de que la navegación falló, y `errorPath` no salta.

El arreglo es **web** y llega con el deploy, sin AAB nuevo: el SW devuelve su propia página sin
red (`public/offline.html`) cuando la navegación falla. `errorPath` sigue haciendo falta para el
caso sin SW, y ese sí necesita el AAB 10.

## La causa

1. Capacitor solo carga `errorPath` desde `BridgeWebViewClient.onReceivedError` y
   `onReceivedHttpError`, y solo si `request.isForMainFrame()` (`@capacitor/android` 8.4.3,
   `BridgeWebViewClient.java`). No hay otro camino.
2. Con el SW instalado, la navegación a `https://vicinomarket.com/` la contesta la regla `pages`
   de `next.config.ts` (`request.mode === "navigate"`, `NetworkOnly`). Sin red, su `fetch` falla,
   workbox lanza `no-response`, el `respondWith` se rechaza y Chromium pinta su página de error
   con `net::ERR_FAILED`.
3. El WebView **no llama a `onReceivedError`** en ese caso: el fallo ocurrió dentro del service
   worker, no en una carga de red del marco. Capacitor no se entera.

Sin SW la navegación sale a la red de verdad, falla con `ERR_INTERNET_DISCONNECTED`, el WebView
llama a `onReceivedError` y Capacitor carga `https://localhost/offline.html`.

## Las pruebas

Emulador `vicino34` (Android 14, WebView 113.0.5672.136), APK debug de Capacitor 8.4.3 con
`errorPath` y depuración (el del worktree de la barra de estado, `versionCode 9`). Animaciones a 0
y `hide_error_dialogs 1`. Sin red con `svc wifi disable` + `svc data disable`.

| # | Estado | Resultado | Evidencia |
|---|---|---|---|
| 1 | `pm clear` (sin SW), sin red | **offline.html** | logcat `Handling local request: https://localhost/offline.html`; CDP `href = https://localhost/offline.html` |
| 2 | SW activo (abierta antes con red), sin red | **"Webpage not available — net::ERR_FAILED"** | logcat `The FetchEvent for "https://vicinomarket.com/" resulted in a network error response` y `no-response … workbox-130d51c8.js`; ningún `Handling local request`; CDP `href = chrome-error://chromewebdata/` |
| 3 | Mismo proceso que 2, `Network.setBypassServiceWorker(true)` por CDP y navegar | **offline.html** | `Page.navigate` → `net::ERR_INTERNET_DISCONNECTED` (antes `ERR_FAILED`); `Handling local request: https://localhost/offline.html` |

La 3 es la que demuestra la causa: misma instalación, mismo proceso, misma falta de red; lo único
que cambia es que el SW no conteste.

Ojo con el protocolo de prueba de la Fase 2 (`PLAN-ANDROID-2026-10-03.md`, paso 2): "modo avión →
abrir la app → debe salir Sin conexión" **falla en cualquier teléfono que haya abierto la app
con red antes**, que es todo el que la usa. Habría parecido que el AAB 10 no funcionaba.

## El arreglo (web)

- `next.config.ts`: `fallbacks: { document: "/offline.html" }`. next-pwa precachea esa página y
  le pone a cada regla de `runtimeCaching` un `handlerDidError` que, para un documento, la
  devuelve. Solo actúa cuando el `fetch` **falla**; un 404 o un 500 del servidor llegan igual.
- `public/offline.html`: la misma página que `dist/offline.html`, con tres diferencias
  (explicadas en su cabecera): Reintentar recarga la URL que falló, quita el splash por el puente
  de Capacitor (servida por el SW sí está en el origen de la app) y lleva `noindex`.
- `proxy.ts`: `offline.html` y `fallback-*.js` fuera del matcher. `requiereSesion()` las trata
  como privadas y a un invitado se le redirige a `/login` (producción hoy: `/offline.html` → 307).
  - `fallback-<hash>.js` lo genera next-pwa y `sw.js` lo carga con `importScripts`, que **no
    sigue redirects**. Con el redirect, el script del SW se cae entero: queda "activado" pero
    sin precache, sin rutas y sin manejador `fetch`. **Pasó en la primera versión de este
    arreglo con `pnpm build` en verde y el `sw.js` generado correcto**; solo se vio entrando al
    SW con Playwright (`caches` vacío, `self.fallback` indefinido, `curl` del script → 307).
  - `offline.html` la precachea el SW siguiendo el redirect: habría guardado la página de login
    como página sin red.
- `.gitignore`: `public/fallback-*.js(.map)`, generado en cada build como `sw.js`.

**Hay dos copias de la página** (`public/` para el SW, `dist/` para `errorPath`). Diseño y
textos iguales; si Javier cambia una, hay que cambiar la otra.

### Qué cubre cada capa

| Situación | Hoy | Con el deploy | Con el AAB 10 |
|---|---|---|---|
| SW instalado, sin red (lo normal) | error genérico | **página sin red del SW**, en cualquier AAB | igual |
| Sin SW: primer arranque sin red, datos borrados | error genérico | error genérico | **offline.html por errorPath** |
| Web en el navegador, sin red | dinosaurio | página sin red del SW | — |

El SW nuevo solo lo recibe quien abra la app con red al menos una vez después del deploy.

## Verificación del arreglo

- `pnpm build` en verde (dos veces; la segunda con el matcher corregido). `eslint` limpio en
  `proxy.ts` y `next.config.ts`.
- `sw.js` generado: 259 entradas de precache y **una sola HTML**, `/offline.html`; sin ruta
  `start-url`; `importScripts("/fallback-ce627215c0e4a9af.js")`; las 21 reglas de
  `runtimeCaching` con su estrategia de antes y un `handlerDidError`; ningún identificador del
  config colado.
- Matcher compilado (`.next/server/functions-config-manifest.json`): excluye `/offline.html` y
  `/fallback-….js`; siguen pasando por el proxy `/`, `/perfil`, `/login`, `/offline`,
  `/offline.htmlx`.
- `next start` local: `/offline.html` y `/fallback-….js` → 200 sin cookies; `/perfil` → 307.
- Dentro del SW (Playwright, Chromium): precache con 259 entradas, `self.fallback` es función,
  `caches.match("/offline.html")` → 200, sin redirect, con esta página. Producción, para
  comparar: 255 entradas.
- Fallo de red **real** (servidor apagado con el SW instalado y controlando la página):
  `/`, `/perfil?prueba=1` y `/buscar?q=mesa#arriba` muestran "Sin conexión" **con su URL
  intacta**. Reintentar con el servidor caído recarga y vuelve la misma página. Reintentar con
  el servidor de vuelta carga la respuesta real.
- En la app, sobre el origen real: `Capacitor.nativePromise("SplashScreen", "hide", {})` existe
  y resuelve.

**No verificado:** la página del SW dentro del WebView de la app. La app no admite HTTP en claro
(`cleartext: false`, `ERR_CLEARTEXT_NOT_PERMITTED` contra `http://127.0.0.1`) y el Chrome 113
del emulador registra el SW pero no lo arranca. Para el WebView es una respuesta 200 normal del
SW; hay que confirmarlo con un preview de Vercel o tras el deploy: abrir la app con red, cerrar,
modo avión, abrir → "Sin conexión" sin esperar al splash.

## Lo que necesita el AAB 10 (nativo, pendiente)

- Nada nuevo para este fallo: `errorPath` ya está en la config y funciona (prueba 1).
- Lo heredado: `capacitor.settings.gradle` versionado apunta a 8.3.0 y `package.json` fija 8.4.3;
  hace falta `pnpm install` + `npx cap sync android` antes de construir.
- **Decisión:** con `errorPath`, el splash tapa `offline.html` hasta su techo de 15 s
  (`launchShowDuration`), porque en `https://localhost` la página no tiene puente de Capacitor y
  no puede quitarlo (prueba 1: `offline.html` a los 1.1 s del arranque, el splash se quita a los
  ~17 s). Arreglarlo es nativo (por ejemplo, quitar el splash desde `MainActivity` cuando la URL
  cargada es la de error).
- **A revisar antes del AAB 10:** Capacitor también carga `errorPath` desde
  `onReceivedHttpError`, o sea con cualquier 4xx/5xx del documento principal: un 404 o un 500
  de la web podría acabar en "Sin conexión". Leído en `BridgeWebViewClient`, **sin reproducir**
  (a un invitado las rutas inexistentes le dan 307 a `/login`, no 404). Con el SW delante
  probablemente tampoco salta, por lo mismo que `onReceivedError`.
- El paso 2 del protocolo de la Fase 2 hay que hacerlo con los datos de la app borrados (o
  recién instalada) para probar `errorPath`; con el SW instalado se prueba el arreglo web.
