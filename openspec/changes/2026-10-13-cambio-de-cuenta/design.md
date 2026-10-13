# Design — Cambio de cuenta

> Depende de las decisiones D1–D6 de `proposal.md`. Está escrito con las
> recomendaciones puestas; si Pedro cambia alguna, el apartado afectado se
> señala en cada caso.

## El modelo en una frase

**La cookie de Supabase sigue siendo la única sesión viva; la bóveda es una
lista de sesiones dormidas, y cambiar de cuenta es despertar una y dormir la
otra.** No hay dos sesiones activas nunca, ni dos clientes de Supabase con
cookie: `createBrowserClient` (`lib/supabase/client.ts`) sigue siendo el único
que toca `document.cookie`.

    WebView / navegador
    ┌──────────────────────────────────────────────────────────┐
    │  cookie sb-*-auth-token  ───►  cuenta ACTIVA (A)          │
    │                                                          │
    │  localStorage vicino_cuentas_v1                          │
    │    [ A (espejo, tokens al día), B (dormida), C (dormida) ]│
    └──────────────────────────────────────────────────────────┘
                       │ setSession(B)            ▲ getSession()
                       ▼                          │
                  Supabase Auth  (rotación ON, reuso 10 s, sesión indefinida)

## Bóveda local — `lib/cuentas/boveda.ts`

Mismo molde que `lib/auth/verificacion-pendiente.ts`, que ya resolvió los
cuatro problemas de un store en `localStorage` leído por React: hidratación,
instantánea comparable por valor, escritura que puede fallar, y aviso a otras
pestañas por el evento `storage`.

```ts
const CLAVE = "vicino_cuentas_v1";   // la _v1 es para poder migrar o descartar
export const MAX_CUENTAS = 5;        // D4

const cuentaSchema = z.object({
  userId: z.string().uuid(),
  email: z.string().min(1),
  nombre: z.string(),
  username: z.string().nullable(),
  foto: z.string().url().nullable(),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  ultimoUso: z.number().int().positive(),
});
const bovedaSchema = z.array(cuentaSchema).max(MAX_CUENTAS);
```

- **Zod al leer, no al escribir.** Lo que hay en `localStorage` lo pudo
  escribir una versión anterior de la app, una extensión, o nadie. Una entrada
  que no valide se **descarta entera** (la lista se filtra, no se tira), y se
  reescribe la lista limpia en el siguiente `guardar`. Igual que `leerCrudo()`
  en `verificacion-pendiente.ts:44-65`, nunca lanza.
- **La instantánea para `useSyncExternalStore` es un string**: el JSON crudo
  tal cual está en `localStorage`. React lo compara por valor y no entra en
  bucle; el parseo a objetos lo hace un `useMemo` sobre ese string en el hook
  `useCuentas()`. `getServerSnapshot` devuelve `"[]"`.
- **Orden = `ultimoUso` descendente.** La primera es la activa (o la más
  reciente, si no hay sesión). Es lo que "cerrar sesión y pasar a la más
  reciente" necesita sin ordenar en cada sitio.
- **`guardarCuenta()` devuelve `boolean`**, como `guardarPendiente()`: en
  Safari con cookies bloqueadas o cuota llena, `setItem` lanza, y quien llama
  tiene que saberlo para no prometer un cambio que no va a poder deshacer.
- **Si se supera `MAX_CUENTAS`, no se guarda** y la hoja muestra "Quita una
  cuenta para agregar otra". No se expulsa la más vieja en silencio: la más
  vieja puede ser la del negocio.
- Lo que **no** va en la bóveda: `es_vendedor`, roles, contadores. Se piden al
  aterrizar; guardarlos sería tener dos verdades.

## El espejo de la cuenta activa — `RegistroCuentaActiva`

Componente cliente sin UI montado en `app/(marketplace)/layout.tsx` (con
`key={user.id}`, como los demás). Hace dos cosas:

1. **Al montar y en cada `SIGNED_IN` / `TOKEN_REFRESHED`** de `onAuthStateChange`,
   escribe en la bóveda la entrada de `session.user.id` con los tokens de la
   sesión y los datos de perfil que el layout ya consultó (`nombre`, `foto`,
   `username`; se pasan por props, no se vuelve a pedir). Así la cuenta activa
   **siempre** tiene en la bóveda su último refresh token, y "agregar cuenta"
   por cualquier camino (contraseña, Google, Apple, registro nuevo) queda
   registrado **sin que login-form tenga que saber de la bóveda**.
2. **Cierra el "cambio en curso"** (ver abajo) cuando el `user.id` montado es el
   que se esperaba. Si el que aparece es el anterior (la cookie se pisó a
   mitad, caso raro que se explica en la tabla de fallos), vuelve a aplicar
   `setSession` **una sola vez** y, si tampoco, limpia la marca y avisa.

Por qué un componente y no un efecto dentro de `SessionDataProvider`: el
proveedor tiene ya tres `useEffect` con dependencias delicadas (`lifecycle`,
`generation`) y meter ahí escrituras a `localStorage` es exactamente lo que
hace que nadie quiera tocarlo después.

## Cambio de cuenta — `lib/cuentas/cambio.ts`

`cambiarACuenta(destino: Cuenta)`, en este orden y por estos motivos:

| Paso | Qué | Por qué en este orden |
|---|---|---|
| 1 | `const { data: { session } } = await supabase.auth.getSession()` de A | `getSession` refresca si el access token caducó, o sea que lo que se guarda es **el token más nuevo**, no el de hace una hora. Guardar uno viejo y usarlo después = "Already Used" = sesión A revocada entera. |
| 2 | `guardarCuenta(A con esos tokens)`; si devuelve `false`, **abortar** con "No se pudo guardar tu cuenta actual" | Sin A en la bóveda, cambiar a B es cerrar sesión de A con otro nombre. |
| 3 | `profiles.update({ fcm_token: null }).eq("id", A)` — mejor esfuerzo, `Sentry` en `warning` | Mismo motivo y mismo código que `use-logout.ts:38-50`: el token es del teléfono. Se hace **antes** de `setSession` porque después ya no hay permiso para escribir en el perfil de A (RLS). Con D6=(b) este paso desaparece. |
| 4 | `marcarCambioEnCurso(B.userId)` (en `sessionStorage`, caduca a los 10 s) | Avisa a `session-data-provider.tsx` de que el `SIGNED_IN` que viene es intencional. |
| 5 | `await supabase.auth.setSession({ access_token: B.accessToken, refresh_token: B.refreshToken })` | Escribe la cookie de B. Si el access token de B caducó (lo normal tras horas), auth-js lo refresca aquí mismo con el refresh token guardado: primer uso desde que se guardó, así que es válido. |
| 6 | Si `error`: `desmarcarCambioEnCurso()`, **no tocar nada más** y devolver el mensaje | La cookie de A sigue intacta: `setSession` no escribe hasta que el servidor contesta bien. La persona sigue en A. |
| 7 | `guardarCuenta(B con la sesión devuelta)` | `setSession` devuelve tokens **nuevos** si refrescó; los viejos de B ya se gastaron. |
| 8 | `router.refresh()` y, en el siguiente tick, `router.replace("/perfil")` | Navegación **blanda**: lee `document.cookie` en JS, sin la carrera de la capa nativa de iOS (`oauth-url-listener.tsx:93-105`). `/perfil` y no `/` porque es donde la persona **ve** que cambió (nombre, avatar). |
| 9 | `new BroadcastChannel("vicino_cuentas").postMessage({ tipo: "cambio", userId: B })` | Otras pestañas del mismo origen (escritorio) recargan: su `SessionDataProvider` tiene `userId` A y su próxima lectura de `/api/session` traería B. |

**El "cambio en curso" en `session-data-provider.tsx`.** Hoy el listener de
`onAuthStateChange` (`:59-73`), al ver otra cuenta, vacía la memoria y hace
`window.location.replace("/")`. El cambio es de tres líneas: si
`hayCambioEnCurso()`, se hace **solo** `cache.clear()` y se sale; la
navegación la pone `cambiarACuenta`. El resto de casos (cerrar sesión en otra
pestaña, caducidad, `INITIAL_SESSION`) **no cambian**. Lo mismo para la
`invalidSession` de la línea 14: si hay cambio en curso, una respuesta de
`/api/session` con `userId` distinto es la de B llegando a la memoria de A, y
no motivo para mandar a nadie a `/login`.

La marca vive en `sessionStorage` y **caduca sola a los 10 s**: si algo se
queda a medias, el comportamiento de siempre vuelve solo.

**Qué pasa con los proveedores.** Tras `router.refresh()` el layout vuelve a
renderizar con la cookie de B: `SessionDataProvider`, `FavoritesProvider`,
`NavigationPrefetch` y `NavigationMetrics` llevan `key={user.id}` y se
**remontan** limpios (`layout.tsx:174-187`). `ChatUnreadProvider` y
`NotificationUnreadProvider` no llevan `key`, pero sus hooks tienen `userId` en
las dependencias y cierran los canales de Realtime de A antes de abrir los de B
(`use-chat-unread-count.ts:15-86`). **Esto se verifica en GATE 0 con una
navegación blanda real, no se asume**: es el primer punto de `tasks.md`.

**Push.** `usePushNotifications.ts:418-444` ya reacciona al `SIGNED_IN` de B
con `cuenta !== ultimaCuentaRegistrada` y registra el dispositivo para B, que
escribe `profiles.fcm_token` de B. Con el paso 3 (A en NULL), el token queda
en **una** cuenta: la activa. Esto se comprueba en la APK, no en el navegador,
porque en web no hay tubería de push.

## Agregar cuenta

El problema es uno: `middleware.ts:105-115` echa de `/login` y `/register` a
quien ya tiene sesión. La solución es la mínima:

1. La hoja, al tocar "Agregar cuenta": (a) `getSession()` + `guardarCuenta(A)`
   (si falla, abortar: sin A guardada, agregar B es perder A); (b) escribe la
   cookie `vicino_agregando_cuenta=1; Max-Age=600; Path=/; SameSite=Lax;
   Secure` desde `document.cookie`; (c) `router.push("/login?agregar=1")`.
2. **`middleware.ts`**: en la condición de la línea 105 se añade
   `&& !request.cookies.has("vicino_agregando_cuenta")`. Nada más. Quien tenga
   la cookie y sesión puede ver `/login` y `/register` **durante 10 minutos**.
   El proxy **no** la borra: la borra el cliente al terminar (paso 4) y, si no,
   caduca sola.
3. **`login-form.tsx` y `register-form.tsx`**: si `searchParams.get("agregar")`,
   pintan arriba un aviso: *"Estás agregando otra cuenta. La actual sigue
   guardada en este teléfono."* con un enlace "Cancelar" que borra la cookie y
   vuelve a `/perfil`. El `destino` por defecto pasa a ser `/perfil` (hoy es
   `/`), para que la persona vea en el acto que entró con la cuenta nueva.
   `signInWithPassword` (Server Action) escribe la cookie de B igual que hoy;
   no se toca.
4. Al aterrizar en el marketplace, `RegistroCuentaActiva` ve la sesión de B,
   la mete en la bóveda y borra `vicino_agregando_cuenta`. **Ninguna de las
   pantallas de auth sabe que existe la bóveda.** Esto es lo que hace que el
   registro nuevo (`register-form → verificar-codigo → /confirmar-cuenta →
   /completar-perfil`) y OAuth funcionen sin cambios: todos acaban en el layout.
5. **OAuth web y nativo no se tocan.** `signInWithGoogle` lleva a
   `/auth/callback-server` (web) o a `OAuthUrlListener` (APK), y los dos pisan la
   cookie con B. A ya está en la bóveda desde el paso 1. El único detalle es
   el destino: `native-oauth.ts:36-40` acepta `destino`, y los formularios ya
   lo pasan, así que con `destino = "/perfil"` basta.
6. **Si se cierra la app a mitad** (salió a Google y no volvió): la cookie
   caduca en 10 min, A sigue en la cookie y en la bóveda. Nada que limpiar.

**Tope legal (`confirmacion-legal.ts:22-26`).** `/login` y `/register` no
están exentos, así que quien tenga sesión **sin** confirmar Términos rebota a
`/confirmar-cuenta` antes de llegar al formulario. Es coherente (no debería
poder hacer nada hasta confirmar) y la cookie de agregar sobrevive al rebote.
Se deja como está salvo que GATE 0 encuentre un caso real que lo rompa.

## Cerrar sesión consciente de cuentas — `hooks/use-logout.ts`

Con D3=(a):

```
cerrarSesion():
  fcm_token de A → NULL                (igual que hoy)
  signOut()                            (global, igual que hoy: revoca A en todos los dispositivos)
  si error → devolver mensaje          (igual que hoy)
  quitarDeBoveda(A)
  siguiente = cuentaMasReciente()
  si no hay siguiente → router.push("/login") + refresh   (igual que hoy)
  si hay → cambiarACuenta(siguiente)   (pasos 4-9 de arriba; no hay A que guardar)
    si falla → la quita de la bóveda y manda a /login con "Vuelve a entrar en @x"
```

`signOut()` sigue siendo **global** a propósito: es lo que el botón "Cerrar
sesión" ha hecho siempre y lo que la gente espera de él en un teléfono
compartido. "Quitar cuenta" (abajo) es lo que es local.

**"Salir de todas las cuentas"**: fila propia en el grupo "Sesión" de
`/configuracion` (junto a `LogoutSection`) y al final de la hoja. Revoca cada
cuenta dormida con el cliente aislado, luego la activa con `signOut()`, vacía
la bóveda y va a `/login`. Si alguna revocación de las dormidas falla por red,
**se sigue igual** y se reporta a Sentry: el objetivo de quien pulsa esto es
que el teléfono quede limpio, y eso se cumple vaciando la bóveda. La sesión
que no se pudo revocar **no caduca sola** (las sesiones son indefinidas en
prod), así que el fallo se reporta con `level: "warning"` y el `userId`, para
poder revocarla a mano desde el panel de Auth si hace falta. Es el único sitio
del diseño donde se acepta dejar un token vivo, y es porque la alternativa
(negarse a limpiar el teléfono mientras no haya red) es peor.

## Quitar cuenta — `lib/cuentas/revocar.ts`

Para una cuenta **dormida** no se puede llamar `signOut()` del cliente normal:
revocaría la activa. Se usa un cliente de `@supabase/supabase-js` aislado:

```ts
const aislado = createClient(URL, ANON, {
  auth: {
    storage: memoria(),            // { getItem, setItem, removeItem } sobre un Map
    storageKey: "vicino-revocar",  // distinto de sb-*-auth-token: no toca la cookie
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
await aislado.auth.setSession({ access_token, refresh_token });
await aislado.auth.signOut({ scope: "local" });
```

- `setSession` carga (y refresca si hace falta) la sesión dormida **en
  memoria**. `signOut({ scope: "local" })` llama a `/logout?scope=local` con
  ese access token y revoca **esa** sesión y solo esa: la cuenta sigue viva en
  los demás dispositivos de la persona.
- **Por qué revocar y no solo borrar la entrada**: sesiones indefinidas. Un
  refresh token que se borra de `localStorage` sin revocar sigue valiendo para
  siempre en cualquier copia que se haya hecho de ese `localStorage`.
- Si `setSession` contesta 400/401 (el token ya no vale: se revocó desde otro
  sitio, "Already Used"), **se quita la entrada igual**: no hay nada que
  revocar. Si es red, se deja la entrada y se avisa "No se pudo quitar. Revisa
  tu conexión".
- La activa no tiene "Quitar": su botón es "Cerrar sesión", que ya existe.

## Eliminar cuenta — `delete-account-section.tsx`

Tras el `res.ok` de `/api/account/delete` (`:35-40`) y antes de navegar a
`/cuenta-eliminada`: `quitarDeBoveda(userId)`. La ruta ya hizo `signOut()`. Las
demás cuentas se quedan en la bóveda: la persona borró **una** cuenta, no el
teléfono. En `/cuenta-eliminada` no se ofrece cambiar a otra (es una página de
despedida); al volver a `/login`, la fase 2 puede ofrecer "Continuar como @x".

## Tabla de fallos

| Momento | Fallo | Qué ve la persona | Estado que queda |
|---|---|---|---|
| Cambio, paso 1-2 | `localStorage` no escribe | "No se pudo guardar tu cuenta actual. Inténtalo de nuevo." | En A, nada cambió |
| Cambio, paso 3 | `fcm_token` de A no se pudo poner a NULL | Nada (mejor esfuerzo) | A puede seguir recibiendo push hasta el próximo registro; Sentry `warning` |
| Cambio, paso 5 | `setSession` 400/401 ("Invalid Refresh Token", "Already Used", usuario borrado) | "La sesión de @b venció. Vuelve a entrar." + botón que abre "agregar cuenta" con el correo precargado | En A; **B se quita de la bóveda** (su token ya no sirve) |
| Cambio, paso 5 | Red caída / 5xx / 429 (`AuthRetryableFetchError`) | "Sin conexión. Sigues en @a." | En A; B sigue en la bóveda |
| Cambio, paso 8 | La cookie de B se pisó con una respuesta tardía del servidor que refrescó A (rotación concurrente) | Nada o un parpadeo | `RegistroCuentaActiva` ve A donde esperaba B y reaplica `setSession(B)` una vez; si tampoco, limpia la marca y muestra "No se pudo cambiar. Inténtalo de nuevo" |
| Cambio en curso | Pasan 10 s sin que aterrice B | Comportamiento de siempre | La marca caduca sola; `session-data-provider` vuelve a su navegación dura |
| Agregar | La persona cierra la app en Google | Nada | Cookie `vicino_agregando_cuenta` caduca en 10 min; A intacta |
| Agregar | Bóveda llena (5) | "Quita una cuenta para agregar otra." | Nada cambió |
| Agregar | Entra con la **misma** cuenta A | Vuelve a `/perfil` como A | `RegistroCuentaActiva` actualiza la entrada de A, no la duplica (clave = `userId`) |
| Quitar | Red | "No se pudo quitar. Revisa tu conexión." | La entrada sigue |
| Quitar | 400/401 | Se quita sin aviso | Entrada fuera; no había nada que revocar |
| Cerrar sesión | `signOut()` de A falla por red | Mensaje de hoy | Igual que hoy: sigue en A |
| Cerrar sesión | A cerrada, pero `cambiarACuenta(siguiente)` falla | "Vuelve a entrar en @b" en `/login` | Siguiente fuera de la bóveda si fue 400/401; dentro si fue red |

Sobre la rotación concurrente (fila 5): el proxy refresca la cookie en el
servidor cuando el access token caduca. El paso 1 (`getSession()` justo antes
de cambiar) deja el token de A recién refrescado, así que la ventana en la que
una petición en vuelo con la cookie de A pueda rotar y traer `Set-Cookie` de A
después de que el cliente escribiera B es de milisegundos y solo si el token
caducaba justo entonces. Se cubre igual porque el coste es una comprobación de
`user.id` que ya hay que hacer.

## Seguridad

- **Exposición de los refresh tokens.** La cookie de `@supabase/ssr` la lee JS
  (`createBrowserClient` usa `document.cookie`), así que **no es `httpOnly`** y
  un XSS hoy ya se lleva el refresh token de la cuenta activa. La bóveda añade
  hasta 4 refresh tokens más con **la misma** exposición. No es una superficie
  nueva; es la misma superficie con más dentro. Mitigaciones que sí dependen de
  este change: tope de 5, revocación al quitar, purga al eliminar y al "salir
  de todas", Zod al leer, y **nunca** mandar tokens a Sentry (`beforeBreadcrumb`
  ya filtra cabeceras; se añade la clave `vicino_cuentas_v1` a la lista de
  `localStorage` que no se adjunta en los eventos).
- **La CSP sigue en Report-Only** (`next.config.ts:322`). Pasarla a bloqueo es
  la mitigación real contra XSS y es un change aparte con su propio riesgo
  (service worker, Realtime). Se anota como seguimiento con prioridad, no se
  mete aquí.
- **Teléfono compartido.** "Salir de todas las cuentas" tiene que estar a un
  toque en `/configuracion`, y la hoja muestra **el correo** de cada cuenta
  debajo del nombre: quien ve un correo que no es suyo sabe que tiene que
  quitarlo.
- **No se guardan contraseñas**, nunca. Solo tokens que Supabase puede revocar.
- **`sessionStorage` para la marca de cambio**, no `localStorage`: muere con la
  pestaña y no puede quedar pegada entre arranques.
- **La cookie de agregar no es `httpOnly`** porque la escribe y la borra el
  cliente; no lleva nada que valga: su único efecto es desactivar un redirect.

## La hoja "Cuentas" — `components/cuentas/hoja-cuentas.tsx`

Sobre `BottomSheet` (`components/product/bottom-sheet.tsx`) con
`side="bottom"`, `title="Cuentas"`. Hereda `data-modal-open` + Escape
(`bottom-sheet.tsx:67-77,84`), así que el botón Atrás de la APK la cierra sin
hacer nada más (`capacitor-init.tsx:98-104`).

    ┌──────────────────────────────┐
    │ Cuentas                    ✕ │
    ├──────────────────────────────┤
    │ (●) Pedro Ruiz            ✓  │   activa: UserAvatar lg, nombre
    │     @pedro · pedro@...       │   Outfit 600, correo Inter fg-muted
    │ (●) Taquería La Esquina      │
    │     @laesquina · tq@...  Quitar│  dormida: fila completa cambia;
    │                              │   "Quitar" es texto fg-muted a la derecha
    ├──────────────────────────────┤
    │ (+) Agregar cuenta           │   círculo --brand-tint, icono --brand
    │     Salir de todas las cuentas│  texto --danger, solo si hay ≥2
    └──────────────────────────────┘

- **Tokens, no hex**: `bg-background`, `bg-card`, `text-foreground`,
  `text-muted-foreground`, `border-border` (`STYLEGUIDE.md`); la marca activa
  usa `--brand` (#1F5A4E) y el fondo del "+" `--brand-tint`. Fuentes `font-display`
  (Outfit) para el título y los nombres, Inter para el resto (`docs/DESIGN.md` §3).
  Radio de la hoja: el que ya da `BottomSheet` (`--r-lg`).
- **Filas de 56 px**, objetivo táctil completo; el avatar es `UserAvatar`
  `size="md"` (40 px) con la inicial de respaldo que ya tiene.
- **Mientras cambia**: la fila tocada muestra `Loader2` en vez del avatar y las
  demás se deshabilitan; la hoja **no se cierra** hasta que `cambiarACuenta`
  resuelve, para que un fallo se pueda mostrar en el mismo sitio.
- **Claro y oscuro** se comprueban los dos (regla de `STYLEGUIDE.md`); no hay
  nada que depender de `next-themes` aquí porque todo son tokens.
- **Movimiento**: el de `BottomSheet` (200 ms, `translate-y`), apagado bajo
  `prefers-reduced-motion` como el resto.

**El disparador (D1=a).** En `account-menu-drawer.tsx:66-82` el `<Link>` de la
fila de perfil pasa a `<button>` que abre la hoja; el galón de la derecha se
sustituye por un "▾" pequeño junto al nombre, que es la convención de
Instagram para "aquí hay más cuentas". Dentro de la hoja, tocar la cuenta
activa cierra la hoja y el cajón y lleva a `/perfil`. Con **una sola** cuenta
la fila sigue abriendo la hoja (con "Agregar cuenta" como única acción extra):
es como la gente descubre que existe.

## Qué NO se toca

OAuth (`native-oauth.ts`, `oauth-url-listener.tsx`, `callback-server/route.ts`),
`signOut` de servidor (`app/(auth)/actions.ts:340-369`, lo usa `/logout`), la
Edge Function `delete-account`, `send-push`, el `Sidebar`, `SessionCache`
(solo se consulta la marca desde su `invalidSession`), y cualquier tabla. El
`BottomSheet` y `UserAvatar` se usan tal cual.
