# Tasks — Cambio de cuenta

> Sin SQL en la fase 1. Cada tarea de código pasa por el CODEX Adversarial
> Review Loop al cerrar la fase (`CLAUDE.md`). Las pruebas se escriben en la
> misma tarea que el código que prueban, no al final.
>
> Estado al 14-oct-2026: fase 0 y fase 1 hechas en la rama
> `feat/cambio-de-cuenta-20261014`; lo que necesita un dispositivo o una cuenta
> de pruebas nueva queda marcado como pendiente de Pedro.

## FASE 0 — GATE 0 (verificar premisas antes de escribir una línea)

- [x] T-00 — `git fetch origin master`: la base pasó de `9aae1ed` a `d00e567`
      (PR #58, onboarding). El plan se rebaseó; `session-data-provider.tsx`
      había cambiado en master (observador de navegación de comunidades), pero
      no el listener de `onAuthStateChange` que toca este change.
- [x] T-01 — **Proveedores ante un cambio de `userId` con navegación blanda.**
      Verificado por lectura (no hay cuenta de pruebas en el contenedor):
      `SessionDataProvider`, `FavoritesProvider`, `NavigationPrefetch` y
      `NavigationMetrics` llevan `key={user.id}` y se remontan;
      `useChatUnreadCount` y `useNotificationUnreadCount` tienen `userId` en
      las dependencias del efecto y cierran los canales de A en el cleanup
      (`use-chat-unread-count.ts:78-86`). Queda la comprobación en dispositivo
      (T-43/T-44).
- [x] T-02 — **Tope legal**: `/login` y `/register` siguen sin estar exentos
      (`confirmacion-legal.ts:22-26`). Con sesión sin confirmar, el proxy
      rebota a `/confirmar-cuenta` antes del formulario; la cookie de agregar
      sobrevive al rebote (no la toca nadie en el servidor). Decisión: **no**
      se eximen.
- [ ] T-03 — **Config de Auth en producción** (Dashboard → Authentication →
      Sessions): rotación ON, reuso 10 s, time-box e inactividad 0. **Pedro**:
      no hay acceso al panel desde el contenedor. El diseño asume los valores
      por defecto de Supabase; si difieren, el único efecto es el mensaje de
      "venció" apareciendo antes.
- [x] T-04 — **`setSession` con `@supabase/ssr`**: confirmado en
      `@supabase/ssr` 0.9.0 (`createBrowserClient.js`: singleton, storage
      sobre `document.cookie` troceado a 3180 bytes, `persistSession: true`) y
      en `auth-js` 2.99.3 (`GoTrueClient.js`). **Hallazgo que cambió el
      diseño**: `_setSession` → `_callRefreshToken` → `_removeSession()` en
      error no reintentable, o sea que probar B en el cliente principal podía
      borrar la cookie de A. Por eso existe `lib/cuentas/sesion-aislada.ts`.
      `signOut({ scope: "local" })` manda el access token de la sesión cargada
      a `/logout?scope=local` e ignora 401/403/404. `onAuthStateChange` corre
      con el cerrojo tomado.
- [x] T-05 — **Carrera de la cookie en iOS**: se usa el mismo compás que
      `oauth-url-listener.tsx` (`router.refresh()` y `router.replace` a los
      50 ms). Sentry no se pudo consultar desde el contenedor; queda T-44.
- [x] T-06 — Firma de Pedro sobre D1–D6: **D1 a, D2 a, D3 a, D4 5, D5 a,
      D6 a** (14-oct-2026, "aprobación de todo").

## FASE 1 — Núcleo (móvil, sin SQL)

- [x] T-10 — `lib/cuentas/boveda.ts`: esquema Zod, `MAX_CUENTAS`, lectura
      tolerante, `guardarCuenta` / `quitarCuenta` / `vaciarBoveda` /
      `cuentaMasReciente` / `cuentasDormidas` / `buscarCuenta`, store de
      `useSyncExternalStore` con instantánea string (`use-cuentas.ts`) y
      evento `storage`. Pruebas en `boveda.test.ts` (7 casos) con el `window`
      falso de `pruebas-entorno.ts`.
- [x] T-11 — `lib/cuentas/cambio-en-curso.ts`: marca en `sessionStorage` con
      caducidad de 10 s y respaldo en memoria. Pruebas (4 casos).
- [x] T-12 — `lib/cuentas/cambio.ts`: `cambiarACuenta` y `aplicarCuenta` con
      `PuertoCambio`. Pruebas en `cambio.test.ts` (12 casos): camino feliz,
      B vencida, red al probar, red y 401 en `setSession`, sin
      almacenamiento, sin sesión, misma cuenta, fallo del push, cuenta activa
      sin espejo, dos cambios a la vez, `aplicarCuenta`, `datosDeSesion`. El
      UPDATE de `fcm_token` pasa por `lib/pruebas/supabase-falso.ts`.
- [x] T-13 — `lib/cuentas/sesion-aislada.ts`: `probarSesion` y
      `revocarSesion` sobre un puerto `AuthAislado`; `clasificar-error-auth.ts`
      aparte. Pruebas (4 + 2 casos) con un auth falso en vez de extender
      `supabase-falso` (bastaba con la forma de `setSession`/`signOut`).
- [x] T-14 — `components/layout/session-data-provider.tsx`: guarda de
      `hayCambioEnCurso()` en el listener de `onAuthStateChange` y en
      `invalidSession`. Ningún otro cambio.
- [x] T-15 — `components/cuentas/registro-cuenta-activa.tsx` montado en
      `app/(marketplace)/layout.tsx` con `key={user.id}`.
- [x] T-16 — `components/cuentas/hoja-cuentas.tsx` sobre `BottomSheet` +
      `UserAvatar`, con tokens; estados: cambiando, quitando con confirmación
      en fila, error en la hoja, bóveda llena, una sola cuenta, "Salir de
      todas" solo con dormidas.
- [x] T-17 — `components/profile/account-menu-drawer.tsx`: la fila abre la
      hoja (D1); "Mi perfil" en la sección "Cuenta"; Escape respeta la hoja.
- [x] T-18 — Agregar cuenta: cookie desde la hoja; excepción en el proxy, en
      `login/page.tsx`, en `register/page.tsx` y en la acción `signUp` (que
      también se negaba a registrar con sesión); aviso + "Cancelar" + destino
      `/perfil` en los dos formularios. Prueba de `estaAgregandoCuenta` y del
      enlace (`agregando-cuenta.test.ts`); la condición del proxy es una línea
      y queda cubierta por el E2E de T-41.
- [x] T-19 — `hooks/use-logout.ts`: cierre consciente de cuentas con
      `{ todas }`; `LogoutSection` y `LogoutButton` sin cambios de API;
      `SalirDeTodasSection` en `/configuracion` y al pie de la hoja.
- [x] T-20 — `delete-account-section.tsx`: `quitarCuenta(userId)` tras `res.ok`.
- [x] T-21 — Sentry: `reportarCuentas` solo adjunta paso y `status`; ningún
      `console.log` del módulo imprime tokens. Sentry no adjunta
      `localStorage` por sí solo, así que no hay lista que ampliar.
- [x] T-22 — Delta `specs/auth-session/spec.md` revisado contra lo implementado.
- [x] T-23 — CODEX Adversarial Review Loop: iteración 1 con 5 auditores por
      dimensión (auth, seguridad, React/Next, fallos y concurrencia,
      pruebas/spec), 39 hallazgos, 16 correcciones; iteración 2 con 3
      auditores sobre el código corregido (regresiones, auth/seguridad,
      flujos), 16 correcciones más; iteración 3 sobre el diff final contra
      master con 3 auditores y 2 escépticos por hallazgo (11 hallazgos, 6
      confirmados = 4 problemas, 1 refutado), 5 correcciones más. Las tres
      listas en `design.md` ("Lo que cambió tras el CODEX").
- [x] T-24 — `pnpm build` verde (14-oct), `tsc --noEmit` en 0, lint sin
      errores nuevos, 56 pruebas unitarias en verde. El recorrido manual a
      375×812 claro/oscuro queda para Pedro (T-44): el contenedor no tiene
      cuenta de pruebas ni `.env.local`.

## FASE 2 — Opcional (tras ver la fase 1 en producción)

- [ ] T-30 — No leídos **por cuenta** en la hoja (punto rojo en la cuenta
      dormida que tiene mensajes). Requiere una lectura con el token dormido
      o una RPC: se decide entonces.
- [ ] T-31 — `Sidebar` de escritorio (`sidebar.tsx`): la misma hoja con
      `side="right"` desde la fila de perfil (D5).
- [ ] T-32 — En `/login` sin sesión y con bóveda no vacía: "Continuar como
      @x" (lo que Instagram llama recordar datos de inicio de sesión). Cubre
      también a quien rechaza los Términos al agregar una cuenta: el `signOut`
      de servidor de `/confirmar-cuenta` lo deja en `/login` con A todavía en
      la bóveda.
- [ ] T-33 — Push para todas las cuentas del dispositivo (D6=b): tabla
      `dispositivos_push` + `send-push`. **Es un change OpenSpec propio** con
      migración, grants por columna y RLS.
- [ ] T-34 — CSP a modo de bloqueo (`next.config.ts`). Change propio; aquí
      solo se anota que es la mitigación real del riesgo de la bóveda.
- [ ] T-35 — **Reautenticación para acciones destructivas.** Con el cambio de
      cuenta, una dormida queda a un toque y con todos sus privilegios: quien
      tenga el teléfono desbloqueado puede borrar la cuenta de otra persona o
      cerrar su sesión en todos los dispositivos. Instagram pide la contraseña
      para borrar la cuenta. Pedir la contraseña actual (o un OTP vía
      `supabase.auth.reauthenticate()`) en `/api/account/delete` y en los
      cambios de contraseña y correo. Hallazgo de seguridad del CODEX,
      aceptado como riesgo de la fase 1 por Pedro.

## FASE 3 — E2E y verificación en dispositivo (Pedro)

- [ ] T-40 — Variables `VICINO_TEST_EMAIL_2` / `VICINO_TEST_PASSWORD_2` en
      `apps/web/.env.local` (cuenta de pruebas nueva en producción, creada por
      Pedro; no se commitea nada). `playwright.config.ts` ya carga
      `.env.local` entero.
- [x] T-41 — `tests/cuentas.spec.ts` escrito: agregar → aviso en `/login` →
      entrar como B → `/perfil` como B → hoja con A y B → tocar A → `/perfil`
      como A sin visitar `/login` → quitar B. Más el caso de Atrás/Escape y
      el de `/login?agregar=1` sin cookie. **Se salta** sin las variables de
      T-40; correrlo es de Pedro.
- [ ] T-42 — E2E de fallo: con B en la bóveda y su token revocado a mano
      (desde el panel), tocar B muestra "La sesión de B venció" y la quita.
- [ ] T-43 — **APK**: con dos cuentas, cambiar A→B y leer
      `profiles.fcm_token` de las dos en el SQL Editor: A en NULL, B con el
      token. Luego B→A y al revés. Mandar un push de prueba a cada una.
- [ ] T-44 — **iOS** (TestFlight o simulador con la app real): el cambio no
      deja un parpadeo de invitado ni una pantalla en blanco (carrera de la
      cookie). Si lo deja, subir el compás de 50 ms en `hoja-cuentas.tsx` y
      `use-logout.ts`.
- [ ] T-45 — Botón Atrás de Android con la hoja abierta: cierra la hoja, no
      el cajón ni navega.
- [ ] T-46 — Sentry 24 h tras el deploy: sin eventos nuevos con
      `tags.modulo = "cuentas"`, ni subida de `AuthApiError` 400 en
      `/auth/v1/token`.

## Lo que queda fuera a propósito

- SQL de cualquier tipo en la fase 1.
- Tocar OAuth: la bóveda se alimenta al aterrizar, no en el callback.
- Guardar contraseñas, o cualquier cosa que Supabase no pueda revocar.
- Sincronizar la bóveda entre dispositivos (D2=b).
