# VICINO - Inventario de uso del service_role key (post-rotacion)

Fecha: 2026-06-10. Proyecto Supabase `oxxdkwywprkfghhbnoto`. El service_role key fue ROTADO
porque estaba hardcodeado en el trigger push-on-sale (vivo en Studio) de `sale_confirmations`.
El token viejo ya esta invalidado. Este doc lista TODOS los lugares que usan el key para
actualizarlos con el nuevo. Read-only: **ningun valor de key aparece aqui** (solo nombres de
variable y ubicaciones).

## GATE 0
- HEAD `9b74a5d` (security/fase0-audit-verification, ahead 1, worktree limpio).

## Hallazgo central
El patron CANONICO y correcto: los triggers de push (`push_on_message_pgnet`,
`push_on_appointment_pgnet`) leen la JWT service_role desde **Vault**
(`vault.decrypted_secrets WHERE name = 'service_role_key'`, ver `20260604000005:31-34`). Por eso
**rotar el secret de Vault `service_role_key` en UN solo lugar actualiza todos esos triggers**.
El trigger push-on-sale que tenia el hardcode se creo a mano en Studio (el git
`20260604000003_more_push_triggers.sql` esta TODO comentado) y NO sigue el patron Vault.

## Tabla de uso

| ubicacion | que variable / como lee la key | accion |
|---|---|---|
| **DB trigger push-on-sale** (sale_confirmations, vivo en Studio) | token service_role LITERAL en headers `Authorization: Bearer <...>` (hardcode) | **ERRADICAR**: re-crear el trigger leyendo Vault `service_role_key` (patron de `20260604000005`) + commitear la migracion |
| DB trigger `push_on_message_pgnet` (vivo) | Vault `service_role_key` | actualizar el secret de Vault (1 vez, cubre todos) |
| DB trigger `push_on_appointment_pgnet` (`20260604000005:31-45`, vivo) | Vault `service_role_key` | idem (Vault) |
| `20260531000001_pg_cron_schedules.sql:54-55,86-87` | Vault `cron_secret` (NO es service_role) | n/a (es otro secret; CRON_SECRET) |
| `supabase/functions/send-push/index.ts:36` | `Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")` | actualizar secret de Edge Functions (Supabase Dashboard) o confirmar auto-inject |
| `supabase/functions/send-appointment-reminders/index.ts:26` | idem | idem |
| `supabase/functions/recompute-rankings/index.ts:43` | idem | idem |
| `supabase/functions/expire-confirmations/index.ts:31` | idem | idem |
| `supabase/functions/delete-account/index.ts:31` | idem | idem |
| `apps/web/lib/supabase/admin.ts:6` | `process.env.SUPABASE_SERVICE_ROLE_KEY` (admin client; lo usa `/api/reports`) | actualizar env var en **Vercel** Dashboard |
| `turbo.json:21` | declara `SUPABASE_SERVICE_ROLE_KEY` como env passthrough de turbo | sin cambio (passthrough; el valor vive en Vercel) |
| `apps/web/seed-rankings.ts:6`, `seed-products.ts:6`, `seed-more-rankings.ts:6`, `seed-food-playstore.ts:6`, `seed-all-categories.ts:6`, `inspect-db.ts:6`, `fix-seed.ts:6`, `clean-and-seed-real.ts:6`, `update-broken-images.ts:6` | `process.env.SUPABASE_SERVICE_ROLE_KEY` (scripts dev, manual) | actualizar el `.env` local del dev (gitignored; no en repo) |
| `apps/web/scripts/qa-delete-account.mjs:7,20,23` | idem | idem (.env local) |
| `.env.example:7`, `apps/web/.env.example` | placeholder `SUPABASE_SERVICE_ROLE_KEY` (sin valor) | ninguna (es plantilla) |

### `service_role` como ROLE de Postgres (NO es la key) -- sin accion
Estas referencias son al rol `service_role` en GRANT/REVOKE/policies, no al token:
`20260429120004_immutable_audit_logs.sql:10,47,106,133`, `20260320000019_account_deletion.sql:21,55,225,228`,
`20260521000011_rpc_update_profile_and_pause.sql:106`, `20260526120001_create_seller_rankings.sql:48`,
`20260610000002_manage_user_role.sql:10` (comentario), `openspec/.../studio-script.sql:177`,
`design.md:87,112`. **No rotar nada aqui.**

## CRITICO -- hardcodes encontrados (prefijo JWT `eyJhbG`, valores NO pegados)

1. **`docs/security/SECURITY_AUDIT_VICINO_20260512.md:123`** -- un audit PREVIO pego una JWT
   service_role como evidencia. Esta COMMITTEADA en git. **ERRADICAR**: redactar el valor en el
   doc (`[REDACTED-JWT]`). El token ya esta rotado/invalidado, pero sigue en el HISTORIAL de git;
   evaluar si se reescribe historia o se acepta (rotado = el valor viejo es inutil).
2. **DB trigger push-on-sale (vivo, NO en git)** -- token literal en el trigger. Es el motivo de
   la rotacion. **ERRADICAR** re-creando el trigger con Vault (ver tabla).
3. `.claude/skills/capawesome-skills/.../identity-vault-migration.md:74,84` -- JWTs de EJEMPLO de
   un skill de Ionic Identity Vault (3rd-party). **NO es la key de VICINO**. Sin accion.

Nota: `eyJhbG` NO aparece en NINGUNA migracion de `supabase/migrations/` ni en codigo de la app
-> el unico hardcode de la key de VICINO en git es el doc del punto 1; el del trigger esta solo
en la DB viva.

## Fuera de git (actualizar en sus dashboards; NO en el repo)

Estos NO viven en el repo y se rotan en su panel respectivo (listar cuales, no valores):

- **Supabase Vault** -- secret `service_role_key`. **Punto central de rotacion para los
  triggers de push.** Actualizar con la key nueva (p.ej. `vault.update_secret`/re-crear). Cubre
  `push_on_message_pgnet`, `push_on_appointment_pgnet` y el push-on-sale una vez migrado a Vault.
- **Supabase Edge Functions secrets** -- env `SUPABASE_SERVICE_ROLE_KEY` para: send-push,
  send-appointment-reminders, recompute-rankings, expire-confirmations, delete-account.
  (Verificar si Supabase lo auto-inyecta tras rotar, o si hay que setearlo a mano.)
- **Vercel env vars** -- `SUPABASE_SERVICE_ROLE_KEY` (lo usa `lib/supabase/admin.ts` -> /api/reports).
  Recordatorio: `NEXT_PUBLIC_SUPABASE_ANON_KEY` es PUBLICA por diseno (no rotar por esto).
- **`.env` local del dev** -- `SUPABASE_SERVICE_ROLE_KEY` para los scripts de seed/QA. Gitignored.
  (Aparte: `.env` root tiene `SUPABASE_ACCESS_TOKEN` -- token del CLI, OTRO secreto sensible; no
  es el service_role, pero conviene revisar que tampoco se haya filtrado.)

## Orden sugerido de remediacion (siguiente sesion, no ahora)
1. Vault: actualizar secret `service_role_key` con la key nueva (arregla los triggers Vault).
2. Re-crear el trigger push-on-sale leyendo Vault (migracion espejo + Studio); quitar el hardcode vivo.
3. Edge Functions secrets + Vercel env: setear la key nueva; smoke de /api/reports y de las functions.
4. Scrub `SECURITY_AUDIT_VICINO_20260512.md:123` (redactar el valor).
5. Dev local `.env`: la key nueva para los scripts.
