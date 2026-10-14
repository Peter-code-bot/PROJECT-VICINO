# Design — Cambio de cuenta

> Decisiones D1–D6 de `proposal.md` firmadas por Pedro el 14-oct-2026 con las
> recomendaciones (D1 a, D2 a, D3 a, D4 5, D5 a, D6 a). Este documento se
> actualizó tras implementar la fase 1 para describir lo que hay en el código.

## Lo que cambió respecto al diseño original (GATE 0, T-04)

Leyendo `auth-js` 2.99.3 (`GoTrueClient.js`) se encontró lo que decide la
arquitectura: **`setSession()` con un access token caducado llama a
`_callRefreshToken()`, y si el refresh token no vale (400 "Already Used",
usuario borrado...), ejecuta `_removeSession()`, que BORRA el storage del
cliente.** En el cliente de la app ese storage es la cookie de sesión. Es
decir: probar los tokens de B en el cliente principal podía cerrar la sesión de
A. El diseño original ("si `setSession` falla, la cookie de A sigue intacta")
era falso en ese caso.

La regla que lo arregla, y que ya está en el código: **el cliente principal
nunca recibe tokens sin validar.** Toda sesión dormida se despierta primero en
un cliente de Supabase aislado (`lib/cuentas/sesion-aislada.ts`, storage en
memoria y `storageKey` propio); solo si eso va bien, y con el access token ya
vigente, se le pasa al principal, que entonces va por el camino de
`_getUser()`: guarda la cookie si va bien y, si no, devuelve el error sin tocar
nada. Lo demás del diseño se mantiene.

Otros dos ajustes menores que salieron de leer las librerías:

- **No hace falta un `BroadcastChannel` propio.** `GoTrueClient` ya abre uno
  con el nombre del `storageKey` y reenvía cada evento de sesión a las demás
  pestañas; el `SessionDataProvider` de esas pestañas ve otra cuenta sin marca
  de cambio en curso y hace su navegación dura de siempre. Es lo que se quería.
- **Hay tres guardas contra entrar a `/login` y `/register` con sesión, no
  una**: el proxy, las dos `page.tsx` (redirigen en el servidor) y la acción
  `signUp` (se niega a registrar encima de una sesión). Las tres leen la misma
  cookie de "agregando cuenta".

## Lo que cambió tras el CODEX Adversarial Review Loop (iteración 1)

Cinco auditores por dimensión (auth, seguridad, React/Next, fallos y
concurrencia, pruebas/spec) sobre la primera implementación. Lo que se corrigió
y por qué, en orden de gravedad:

1. **CRÍTICO — el refresh token de A podía rotar mientras la persona estaba en
   `/login`** (ticker de auto-refresh del cliente singleton o refresco del
   proxy) y la bóveda se quedaba con uno ya consumido: volver a A era "Already
   Used" y revocaba su sesión entera. Dos arreglos: (a) la cuenta que se guarda
   antes de cambiar o de agregar se guarda tras un **`refreshSession()`
   forzado**, no `getSession()`, así que nace con una hora por delante y ni el
   ticker ni el proxy la tocan en ese plazo; (b) `EspejoDeTokens` en el layout
   raíz reescribe los tokens de cualquier entrada existente en cada
   `TOKEN_REFRESHED`, en todas las pantallas.
2. **`setSession(B)` en el principal también podía borrar la cookie de A**:
   `_getUser()` ejecuta `_removeSession()` ante un 403 `session_not_found` (B
   revocada entre la prueba aislada y este paso). Tras un fallo del paso 6 se
   relee la cookie y, si ya no es de A, se restaura con los tokens frescos del
   paso 1.
3. **Los tokens rotados de B se guardan nada más probarla**, antes del `PATCH`
   del `fcm_token`: un `PATCH` colgado o una pestaña cerrada ya no pueden
   perder el único refresh token válido de B.
4. **Un 4xx al cargar una dormida no es veredicto hasta probar el refresh
   token**: con el reloj del teléfono atrasado, `setSession` manda un access
   token que el servidor ya rechaza y eso parecía credencial inválida. El
   cliente aislado reintenta con `refreshSession()`; solo `/token` decide.
5. **`revocarSesion` avisa de los tokens rotados (`alRotar`) antes del
   `/logout`**: si ese `/logout` falla por red, la bóveda conserva los tokens
   que sí valen y el siguiente intento no dispara la detección de reuso.
6. **"Salir de todas" ya no vacía la bóveda a ciegas**: revoca las dormidas
   primero y, si alguna falla por red, se detiene y lo dice, sin cerrar la
   activa. Un teléfono "limpio" con sesiones vivas en el servidor era mentir.
7. **Tope de tiempo en todo `/auth/v1/*`** (`fetchConLimite` no lo cubre): el
   cliente aislado aborta sus `fetch` a los 20 s y las llamadas del principal
   van con `conTope`. Y la hoja **se puede cerrar aunque haya una acción en
   vuelo** (Escape, Atrás, el fondo): nadie se queda atrapado en un modal por
   un socket parado; el resultado llega por toast.
8. **La marca de cambio dura 60 s y se renueva tras `signOut()`**: con 10 s, un
   `/logout` lento emitía `SIGNED_OUT` con la marca ya caducada y la navegación
   dura cortaba el cambio a mitad.
9. **`session-data-provider` ya no vacía la memoria con la marca puesta**: si el
   cambio cuaja, el layout remonta el proveedor; si no cuaja, la memoria de la
   cuenta que sigue tiene que seguir viva. Y un `SIGNED_OUT` espera 1,5 s y
   relee la cookie antes de navegar: en otra pestaña puede ser el primer acto
   de un cambio de cuenta (auth-js lo reenvía por `BroadcastChannel` y la marca
   es por pestaña).
10. **El reintento de aterrizaje se comprueba en cada render del servidor**
    (`renderId` desde el layout): con navegación blanda y la misma cuenta, React
    conserva la instancia y un efecto solo-al-montar nunca lo veía. El "ya
    reintentado" vive en memoria del módulo (StrictMode montaba dos veces y un
    contador en `sessionStorage` se creía el reintento hecho).
11. **Push tras entrar por la acción de servidor**: `signInWithPassword`,
    `verificarCodigo` y el callback de OAuth escriben la cookie desde el
    servidor y el cliente no emite `SIGNED_IN`, así que la cuenta nueva (y la
    que cancela "agregar cuenta") se quedaba sin token de push hasta el siguiente
    primer plano. `lib/push/registro.ts` pide el registro a
    `usePushNotifications`; lo disparan `RegistroCuentaActiva` al montar y el
    "Cancelar" del aviso. Esto cierra también el hueco (a) que el propio hook
    documentaba para cerrar sesión y volver a entrar.
12. **El cierre de sesión resuelve la cuenta que se va con la cookie
    (`getSession`), no con `getUser()`**: con la red caída `getUser` daba
    `null` y la "más reciente" era el espejo de la propia cuenta activa. La
    lógica vive ahora en `lib/cuentas/cierre.ts` con puertos y 7 pruebas.
13. **El diálogo de "Cerrar sesión" dice la verdad**: con otras cuentas
    guardadas, "Saldrás de esta cuenta y pasarás a X" y un segundo botón "Salir
    de todas las cuentas". Prometer "tendrás que volver a iniciar sesión" y
    dejar abierta la cuenta del negocio era justo lo contrario de lo que espera
    quien presta el teléfono.
14. **`useBodyScrollLock` es reentrante** (contador a nivel de módulo): cerrar
    la hoja liberaba el scroll de la página con el cajón todavía abierto, y los
    gestos de pestaña volvían a vivir por debajo. Y `BottomSheet` devuelve el
    foco a quien lo abrió al cerrarse.
15. **`clasificarErrorAuth` trata como credencial cualquier `AuthError` que no
    sea de transporte** (antes `AuthInvalidJwtError` era "red" para siempre y
    la entrada no se purgaba nunca).
16. **La activa sin sitio en la bóveda** (cinco dormidas ajenas) se dice en la
    hoja tal cual, en vez de pintar una lista sin cuenta activa.

## Lo que cambió tras el CODEX Adversarial Review Loop (iteración 2)

Tres auditores sobre el código corregido (regresiones de la iteración 1, auth
y seguridad, flujos React/UX). Lo que se corrigió:

1. **El `refreshSession()` forzado era una regresión**: auth-js borra su
   storage (la cookie) ante cualquier `AuthError` no reintentable, y un 429
   (límite de `/token` por IP, compartida en CGNAT móvil) o un 500 lo son. Un
   cambio o un "agregar cuenta" con mala suerte dejaba a la persona fuera.
   Ahora el paso 1 toma una instantánea con `getSession()` (sin red con el
   token vigente), refresca **solo si quedan menos de 5 min**, y si el refresh
   falla sin veredicto (429, 5xx, tope, respuesta que no es JSON) relee la
   cookie y la restaura con la instantánea. Solo un 4xx de `/token` cuenta como
   "A ya no vale".
2. **La marca de cambio se pone desde el principio** de `cambiarACuenta` (y
   durante el paso 1 de "agregar cuenta"), no en el paso 5: el refresh y su
   restauración emiten `SIGNED_OUT`/`SIGNED_IN` y el proveedor no debe navegar
   ni recargar por ellos. Todo camino que no acaba en ok la quita.
3. **El tope del cliente aislado sube a 35 s**: auth-js reintenta un `/token`
   fallido por transporte con el mismo refresh token durante 30 s, y nuestro
   abort a los 20 s contaba como transporte; si la primera petición sí había
   llegado al servidor, el reenvío caía fuera de la ventana de reuso y GoTrue
   revocaba la familia entera.
4. **La restauración de A tras un `setSession(B)` fallido solo actúa si la
   cookie quedó vacía**: si es de B, es que el `setSession` cuajó tarde (tras
   el tope) y se da por bueno; antes se pisaba B con A y el estado final era
   una carrera.
5. **`revocarSesion` lee lo que quedó en la memoria del aislado antes de
   olvidarlo**: `signOut()` carga la sesión con un margen de 90 s (`setSession`
   no lo aplica) y puede rotar el refresh token por dentro justo antes de un
   `/logout` fallido; esos tokens también se avisan por `alRotar`.
6. **"Salir de todas" revoca las dormidas antes de tocar el push de la activa**:
   un abort por red dejaba a la cuenta que seguía sin token. Y si el `signOut()`
   falla después de soltarlo, se vuelve a pedir el registro.
7. **Volver a entrar por `/login` en una cuenta que ya estaba en la bóveda
   revoca la sesión anterior**: pisar la entrada dejaba viva para siempre una
   sesión de GoTrue de la que ya nadie tenía el token. `RegistroCuentaActiva`
   compara el `session_id` de los dos access tokens y, si difieren, revoca la
   vieja con el cliente aislado.
8. **`soltarTokenPush` nunca lanza** (tampoco por el tope): un `PATCH` colgado
   abortaba "agregar cuenta" en silencio, sin cookie ni navegación.
9. **`EspejoDeTokens` relee la cookie** al volver a primer plano, al recibir el
   foco y en `pageshow`: los refrescos del servidor (proxy, acciones) no emiten
   eventos en el cliente.
10. **Tras un cambio fallido se vuelve a pedir el registro de push**: el paso 4
    pudo soltar el de la cuenta actual antes de que el 6 fallara.
11. **La pista de cambio en curso se espeja en `localStorage`** para que la
    navegación diferida de otras pestañas espere (hasta 6 s) mientras la
    pestaña que cambia termina; y esa navegación respeta la marca de su propia
    pestaña si apareció después.
12. **`clasificarErrorAuth`** vuelve a tratar `AuthUnknownError` (un 52x con
    HTML) como red: el servidor no dio veredicto.
13. **La bóveda refleja el perfil editado sin esperar a un evento de auth**:
    `actualizarPerfil` (solo nombre, usuario, foto y correo; ni tokens ni
    `ultimoUso`) se llama cada vez que el layout vuelve a pintar la cuenta
    activa. Antes la hoja mostraba el nombre viejo hasta una hora.
14. **Los tokens rotados durante una revocación fallida se guardan con
    `actualizarTokens`, no con `guardarCuenta`**: guardar subía `ultimoUso` y
    convertía a la cuenta que se intentaba quitar en "la más reciente", justo
    la que "Cerrar sesión" elige a continuación.
15. **Accesibilidad de la hoja y del diálogo de cierre**: el botón de
    confirmar cierre ya no lleva un `aria-label` fijo ("Confirmar cierre de
    sesión") que contradecía su texto visible ("Sí, pasar a X"); cada fila de
    cuenta enlaza su correo con `aria-describedby` (el `aria-label` de la fila
    lo tapaba y el correo es como alguien distingue una cuenta que no es suya);
    y el botón de confirmar "Quitar" recibe el foco cuando sustituye al que lo
    tenía.
16. **Un fallo que llega con la hoja cerrada solo se avisa por toast** y no se
    guarda como error de la hoja; cada apertura empieza sin error ni
    confirmación pendiente (estado derivado de `open` durante el render, no en
    un efecto).

**Riesgo aceptado y documentado (no corregido en la fase 1):** las cuentas
dormidas quedan a un toque y con todos sus privilegios. Quien tenga el
teléfono desbloqueado puede entrar en cualquiera de la lista y borrarla o
cerrar su sesión en todos los dispositivos sin volver a teclear la contraseña.
Es exactamente lo que hace Instagram al cambiar de cuenta, pero Instagram pide
la contraseña para borrar la cuenta. Queda como T-35 (fase 2): reautenticación
en `/api/account/delete` y en los cambios de contraseña y correo.

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
  foto: z.string().nullable(),
  accessToken: z.string().min(1),
  refreshToken: z.string().min(1),
  ultimoUso: z.number().int().positive(),
});
// La lista se valida entrada a entrada y se recorta a MAX_CUENTAS tras ordenar.
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
- **`guardarCuenta()` dice qué pasó** (`"guardada" | "llena" |
  "sin_almacenamiento"`), como `guardarPendiente()` devuelve si pudo: en Safari
  con cookies bloqueadas o cuota llena, `setItem` lanza, y quien llama tiene
  que saberlo para no prometer un cambio que no va a poder deshacer.
- **`actualizarTokens(userId, tokens)`** reescribe solo los tokens de una
  entrada que ya existe; no crea. Es lo que usa `EspejoDeTokens`.
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

`cambiarACuenta(destino: Cuenta, puerto)`, en este orden y por estos motivos.
Recibe **puertos** (`PuertoCambio`: auth principal, `probar`, `soltarTokenPush`,
bóveda, marca, Sentry) para poder probarse sin navegador; los reales están en
`lib/cuentas/puertos.ts`.

| Paso | Qué | Por qué en este orden |
|---|---|---|
| 0 | `marcarCambioEnCurso(B)` | Desde el principio: el paso 1 puede emitir `SIGNED_OUT`/`SIGNED_IN` y el proveedor no debe navegar. Todo camino que no acaba en ok la quita. |
| 1 | `getSession()` de A y, solo si le quedan menos de 5 min, `refreshSession()` | Lo que se guarda tiene que aguantar dormido: un refresh token con minutos de vida lo rotaría el ticker o el proxy sin que la bóveda se entere, y volver a A sería "Already Used". El refresh no es incondicional porque auth-js borra la cookie ante un 429 o un 500 de `/token`: si falla sin veredicto se restaura con la instantánea. Si A y destino son la misma cuenta, no hay nada que hacer. |
| 2 | `guardarCuenta(A)` con esos tokens; si devuelve `sin_almacenamiento` o `llena`, **abortar** | Sin A en la bóveda, cambiar a B es cerrar sesión de A con otro nombre. Nombre, usuario y foto se conservan del espejo si ya estaba. |
| 3 | `probarSesion(B)` en el **cliente aislado** | Valida (y refresca si hace falta) la sesión dormida **en memoria**. Fallo de credencial: B sale de la bóveda y la persona sigue en A, con la cookie intacta. Fallo de red: B se queda, la persona sigue en A. Es el paso que protege la cookie de A del `_removeSession()` de auth-js. |
| 4 | `guardarCuenta(B)` con los tokens que devolvió la prueba | Si hubo refresh, son los **únicos** tokens válidos de B; perderlos sería perder B. Por eso va antes de cualquier otra cosa. |
| 5 | `profiles.update({ fcm_token: null }).eq("id", A)` — mejor esfuerzo, Sentry en `warning` | El token de push es del teléfono (`use-logout.ts`). **Después** de probar B (para no dejar a A sin push por un cambio que no iba a ocurrir) y **antes** de `setSession` (después ya no hay permiso de escribir en A). Con D6=(b) desaparecería. |
| 6 | `marcarCambioEnCurso(B.userId)` | Avisa a `session-data-provider.tsx` de que el `SIGNED_IN` que viene es intencional. |
| 7 | `setSession(B vigente)` en el cliente principal | Con el access token vigente, auth-js llama a `/user` y guarda la cookie. Si falla por red: se desmarca, B ya está a salvo en la bóveda. Si falla por credencial (raro: revocada entre el paso 3 y este): B sale de la bóveda. Tras cualquier fallo se relee la cookie: si quedó vacía (auth-js la borra ante `session_not_found`) se restaura A con los tokens del paso 1; si es de B, el `setSession` cuajó tarde y se da por bueno. |
| 8 | Quien llama: `router.refresh()` y, a los 50 ms, `router.replace("/perfil")` | Navegación **blanda**: lee `document.cookie` en JS, sin la carrera de la capa nativa de iOS (`oauth-url-listener.tsx:93-105`). `/perfil` y no `/` porque es donde la persona **ve** que cambió. |

Otras pestañas: el `BroadcastChannel` que `GoTrueClient` abre con el nombre del
`storageKey` reenvía el `SIGNED_IN` de B a sus clientes; sus
`SessionDataProvider` ven otra cuenta sin marca y hacen la navegación dura de
siempre. No hay canal propio.

`aplicarCuenta(destino, puerto)` son los pasos 3, 4, 6 y 7 sin cuenta activa:
lo usan `use-logout.ts` tras cerrar la activa y `RegistroCuentaActiva` para
reintentar un cambio que aterrizó en la cuenta equivocada. Un cerrojo de módulo
(`enCurso`) rechaza un segundo cambio mientras hay uno en vuelo.

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

Tres sitios echan de `/login` y `/register` a quien ya tiene sesión: el proxy
(`middleware.ts`), las dos `page.tsx` (redirigen en el servidor) y la acción
`signUp` de `app/(auth)/actions.ts` (se niega a registrar encima de una sesión
abierta). Los tres leen la misma cookie con `estaAgregandoCuenta()`
(`lib/cuentas/agregando-cuenta.ts`):

1. La hoja, al tocar "Agregar cuenta": (a) `refreshSession()` +
   `guardarCuenta(A)` (tokens con una hora por delante; si falla, abortar: sin
   A guardada, agregar B es perder A); (b) `fcm_token` de A a NULL, mejor
   esfuerzo (el token es del teléfono; al cancelar, el aviso pide el registro
   de nuevo); (c) escribe la cookie `vicino_agregando_cuenta=1; Max-Age=600;
   Path=/; SameSite=Lax` (`Secure` en https) desde `document.cookie`; (d)
   `router.push("/login?next=%2Fperfil&agregar=1")`.
2. **Proxy, páginas y `signUp`**: con la cookie puesta, dejan pasar. Quien
   tenga la cookie y sesión puede ver `/login` y `/register` **durante 10
   minutos**. Nadie en el servidor la borra: la borra el cliente al aterrizar
   (paso 4) y, si no, caduca sola.
3. **`login-form.tsx` y `register-form.tsx`**: con `?agregar=1` pintan arriba
   `AvisoAgregandoCuenta`: *"Estás agregando otra cuenta. La actual sigue
   guardada en este teléfono."* con "Cancelar", que borra la cookie y vuelve a
   `/perfil`. El enlace cruzado entre las dos pantallas conserva `agregar=1`.
   El destino viaja en `next=/perfil`, que `destinoAutenticadoSeguro` acepta,
   así que la persona ve en el acto que entró con la cuenta nueva.
   `signInWithPassword` escribe la cookie de B igual que hoy; no se toca.
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
cerrarSesion({ todas? }):
  fcm_token de A → NULL                (igual que hoy)
  si todas: revocar cada dormida con el cliente aislado (mejor esfuerzo, Sentry warning con userId)
  siguiente = todas ? null : cuentaMasReciente(sin A)
  si hay siguiente → marcarCambioEnCurso(siguiente)   ANTES de signOut: el SIGNED_OUT
                                                      llegaría a session-data-provider
                                                      y sin marca haría la navegación dura a /login
  signOut()                            (global, igual que hoy: revoca A en todos los dispositivos)
  si error → desmarcar y devolver mensaje              (igual que hoy)
  quitarDeBoveda(A); si todas: vaciarBoveda()
  si no hay siguiente → router.push("/login") + refresh (igual que hoy)
  si hay → aplicarCuenta(siguiente)    (pasos 3, 4, 6 y 7; no hay A que guardar)
    ok → toast "Ahora estás en X", refresh + replace("/perfil")
    falla → desmarcar, toast con el motivo, /login
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

## El cliente aislado — `lib/cuentas/sesion-aislada.ts`

Para una cuenta **dormida** no se puede usar el cliente normal ni para probar
(ver "Lo que cambió") ni para revocar (`signOut()` revocaría la activa). Hay un
cliente de `@supabase/supabase-js` aislado, uno por pestaña:

```ts
createClient(URL, ANON, {
  global: { fetch: fetchConLimite(fetch, URL) },
  auth: {
    storage: { getItem, setItem, removeItem },  // sobre un Map en memoria
    storageKey: "vicino-cuentas-aislado",       // distinto de sb-*-auth-token: no toca la cookie
    persistSession: true,                       // para que use NUESTRO storage (con false auth-js pone el suyo)
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
});
```

- `probarSesion(tokens)`: `setSession` carga (y refresca si hace falta) la
  sesión dormida **en memoria** y devuelve tokens vigentes. La memoria se vacía
  al terminar.
- `revocarSesion(tokens)`: `setSession` y luego `signOut({ scope: "local" })`,
  que llama a `/logout?scope=local` con ese access token y revoca **esa**
  sesión y solo esa: la cuenta sigue viva en los demás dispositivos de la
  persona. Un fallo de credencial al cargarla cuenta como "ya estaba revocada".
- Su cerrojo (`navigator.locks`, `lock:vicino-cuentas-aislado`) y su
  `BroadcastChannel` llevan otro nombre: no bloquean ni avisan al cliente
  principal. Se crea una sola vez porque cada `GoTrueClient` cuelga un listener
  de visibilidad del `window`.

## Quitar cuenta
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
| Cambio, paso 1 | No hay sesión activa | "No encontramos tu sesión actual. Vuelve a entrar." | Nada cambió |
| Cambio, paso 2 | `localStorage` no escribe | "No se pudo guardar tu cuenta actual. Inténtalo de nuevo." | En A, nada cambió |
| Cambio, paso 3 | Prueba de B: 400/401/403/404 ("Invalid Refresh Token", "Already Used", usuario borrado) | "La sesión de B venció. Vuelve a entrar." | En A, cookie intacta; **B se quita de la bóveda** (su token ya no sirve); A conserva su push |
| Cambio, paso 3 | Red caída / 5xx / 429 (`AuthRetryableFetchError`) | "Sin conexión. Sigues en A." | En A; B sigue en la bóveda |
| Cambio, paso 5 | `fcm_token` de A no se pudo poner a NULL | Nada (mejor esfuerzo) | A puede seguir recibiendo push hasta el próximo registro; Sentry `warning` |
| Cambio, paso 7 | `setSession` principal falla por red | "Sin conexión. Sigues en A." | En A; marca limpia; los tokens nuevos de B ya están en la bóveda |
| Cambio, paso 7 | `setSession` principal 401 (revocada entre el paso 3 y este) | "La sesión de B venció." | En A; B fuera de la bóveda |
| Cambio, paso 8 | La cookie de B se pisó con una respuesta tardía del servidor que refrescó A (rotación concurrente) | Nada o un parpadeo | `RegistroCuentaActiva` ve A donde esperaba B y reaplica `aplicarCuenta(B)` una vez; si tampoco, limpia la marca y muestra "No se pudo cambiar de cuenta" |
| Cambio | Segundo toque mientras hay un cambio en vuelo | Nada (las filas están deshabilitadas) | `cambiarACuenta` lo rechaza con `en_curso` |
| Cambio en curso | Pasan 10 s sin que aterrice B | Comportamiento de siempre | La marca caduca sola; `session-data-provider` vuelve a su navegación dura |
| Agregar | La persona cierra la app en Google | Nada | Cookie `vicino_agregando_cuenta` caduca en 10 min; A intacta, con tokens frescos en la bóveda |
| Agregar | "Cancelar" en el aviso de `/login` | Vuelve a `/perfil` como A | La cookie se borra; se vuelve a pedir el registro de push de A |
| Agregar | El `PATCH` del `fcm_token` de A falla o se cuelga | Nada (mejor esfuerzo, tope de 20 s) | Se sale igual a `/login`; A puede seguir recibiendo push hasta el siguiente registro |
| Cualquiera | Una llamada de auth se cuelga | La hoja se puede cerrar; a los 20 s, "Sin conexión" | La cookie no cambió; si la llamada cuaja después, la cookie cambia y el proveedor recarga con la cuenta nueva |
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
  de todas", Zod al leer, y **nunca** mandar tokens a Sentry: `reportarCuentas`
  (`lib/cuentas/puertos.ts`) solo adjunta el paso y el `status` del error, y
  ningún `console.log` del módulo imprime tokens. Sentry no adjunta
  `localStorage` por sí solo.
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

**El disparador (D1=a).** En `account-menu-drawer.tsx` el `<Link>` de la
fila de perfil pasa a `<button>` que abre la hoja; el galón de la derecha se
sustituye por un "▾" junto al nombre (la convención de Instagram para "aquí
hay más cuentas") y un icono de personas a la derecha. Dentro de la hoja,
tocar la cuenta activa cierra la hoja y el cajón y lleva a `/perfil`; y la
sección "Cuenta" del cajón gana una entrada "Mi perfil", para que el perfil
siga a un toque. Con **una sola** cuenta la fila sigue abriendo la hoja (con
"Agregar cuenta" como única acción extra): es como la gente descubre que
existe.

**Atrás con las dos capas abiertas.** Las dos llevan `data-modal-open` y las
dos escuchan Escape, así que un solo Atrás de la APK las cerraría de golpe.
El cajón ignora Escape mientras la hoja está abierta: el primer Atrás cierra
la hoja, el segundo el cajón.

**Quitar** pide confirmación en la misma fila ("¿Quitar X de este teléfono?")
antes de revocar; mientras revoca, la fila muestra un spinner.

## Qué NO se toca

OAuth (`native-oauth.ts`, `oauth-url-listener.tsx`, `callback-server/route.ts`),
`signOut` de servidor (`app/(auth)/actions.ts`, lo usa `/confirmar-cuenta`), la
Edge Function `delete-account`, `send-push`, el `Sidebar`, `SessionCache`
(solo se consulta la marca desde su `invalidSession`), y cualquier tabla. El
`BottomSheet` y `UserAvatar` se usan tal cual. De `actions.ts` solo cambia la
guarda de sesión de `signUp` (lee la cookie de agregar).

## Mapa de archivos (fase 1)

| Archivo | Papel |
|---|---|
| `lib/cuentas/boveda.ts` (+ `use-cuentas.ts`) | Bóveda local y su hook |
| `lib/cuentas/cambio-en-curso.ts` | Marca en `sessionStorage` (10 s) |
| `lib/cuentas/agregando-cuenta.ts` | Cookie, parámetro y enlaces de "agregar cuenta"; lo importan cliente y servidor |
| `lib/cuentas/clasificar-error-auth.ts` | credencial vs. red |
| `lib/cuentas/sesion-aislada.ts` | Cliente aislado: `probarSesion`, `revocarSesion` |
| `lib/cuentas/cambio.ts` | `cambiarACuenta`, `aplicarCuenta`, `datosDeSesion` con puertos |
| `lib/cuentas/puertos.ts` | Puertos reales (Supabase, bóveda, marca, Sentry) |
| `lib/cuentas/cierre.ts` | Cierre de sesión consciente de cuentas, con puertos |
| `lib/cuentas/jwt.ts` | `session_id` de un access token, para revocar sesiones huérfanas |
| `lib/cuentas/*.test.ts` + `pruebas-entorno.ts` | 51 pruebas `node:test` |
| `lib/push/registro.ts` | Evento para pedir el registro de push a `usePushNotifications` |
| `components/cuentas/espejo-de-tokens.tsx` | Espejo de tokens en el layout raíz |
| `components/cuentas/hoja-cuentas.tsx` | La hoja "Cuentas" |
| `components/cuentas/registro-cuenta-activa.tsx` | Espejo de la activa, cierre del cambio en curso, borrado de la cookie |
| `components/cuentas/aviso-agregando-cuenta.tsx` | Aviso en `/login` y `/register` |
| `components/cuentas/salir-de-todas-section.tsx` | Fila en `/configuracion` |
| `hooks/use-logout.ts` | Cables y navegación del cierre, `{ todas }` |
| `hooks/use-body-scroll-lock.ts`, `components/product/bottom-sheet.tsx` | Bloqueo de scroll reentrante; foco de vuelta al cerrar |
| `hooks/usePushNotifications.ts` | Oye el evento de `lib/push/registro.ts` |
| `components/profile/account-menu-drawer.tsx`, `components/layout/header.tsx` | Disparador |
| `components/layout/session-data-provider.tsx` | Guarda de la marca (dos sitios) |
| `lib/supabase/middleware.ts`, `app/(auth)/{login,register}/page.tsx`, `app/(auth)/actions.ts` | Las tres guardas de "agregar cuenta" |
| `app/(auth)/{login/login-form,register/register-form}.tsx` | Aviso y enlaces |
| `app/(marketplace)/layout.tsx` | Monta `RegistroCuentaActiva` |
| `app/(marketplace)/configuracion/{page,delete-account-section}.tsx` | "Salir de todas" y purga al eliminar |
| `tests/cuentas.spec.ts` | E2E móvil con dos cuentas (se salta sin `VICINO_TEST_EMAIL_2`) |
