# Tasks — Cambio de cuenta

> Sin SQL en la fase 1. Cada tarea de código pasa por el CODEX Adversarial
> Review Loop al cerrar la fase (`CLAUDE.md`). Las pruebas se escriben en la
> misma tarea que el código que prueban, no al final.

## FASE 0 — GATE 0 (verificar premisas antes de escribir una línea)

- [ ] T-00 — `git fetch origin master && git log --oneline -5`: confirmar que
      la base sigue siendo `9aae1ed` o rebasar el plan sobre lo que haya.
- [ ] T-01 — **Proveedores ante un cambio de `userId` con navegación blanda.**
      Con dos cuentas de prueba, forzar `setSession(B)` desde la consola del
      navegador seguido de `router.refresh()` (sin recargar) y comprobar que:
      el badge de chat y el de notificaciones pasan a los de B
      (`use-chat-unread-count.ts:15-86`, `use-notification-unread-count.ts`),
      los corazones de favoritos son los de B (`FavoritesProvider` con `key`),
      y los canales de Realtime de A se cierran (pestaña Network → WS). Si
      algo se queda con A, anotar qué y decidir entre `key` en el proveedor o
      limpieza en el hook **antes** de la fase 1.
- [ ] T-02 — **Tope legal**: con una cuenta sin Términos confirmados, visitar
      `/login?agregar=1` con sesión y la cookie `vicino_agregando_cuenta`
      puesta a mano. Confirmar que rebota a `/confirmar-cuenta` y que la
      cookie sobrevive al rebote. Decidir si `/login` y `/register` entran en
      `exentaDeConfirmacionLegal` (`confirmacion-legal.ts:22-26`); la
      recomendación es **no**.
- [ ] T-03 — **Config de Auth en producción** (Dashboard → Authentication →
      Sessions): anotar rotación de refresh tokens (debe estar ON), intervalo
      de reuso (10 s), time-box e inactividad (0 = nunca) y `JWT expiry`. Si
      algo difiere de lo que asume `design.md`, corregir el diseño primero.
- [ ] T-04 — **`setSession` con `@supabase/ssr`**: en `node_modules/@supabase/ssr`
      confirmar que `createBrowserClient` escribe las cookies troceadas al
      llamar `setSession` y que `onAuthStateChange` emite `SIGNED_IN`.
      Confirmar en `@supabase/auth-js` que `signOut({ scope: "local" })` con
      storage en memoria manda el access token de **esa** sesión.
- [ ] T-05 — **Carrera de la cookie en iOS**: leer de nuevo
      `oauth-url-listener.tsx:93-105` y confirmar con Javier si hay algún caso
      reciente en Sentry; decide si la navegación tras el cambio puede ser
      `router.replace` solo o necesita el `setTimeout(50)` que usa el listener.
- [ ] T-06 — Firma de Pedro sobre D1–D6 (`proposal.md`). Sin firma no hay
      fase 1.

## FASE 1 — Núcleo (móvil, sin SQL)

- [ ] T-10 — `lib/cuentas/boveda.ts`: esquema Zod, `MAX_CUENTAS`, lectura
      tolerante, `guardarCuenta` / `quitarCuenta` / `vaciar` /
      `cuentaMasReciente`, store de `useSyncExternalStore` con instantánea
      string y evento `storage`. **Prueba** `lib/cuentas/boveda.test.ts`
      (`node:test`, `localStorage` falso en memoria): entrada inválida se
      descarta sin tirar las demás, tope de 5, orden por `ultimoUso`,
      `guardarCuenta` devuelve `false` cuando `setItem` lanza, misma
      `userId` no duplica. Correr con
      `node --import tsx --test lib/cuentas/boveda.test.ts` desde `apps/web`.
- [ ] T-11 — `lib/cuentas/cambio-en-curso.ts`: marca en `sessionStorage` con
      caducidad de 10 s (`marcar`, `hay`, `desmarcar`, `esperado()`).
- [ ] T-12 — `lib/cuentas/cambio.ts`: `cambiarACuenta` con los 9 pasos de
      `design.md`, recibiendo un **puerto** `{ getSession, setSession }` y el
      `from("profiles")` por parámetro para poder probarlo. **Prueba**
      `lib/cuentas/cambio.test.ts`: puerto falso para auth +
      `lib/pruebas/supabase-falso.ts` para el UPDATE de `fcm_token`; casos:
      éxito (A guardada, `fcm_token` NULL, B guardada con tokens nuevos),
      `setSession` 400 (B fuera de la bóveda, A intacta, marca limpia),
      `setSession` red (B sigue, A intacta), `localStorage` lleno (aborta
      antes de tocar nada).
- [ ] T-13 — `lib/cuentas/revocar.ts`: cliente aislado + `setSession` +
      `signOut({ scope: "local" })`; distingue 400/401 (quitar igual) de red
      (conservar). **Prueba** con `supabase-falso` extendido para contestar
      `/auth/v1/token` y `/auth/v1/logout` (añadir esos dos manejadores al
      falso; es la única extensión que necesita).
- [ ] T-14 — `components/layout/session-data-provider.tsx`: guarda de
      `hayCambioEnCurso()` en el listener de `onAuthStateChange` (`:59-73`) y
      en `invalidSession` (`:14`). Tres líneas; ningún otro cambio.
- [ ] T-15 — `components/cuentas/registro-cuenta-activa.tsx` montado en
      `app/(marketplace)/layout.tsx` con `key={user.id}` y los datos de
      perfil por props: espejo de la activa en cada `SIGNED_IN` /
      `TOKEN_REFRESHED`, cierre del cambio en curso, reintento único de
      `setSession` si aterriza la cuenta equivocada, borrado de la cookie
      `vicino_agregando_cuenta`.
- [ ] T-16 — `components/cuentas/hoja-cuentas.tsx` sobre `BottomSheet` +
      `UserAvatar`, con los tokens de `STYLEGUIDE.md` / `docs/DESIGN.md`;
      estados: cambiando, error en fila, bóveda llena, una sola cuenta.
- [ ] T-17 — `components/profile/account-menu-drawer.tsx:66-82`: la fila de
      perfil abre la hoja (D1); el cajón se cierra al navegar a `/perfil`.
- [ ] T-18 — Agregar cuenta: cookie `vicino_agregando_cuenta` desde la hoja,
      excepción en `lib/supabase/middleware.ts:105` (una condición), aviso +
      "Cancelar" + destino `/perfil` en `login-form.tsx` y `register-form.tsx`.
      **Prueba** de la condición del proxy con un `NextRequest` construido a
      mano (patrón de `lib/auth/confirmacion-legal.test.ts`).
- [ ] T-19 — `hooks/use-logout.ts`: tras `signOut()` ok, quitar A de la bóveda
      y pasar a la más reciente o a `/login`. `LogoutSection` y `LogoutButton`
      no cambian de API. Nueva `SalirDeTodasSection` en `/configuracion`
      (grupo "Sesión") y al pie de la hoja.
- [ ] T-20 — `configuracion/delete-account-section.tsx`: `quitarCuenta(userId)`
      tras el `res.ok`.
- [ ] T-21 — Sentry: añadir `vicino_cuentas_v1` a lo que **no** se adjunta en
      eventos; comprobar en un evento de prueba que ningún token viaja.
- [ ] T-22 — `openspec/changes/2026-10-13-cambio-de-cuenta/specs/auth-session/spec.md`
      (delta, ya redactado en este change) revisado contra lo implementado.
- [ ] T-23 — CODEX Adversarial Review Loop sobre todo lo anterior. Áreas de
      máxima prioridad: sesiones (todo este change lo es) y `middleware.ts`.
- [ ] T-24 — `pnpm build` verde, `tsc` en 0, lint limpio, pruebas unitarias
      nuevas en verde; recorrido manual a 375×812 claro y oscuro.

## FASE 2 — Opcional (tras ver la fase 1 en producción)

- [ ] T-30 — No leídos **por cuenta** en la hoja (punto rojo en la cuenta
      dormida que tiene mensajes). Requiere una lectura con el token dormido
      o una RPC: se decide entonces.
- [ ] T-31 — `Sidebar` de escritorio (`sidebar.tsx:180-196`): la misma hoja
      con `side="right"` desde la fila de perfil (D5).
- [ ] T-32 — En `/login` sin sesión y con bóveda no vacía: "Continuar como
      @x" (lo que Instagram llama recordar datos de inicio de sesión).
- [ ] T-33 — Push para todas las cuentas del dispositivo (D6=b): tabla
      `dispositivos_push` + `send-push`. **Es un change OpenSpec propio** con
      migración, grants por columna y RLS.
- [ ] T-34 — CSP a modo de bloqueo (`next.config.ts:322`). Change propio; aquí
      solo se anota que es la mitigación real del riesgo de la bóveda.

## FASE 3 — E2E y verificación en dispositivo

- [ ] T-40 — Variables `VICINO_TEST_EMAIL_2` / `VICINO_TEST_PASSWORD_2` en
      `apps/web/.env.local` (cuenta de pruebas nueva en producción, creada por
      Pedro; no se commitea nada). `playwright.config.ts` las carga igual que
      las primeras.
- [ ] T-41 — `tests/cuentas.spec.ts` en el proyecto `mobile` (375×812):
      entrar como A → cajón → fila de perfil → hoja con A → "Agregar cuenta"
      → aviso en `/login` → entrar como B → `/perfil` muestra B → hoja con
      A y B → tocar A → `/perfil` muestra A sin pasar por `/login` → "Quitar"
      B → hoja con solo A. `test.skip` si faltan las variables, como hace
      `notificaciones.spec.ts`.
- [ ] T-42 — E2E de fallo: con B en la bóveda y su token revocado a mano
      (desde el panel), tocar B muestra "La sesión de @b venció" y la quita.
- [ ] T-43 — **APK**: con dos cuentas, cambiar A→B y leer
      `profiles.fcm_token` de las dos en el SQL Editor: A en NULL, B con el
      token. Luego B→A y al revés. Mandar un push de prueba a cada una.
- [ ] T-44 — **iOS** (TestFlight o simulador con la app real): el cambio no
      deja un parpadeo de invitado ni una pantalla en blanco (carrera de la
      cookie). Si lo deja, aplicar lo decidido en T-05.
- [ ] T-45 — Botón Atrás de Android con la hoja abierta: cierra la hoja, no
      navega.
- [ ] T-46 — Sentry 24 h tras el deploy: sin eventos nuevos de
      `cambiarACuenta`, `revocar`, ni subida de `AuthApiError` 400 en
      `/auth/v1/token`.

## Lo que queda fuera a propósito

- SQL de cualquier tipo en la fase 1.
- Tocar OAuth: la bóveda se alimenta al aterrizar, no en el callback.
- Guardar contraseñas, o cualquier cosa que Supabase no pueda revocar.
- Sincronizar la bóveda entre dispositivos (D2=b).
