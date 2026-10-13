# Delta — auth-session (change 2026-10-13-cambio-de-cuenta)

> Delta sobre `openspec/specs/auth-session/spec.md`. Se mergea al archivar el
> change. Solo ADDED; ningún requisito existente cambia.

## ADDED Requirement: Varias cuentas por dispositivo con una sola sesión activa

The system SHALL keep at most one Supabase session in the auth cookie at any
time. Additional accounts SHALL be stored client-side in `localStorage` under
`vicino_cuentas_v1` as `{ userId, email, nombre, username, foto, accessToken,
refreshToken, ultimoUso }`, validated with Zod on every read, capped at
`MAX_CUENTAS = 5`. The system SHALL NOT store passwords.

### Scenario: Switching accounts does not pass through /login

- GIVEN accounts A (active) and B (stored) on the device
- WHEN the user taps B in the "Cuentas" sheet
- THEN the client calls `auth.getSession()` for A and stores A's current tokens
- AND sets `profiles.fcm_token = NULL` for A (best effort)
- AND calls `auth.setSession(B.tokens)`
- AND navigates with `router.refresh()` + `router.replace("/perfil")` (no full navigation)
- AND `/perfil` renders B without any visit to `/login`

### Scenario: setSession failure leaves the user in A

- GIVEN `auth.setSession(B.tokens)` returns an error
- WHEN the error is 400/401 (invalid or already-used refresh token)
- THEN B is removed from the vault and the user stays in A with the message "La sesión de @b venció. Vuelve a entrar."
- WHEN the error is a network/5xx/429 error
- THEN B stays in the vault and the user stays in A with the message "Sin conexión. Sigues en @a."

## ADDED Requirement: Auth state change during an intentional switch does not hard-navigate

WHEN a switch is in progress (marker in `sessionStorage`, expiring after 10 s),
`SessionDataProvider` SHALL only clear its cache on a `SIGNED_IN` for a
different user and SHALL NOT call `window.location.replace`. Outside a switch,
the existing behavior is unchanged.

### Scenario: Marker expires

- GIVEN the marker was set and no account landed within 10 s
- WHEN the next auth state change arrives
- THEN the provider behaves exactly as before this change

## ADDED Requirement: Adding an account reuses /login and /register

WHEN the cookie `vicino_agregando_cuenta` is present, the proxy SHALL NOT
redirect an authenticated user away from `/login` or `/register`. The cookie
SHALL be set by the client with `Max-Age=600`, `SameSite=Lax`, `Secure`,
`Path=/`, and SHALL be removed by the client when the new account lands in the
marketplace layout.

### Scenario: Previous account is preserved

- GIVEN A is active and the user taps "Agregar cuenta"
- WHEN the client cannot store A's tokens in the vault
- THEN the flow aborts before the cookie is set and A remains active

### Scenario: OAuth is untouched

- GIVEN the user adds an account with Google
- WHEN the OAuth callback writes the new session cookie
- THEN the new account is recorded in the vault by `RegistroCuentaActiva` on the marketplace layout, with no change in the OAuth code paths

## ADDED Requirement: Removing a stored account revokes its session

WHEN the user removes a stored (non-active) account, the system SHALL load its
tokens into an isolated supabase-js client (in-memory storage, own
`storageKey`) and call `signOut({ scope: "local" })`, revoking only that
session. On 400/401 the entry is removed without revocation; on network error
the entry is kept and the user is told to retry.

## ADDED Requirement: Logout is account-aware

WHEN the active account signs out successfully and other accounts remain in
the vault, the system SHALL switch to the most recently used one instead of
navigating to `/login`. "Salir de todas las cuentas" SHALL revoke every stored
session, sign out the active one, empty the vault and navigate to `/login`.

## ADDED Requirement: Account deletion purges the vault entry

WHEN `/api/account/delete` succeeds, the client SHALL remove that account's
entry from the vault before navigating to `/cuenta-eliminada`.
