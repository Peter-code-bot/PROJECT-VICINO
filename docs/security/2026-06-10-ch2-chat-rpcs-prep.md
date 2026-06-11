# VICINO - CH-2 prep: dossier de los RPC de chat (#4 BOLA/IDOR)

Fecha: 2026-06-10 (sesion read-only). Finding #4: `get_or_create_chat` y
`mark_messages_as_read` son SECURITY DEFINER que toman IDs por parametro sin derivar
`auth.uid()`, asi que un POST directo a PostgREST (saltandose la app) puede operar con IDs
arbitrarios (crear/reabrir chats entre terceros; marcar leidos / poner a cero contadores de
otros). Esta sesion NO modifica nada; prepara CH-2.

## GATE 0

- HEAD de la rama de trabajo: `42cad30` (security/fase0-audit-verification, ahead 9, behind 1).
- **origin/master avanzo a `6721389`** (iba en 3f4fffc cuando se rebaso; antes 83132f9). El
  codigo de chat NO cambio en estos avances (son fixes ajenos). Al mergear CH-2 habra que
  rebasar de nuevo sobre el master del momento.

## Fuente de los RPC (migracion)

| RPC | Definicion | search_path fix |
|---|---|---|
| `get_or_create_chat(p_comprador_id uuid, p_vendedor_id uuid, p_producto_id uuid DEFAULT NULL)` | `supabase/migrations/20260320000009_chats_messages.sql:41-74` | `20260425000001:8-9` |
| `mark_messages_as_read(p_chat_id uuid, p_user_id uuid)` | `supabase/migrations/20260320000009_chats_messages.sql:98-115` | `20260425000001:11-12` |

Ambos `SECURITY DEFINER`, sin guard `auth.uid()`, sin REVOKE de anon (grant default de Supabase).
(Nota menor: un comentario en `20260604000004` menciona "find_or_create_chat" -- ese nombre NO
existe; es shorthand del autor para `get_or_create_chat`. No es un call site.)

## Call sites (todos los del cliente)

| file:line | RPC | args que pasa el cliente (orden) | deriva o confia? |
|---|---|---|---|
| `apps/web/app/(marketplace)/chat/actions.ts:43-46` | get_or_create_chat | `p_comprador_id: user.id`, `p_vendedor_id: parsed.data.seller_id`, `p_producto_id: parsed.data.product_id ?? null` | comprador = **server** (`user.id` de `auth.getUser()`), PERO el RPC **confia** en el param (no re-deriva). vendedor/producto = cliente (legitimos). |
| `apps/web/app/(marketplace)/chat/actions.ts:197-200` | mark_messages_as_read | `p_chat_id: parsed.data.chat_id`, `p_user_id: user.id` | user = **server** (`user.id`), PERO el RPC **confia** en el param. |
| `apps/web/app/(marketplace)/chat/[id]/page.tsx:87-90` | mark_messages_as_read | `p_chat_id: chatId`, `p_user_id: user.id` | idem. |

Conteo: **get_or_create_chat = 1 call site**; **mark_messages_as_read = 2 call sites**. Cero en
`packages/`. 

### Derivacion del usuario en esos flujos (auth.uid equivalente server-side)
- `chat/actions.ts:16-22` (`getOrCreateChat`): `createClient()` (sesion) -> `supabase.auth.getUser()`
  -> `if (!user) redirect("/login")`. Tambien hay un guard de self-chat en `:39-41`
  (`user.id === seller_id` -> error).
- `chat/actions.ts` (`markChatRead`, ~190-200) y `chat/[id]/page.tsx` (~70-90): mismo patron
  `auth.getUser()` antes de llamar el RPC.

**Insight central:** los 3 call sites YA pasan el `user.id` correcto derivado en server. La
falla NO es la app -- es que el RPC confia en el parametro en vez de derivar `auth.uid()`
internamente. Por lo tanto, derivar `auth.uid()` adentro es **behavior-preserving** para la app
(el valor que la app envia ya ES `auth.uid()`).

### Contrato de retorno que la UI espera (no debe romperse)
- `get_or_create_chat` -> `UUID` (chat_id). Caller `getOrCreateChat` devuelve
  `{ chatId: string } | { error: string }` (`chat/actions.ts:43-50`); el componente que lo
  invoca usa `chatId` para navegar a `/chat/[chatId]`. Derivar el comprador internamente NO
  cambia el tipo de retorno (sigue siendo el UUID del chat).
- `mark_messages_as_read` -> `VOID`. Los 2 callers ignoran el retorno. Derivar internamente NO
  cambia nada.

## Plan de migracion de firma

### mark_messages_as_read -> derivar `auth.uid()` interno, MISMA firma (cero edits de app)
`CREATE OR REPLACE` manteniendo `(p_chat_id uuid, p_user_id uuid)`. Adentro:
`v_user := auth.uid()` y usar `v_user` en vez de `p_user_id` (el param queda vestigial/ignorado).
ADEMAS agregar guard de participacion: si `v_user` no es comprador NI vendedor del chat, no hacer
nada (hoy, si no es el comprador, cae al ELSE y marca leidos del vendedor -- un no-participante
autenticado podria poner a cero el contador del vendedor). `REVOKE EXECUTE FROM anon`. Cero edits
de app (los 2 callers ya mandan `p_user_id: user.id`, que se ignora).

### get_or_create_chat -> VEREDICTO abajo
Tres opciones evaluadas:

| Opcion | Que implica | Riesgo |
|---|---|---|
| A. Cambio directo a 2-arg | DROP 3-arg + CREATE `(p_vendedor_id, p_producto_id)`, editar el 1 call site | **Race de deploy**: la app VIVA en prod sigue llamando 3-arg hasta que Vercel publique el caller 2-arg -> ventana (minutos) en que "iniciar chat" rompe para todos. Inaceptable en marketplace vivo. |
| B. Overload transitorio | Crear 2-arg + dejar shim 3-arg (mismos nombres `p_comprador_id/p_vendedor_id/p_producto_id`) que ignora `p_comprador_id` y usa `auth.uid()`; deploy app; luego dropear el shim | Sin race, pero 2 pasos DB + 1 edit de app + cleanup posterior. |
| C. Derivar en sitio, MISMA firma 3-arg | `CREATE OR REPLACE` 3-arg, ignorar `p_comprador_id`, derivar comprador de `auth.uid()` | **Cero edits de app, cero race.** El param `p_comprador_id` queda vestigial. Quitar el param (a 2-arg) es cosmetico y se difiere. |

## VEREDICTO

**Opcion C para AMBOS RPC: derivar `auth.uid()` internamente conservando la firma actual.**

Justificacion por # de call sites + estado de prod:
- El cambio directo a 2-arg seria "viable" por tener get_or_create_chat un solo call site, PERO
  el constraint real NO es el numero de call sites sino la **ventana de deploy contra la app
  viva** (prod llama 3-arg hasta que el nuevo build este Ready). Cualquier cambio de firma exige
  el overload transitorio para evitar el race.
- Derivar en sitio (misma firma) cierra el #4 igual de bien (la identidad sensible sale de
  `auth.uid()`, no del payload), con **cero edits de app y cero riesgo de deploy**, y es
  consistente con el fix de `mark_messages_as_read`.
- Quitar `p_comprador_id` (pasar a 2-arg) queda como **limpieza cosmetica diferida**; si se
  quiere, se hace despues con el overload transitorio (Opcion B) porque hay 1 solo call site.

### Notas de diseno para CH-2 (al escribir la migracion)
- `get_or_create_chat`: `v_comprador := auth.uid()`; `IF v_comprador IS NULL THEN RAISE` (anon
  fuera); rechazar self-chat (`v_comprador = p_vendedor_id`); idealmente validar que el producto
  pertenezca al vendedor y este disponible (cierra creacion de chats sobre productos ajenos).
  `REVOKE ALL FROM PUBLIC; REVOKE EXECUTE FROM anon; GRANT EXECUTE TO authenticated;`
  mantener `SET search_path = public, pg_temp`. `CREATE OR REPLACE` (idempotente, sin DROP).
- `mark_messages_as_read`: `v_user := auth.uid()` + guard de participacion + `REVOKE anon`.
- Gate de BLOQUE A: A3/A9 (confirmar que anon/authenticated tienen EXECUTE hoy sobre ambos RPC).
- #14 `has_role` NO se toca aqui (va al final, change propio).
