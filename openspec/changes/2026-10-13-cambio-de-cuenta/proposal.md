# Proposal — Cambio de cuenta (varias cuentas en un mismo dispositivo)

> Change: `2026-10-13-cambio-de-cuenta`. Rama `docs/cambio-de-cuenta-plan-20261013`
> sobre `master` `9aae1ed`. **Solo plan: este change no trae código de la app.**
> Pedro firma las decisiones D1–D6 del final antes de cualquier `/opsx:apply`.

## Why

Pedro pidió el 13-oct-2026 que VICINO permita **cambiar de cuenta sin cerrar
sesión**, como lo hace Instagram: desde el menú de hamburguesa, tocar el perfil
y poder **elegir otra cuenta ya guardada** o **agregar una nueva**. La
referencia explícita es el selector de cuentas de Instagram; se hizo ingeniería
inversa de ese flujo y de los de TikTok y X para no inventar convenciones.

El caso de uso real en un marketplace de barrio es concreto: una persona compra
con su cuenta personal y vende con la de su negocio (`profiles.seller_type` y
`nombre_negocio` ya existen para eso), o dos personas de la misma familia
comparten un teléfono. Hoy la única manera de pasar de una cuenta a otra es
cerrar sesión (`hooks/use-logout.ts`), volver a `/login`, teclear la contraseña
y perder el token de push por el camino (`use-logout.ts:38-50` pone
`fcm_token` en NULL a propósito).

## Lo que hay hoy (leído, no supuesto)

- **El cajón de cuenta** es `components/profile/account-menu-drawer.tsx`. Lo
  abre el botón de hamburguesa del `Header` (`components/layout/header.tsx:94-109`)
  y arriba del todo pinta la **fila de perfil**: avatar, nombre, `@username` y
  un galón (`account-menu-drawer.tsx:66-82`). Esa fila es hoy un `<Link>` a
  `/perfil`. Es exactamente el sitio que Pedro señaló.
- **La sesión vive en una cookie**, no en `localStorage`:
  `lib/supabase/client.ts:10-14` usa `createBrowserClient` de `@supabase/ssr`,
  que guarda `access_token` + `refresh_token` en las cookies `sb-*-auth-token`
  (troceadas) que el proxy (`lib/supabase/middleware.ts`) y los Server
  Components leen. **Una sola sesión por navegador**: cambiar de cuenta es
  cambiar el contenido de esa cookie.
- **La app móvil es un WebView que carga `vicinomarket.com`**
  (`capacitor.config.ts`). No hay almacenamiento nativo de credenciales: lo
  que sirva para el navegador sirve para la APK, y al revés.
- **Ya hay piezas que reaccionan a un cambio de usuario**:
  - `components/layout/session-data-provider.tsx:59-73` escucha
    `onAuthStateChange` y, si el usuario de la sesión no es el que el servidor
    pintó, vacía la memoria y hace **navegación dura** (`window.location.replace`).
  - `app/(marketplace)/layout.tsx:174-180` monta `SessionDataProvider`,
    `FavoritesProvider`, `NavigationPrefetch` y `NavigationMetrics` con
    `key={user.id}`, así que un `router.refresh()` con otra cookie los
    **remonta** para el usuario nuevo. `ChatUnreadProvider` y
    `NotificationUnreadProvider` no llevan `key`, pero sus hooks dependen de
    `userId` (`hooks/use-chat-unread-count.ts:15-16,86`).
  - `hooks/usePushNotifications.ts:418-444` vuelve a registrar el dispositivo
    cuando `onAuthStateChange` trae **otra cuenta** (`cuenta !== ultimaCuentaRegistrada`),
    y guarda el token en `profiles.fcm_token` de la nueva.
- **El proxy expulsa de `/login` y `/register` a quien ya tiene sesión**
  (`middleware.ts:105-115`). "Agregar cuenta" necesita entrar ahí **con** sesión.
- **La carrera de la cookie en iOS está documentada**
  (`components/auth/oauth-url-listener.tsx:93-105`): tras cambiar la cookie en
  JS, una navegación completa (`window.location.replace`) puede salir **sin** la
  cookie nueva; la navegación de cliente (`router.refresh()` + `router.replace()`)
  lee `document.cookie` de forma síncrona y no tiene ese problema.
- **Patrón de store local ya establecido**: `lib/auth/verificacion-pendiente.ts`
  (localStorage + `useSyncExternalStore` + instantánea comparable por valor +
  evento `storage` para otras pestañas + escritura que devuelve si pudo).
- **Hoja modal y avatar reutilizables**: `components/product/bottom-sheet.tsx`
  (ya lleva `data-modal-open` + Escape para el botón Atrás de la APK,
  `capacitor-init.tsx:98-104`) y `components/ui/user-avatar.tsx`.

## Ingeniería inversa: cómo lo resuelven Instagram, TikTok y X

Leído de los centros de ayuda oficiales el 13-oct-2026. Donde la ayuda oficial
no fija una cifra, se dice.

| | Instagram | TikTok | X |
|---|---|---|---|
| **Dónde se abre** | En el perfil, tocando el **nombre de usuario** arriba; también manteniendo pulsado el icono de perfil de la barra inferior | **Perfil → tocar el apodo → "Añadir cuenta"** o elegir una existente; también desde Ajustes | Menú de navegación → icono "más" → "crear cuenta nueva" o "añadir existente"; en Android, flecha hacia abajo en la cabecera; en escritorio, icono de perfil y avatares pequeños |
| **Qué se ve** | Hoja inferior con la lista de cuentas (avatar + usuario, la activa marcada) y "Agregar cuenta" al final | Lista de cuentas + "Añadir cuenta" | Lista de avatares + "Añadir una cuenta existente" |
| **Agregar** | Abre la pantalla de inicio de sesión **sin cerrar la actual**; permite crear cuenta nueva o entrar en una existente | Igual | Igual |
| **Límite** | **Hasta 5 cuentas** en el selector ([help.instagram.com/1682672155283228](https://help.instagram.com/1682672155283228)) | La ayuda oficial **no publica una cifra**; terceros hablan de 3 a 5 por dispositivo | La ayuda oficial **no publica una cifra** de sesiones simultáneas; la política de autenticidad permite operar hasta 10 cuentas ([help.x.com/.../authenticity](https://help.x.com/en/rules-and-policies/authenticity)) |
| **Quitar** | "Cerrar sesión de @x" cierra solo esa; "Cerrar sesión de todas las cuentas" aparte. Quitar la información de inicio de sesión del dispositivo **no borra la cuenta** ([help.instagram.com/1020536697967549](https://help.instagram.com/1020536697967549)) | Cerrar sesión de una cuenta la quita del selector | Cerrar sesión por cuenta |
| **Push** | Llegan notificaciones de **cualquier** cuenta con sesión que las tenga activadas | — | — |
| **Correo/teléfono** | Cada cuenta necesita el suyo | Un correo o teléfono solo puede ir en **una** cuenta ([support.tiktok.com](https://support.tiktok.com/en/log-in-troubleshoot/log-in/email-and-phone-number)) | Cada cuenta necesita el suyo |

Fuentes: [Instagram — Add and Switch Between Multiple Accounts](https://help.instagram.com/1682672155283228),
[Instagram — Add or remove login information on your device](https://help.instagram.com/1020536697967549),
[TikTok — Switch between multiple accounts](https://support.tiktok.com/en/log-in-troubleshoot/log-in/switch-between-multiple-accounts),
[X — How to manage multiple accounts](https://help.x.com/en/managing-your-account/managing-multiple-x-accounts).

**Lo que se toma prestado**, en orden de importancia:

1. **El disparador es la fila de perfil del menú**, no una entrada nueva de
   "Configuración". Los tres lo ponen a un toque del perfil.
2. **Una hoja inferior con la lista de cuentas y "Agregar cuenta" al final.**
   La activa lleva marca; las demás son un toque.
3. **Agregar reutiliza la pantalla de login normal**, sin cerrar la sesión
   actual. Nadie inventa un segundo formulario.
4. **"Cerrar sesión" distingue "esta cuenta" de "todas"**, y quitar una cuenta
   del dispositivo no la borra.
5. **Un tope pequeño.** Instagram fija 5 y es el único que lo publica.

**Lo que NO se puede copiar tal cual** (y por qué):

- Instagram entrega push de **todas** las cuentas. En VICINO `send-push` lee
  **un** `fcm_token` por perfil, y el token es del teléfono. Dar push a varias
  cuentas a la vez requiere una tabla de dispositivos y tocar la Edge Function:
  **SQL**, fuera de la fase 1 (ver D6).
- Instagram guarda las credenciales en almacenamiento nativo cifrado. VICINO es
  un WebView: lo más que hay es `localStorage`, con la **misma exposición** que
  ya tiene la cookie de sesión (que `@supabase/ssr` lee desde JS, o sea que no
  es `httpOnly`). No se gana ni se pierde superficie de ataque respecto a hoy,
  pero hay que decirlo (ver seguridad en `design.md`).

## Hallazgos técnicos que deciden el diseño

1. **Los refresh tokens de Supabase no caducan por defecto y son de un solo
   uso.** Rotación activada en todos los proyectos; ventana de reuso de 10 s;
   usar uno ya gastado fuera de esa ventana **revoca la sesión entera**;
   time-box e inactividad vienen a 0 = nunca
   ([supabase.com/docs/guides/auth/sessions](https://supabase.com/docs/guides/auth/sessions)).
   Consecuencias: (a) guardar el `refresh_token` de la cuenta inactiva en el
   dispositivo **sí sirve** para volver a ella días después; (b) hay que guardar
   **el último** token (el que esté en la cookie en el momento de cambiar, no uno
   viejo); (c) una cuenta que se **quita** del dispositivo tiene que **revocarse**
   en el servidor, porque si no su token queda vivo indefinidamente en un
   `localStorage` del que ya nadie se acuerda.
2. **`auth.setSession({ access_token, refresh_token })` es la API de cambio.**
   Escribe la sesión en el storage del cliente (con `@supabase/ssr`, en la
   cookie) y, si el access token caducó, lo refresca en el acto
   ([auth-setsession](https://supabase.com/docs/reference/javascript/auth-setsession)).
   Dispara `SIGNED_IN` en `onAuthStateChange`, que es lo que hoy escuchan
   `session-data-provider.tsx:59` y `usePushNotifications.ts:418`.
3. **`signOut({ scope: "local" })` revoca solo la sesión del token que lo
   llama** ([auth-signout](https://supabase.com/docs/guides/auth/signout)).
   Con un cliente supabase-js **aislado** (storage en memoria, `storageKey`
   propio) se puede cargar la sesión de una cuenta inactiva y revocarla **sin
   tocar la cookie de la activa**. Es la pieza que hace posible "quitar cuenta".
4. **No hay que tocar OAuth.** Google/Apple en web vuelven por
   `/auth/callback-server` (escribe la cookie nueva en el servidor) y en la APK
   por `OAuthUrlListener` (`exchangeCodeForSession` en el cliente). Los dos
   **pisan** la cookie: si la cuenta anterior ya está en la bóveda antes de
   salir al proveedor, agregar una cuenta con Google funciona sin cambiar una
   línea de `lib/auth/native-oauth.ts`.
5. **La navegación tras el cambio tiene que ser blanda** (`router.refresh()` +
   `router.replace("/perfil")`), por la carrera de la cookie en iOS de
   `oauth-url-listener.tsx:93-105`. La navegación dura de
   `session-data-provider.tsx:70-72` hay que **suprimirla solo durante un cambio
   en curso**; el resto de los casos (cerrar sesión en otra pestaña, caducidad)
   se quedan como están.
6. **El tope legal no exime `/login` ni `/register`**
   (`lib/auth/confirmacion-legal.ts:22-26`). Hoy da igual porque nadie con
   sesión llega ahí; con "agregar cuenta" sí. Quien tenga sesión y no haya
   confirmado Términos rebotaría a `/confirmar-cuenta` antes de poder agregar.
   Es un punto de GATE 0, no un bloqueo: lo normal es que quien agrega ya
   confirmó.

## What

Implementar en la app web (y por tanto en la APK) un selector de cuentas al
estilo Instagram:

1. **Bóveda local de cuentas** (`lib/cuentas/boveda.ts`): hasta `MAX_CUENTAS = 5`
   entradas `{ userId, email, nombre, username, foto, access_token,
   refresh_token, ultimoUso }` en `localStorage` bajo `vicino_cuentas_v1`,
   validadas con Zod al leer, expuestas como store de `useSyncExternalStore`
   (mismo patrón que `verificacion-pendiente.ts`).
2. **Hoja "Cuentas"** (`components/cuentas/hoja-cuentas.tsx`) sobre
   `BottomSheet`: lista con `UserAvatar`, nombre, `@username`, marca en la
   activa, "Quitar" en las demás y "Agregar cuenta" al final.
3. **La fila de perfil del cajón abre la hoja** (`account-menu-drawer.tsx:66-82`).
4. **Cambio de cuenta** (`lib/cuentas/cambio.ts`): tokens actuales de A a la
   bóveda → `fcm_token` de A a NULL (mejor esfuerzo) → marca "cambio en curso"
   → `setSession` con los tokens de B → `router.refresh()` + `router.replace("/perfil")`
   → aviso por `BroadcastChannel` a otras pestañas.
5. **Agregar cuenta**: cookie corta `vicino_agregando_cuenta` + excepción en
   `middleware.ts:105-115` + aviso en `login-form.tsx` / `register-form.tsx` +
   la cuenta nueva se registra sola al aterrizar (`RegistroCuentaActiva` en el
   layout del marketplace).
6. **Cerrar sesión consciente de cuentas** (`use-logout.ts`): cierra la activa
   y pasa a la más reciente; "Salir de todas las cuentas" aparte.
7. **Quitar cuenta** con cliente aislado que **revoca** en el servidor.
8. **Purga de la bóveda** al eliminar la cuenta
   (`configuracion/delete-account-section.tsx`).
9. **Pruebas**: unitarias con `node:test` + `tsx` (bóveda, cambio con puerto de
   auth falso y `lib/pruebas/supabase-falso.ts` para el `fcm_token`), E2E
   Playwright en el proyecto `mobile` con dos cuentas de prueba, y verificación
   manual en la APK de que `fcm_token` cambia de perfil.

## Scope

**Dentro:** `apps/web/lib/cuentas/*`, `components/cuentas/*`,
`components/profile/account-menu-drawer.tsx`, `components/layout/session-data-provider.tsx`
(solo la guarda del cambio en curso), `lib/supabase/middleware.ts` (solo la
excepción de `/login` y `/register`), `app/(auth)/login/login-form.tsx` y
`register/register-form.tsx` (aviso + destino), `hooks/use-logout.ts`,
`app/(marketplace)/configuracion/delete-account-section.tsx`,
`app/(marketplace)/layout.tsx` (montar `RegistroCuentaActiva`), pruebas y el
delta de `openspec/specs/auth-session/spec.md`.

**Fuera (fase 1):** cualquier migración SQL, `send-push` y la Edge Function
`delete-account`, OAuth (web y nativo), el `Sidebar` de escritorio, los
contadores de no leídos **por cuenta** en la hoja, y la promoción de la CSP a
modo de bloqueo (`next.config.ts:322`, sigue en Report-Only; es otro change).

## Success criteria

- Con dos cuentas en el dispositivo, cambiar de una a otra desde el cajón tarda
  un toque y **no pasa por `/login`**; `/perfil` muestra el nombre de la cuenta
  nueva; chat, notificaciones y favoritos muestran los de la cuenta nueva
  **sin recargar la página** (se verifica en GATE 0 y en E2E).
- Tras cambiar A→B, `profiles.fcm_token` de A queda en NULL y el de B tiene el
  token del dispositivo (verificado en la APK, no solo en el navegador).
- Agregar una cuenta con correo+contraseña **y** con Google deja las dos en la
  bóveda, con la nueva activa, y vuelve a `/perfil`.
- Quitar una cuenta inactiva **revoca su sesión** en Supabase (verificable:
  el refresh token guardado deja de servir) y la quita de la lista.
- "Cerrar sesión" con otra cuenta guardada pasa a esa cuenta; "Salir de todas"
  deja la bóveda vacía y a la persona en `/login`.
- Eliminar la cuenta borra su entrada de la bóveda.
- Un fallo de red a mitad del cambio **deja a la persona en la cuenta A**, con
  un aviso, nunca en un estado a medias (tabla de fallos en `design.md`).
- `pnpm build` verde, `tsc` en 0, pruebas unitarias nuevas en verde, E2E en
  `mobile` en verde, y comprobado a 375×812 en claro y oscuro, en el navegador
  y en la APK.
- **Sin SQL.** `git log -- supabase/migrations` no cambia en la fase 1.

## Decisiones que Pedro debe firmar

| | Decisión | Opciones | Recomendación |
|---|---|---|---|
| **D1** | Qué hace la fila de perfil del cajón | (a) **La fila entera abre la hoja "Cuentas"**; dentro, tocar la cuenta activa lleva a `/perfil`. (b) La fila sigue yendo a `/perfil` y un galón "▾" junto al nombre abre la hoja. | **(a)**. Es lo que pidió Pedro y lo que hace Instagram. Dos objetivos táctiles en una fila de 48 px fallan a 375 px. |
| **D2** | Dónde viven las cuentas guardadas | (a) **Bóveda local** en `localStorage` (sin SQL, por dispositivo, igual que la cookie). (b) Tabla `cuentas_vinculadas` en Supabase con RLS (SQL, sincroniza entre dispositivos, pero vincula identidades en el servidor). | **(a)** para la fase 1. (b) crea una relación entre cuentas que hoy no existe en el modelo y abre preguntas de privacidad que no hacen falta para el caso de uso. |
| **D3** | Qué hace "Cerrar sesión" con otras cuentas guardadas | (a) **Cierra la activa (revoca) y pasa a la más reciente**; "Salir de todas las cuentas" como acción aparte en `/configuracion` y en la hoja. (b) Cierra siempre todas. | **(a)**. Es el comportamiento de Instagram, y (b) convierte el botón de siempre en uno destructivo para quien tenga dos cuentas. |
| **D4** | Tope de cuentas por dispositivo | 5 (Instagram) / 3 / sin tope. | **5**. Cada entrada es un refresh token vivo; más de 5 no tiene caso de uso y sí coste de seguridad. |
| **D5** | Alcance de la fase 1 | (a) **Solo el cajón móvil** (`md:hidden`); el `Sidebar` de escritorio (`sidebar.tsx:180-196`) en fase 2. (b) Los dos en la fase 1. | **(a)**. El WebView es el caso principal (`openspec/project.md` §4). La misma hoja se reutiliza después con `side="right"`. |
| **D6** | Push al cambiar de cuenta | (a) **El token sigue a la cuenta activa**: A pierde push mientras B está activa (lo que ya hace cerrar sesión hoy). (b) Push para todas las cuentas del dispositivo: tabla `dispositivos_push` + cambiar `send-push` (SQL + Edge Function). | **(a)** en la fase 1. (b) es un change propio, con migración y revisión de RLS; se anota como seguimiento. |
