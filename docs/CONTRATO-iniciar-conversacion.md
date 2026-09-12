# Contrato: `iniciar_conversacion` (contacto / intención de compra)

Rama: `feat/chat-intencion-idempotente`. Nada de esto está en producción ni cambia pantallas; se comparte primero para coordinar la integración (Alejandro) y después se aplica.

## Qué resuelve

Hoy el botón «Quiero comprarlo» lleva a `/chat?seller=&product=&intent=buy`, y `chat/page.tsx` hace dos cosas sueltas: `get_or_create_chat` y luego un `INSERT` en `messages` con el aviso «quiere comprar». Un F5, un «atrás» o un doble toque repiten el segundo paso: el vendedor recibe el mismo aviso varias veces y no hay nada que identifique la operación.

La RPC `iniciar_conversacion` hace las dos cosas en **una** transacción, con una **clave de idempotencia** que el cliente genera al pintar el botón. Misma clave = misma operación (no duplica). Clave nueva = intención nueva (sigue siendo posible).

## Lo que ya existía y se reutiliza

| Garantía | De dónde viene |
|---|---|
| Un solo chat por par comprador↔vendedor, en cualquier sentido | índice único `idx_chats_pair` (`LEAST/GREATEST`), respetado con `ON CONFLICT` + relectura |
| Actor derivado de la sesión, chat consigo mismo rechazado, vendedor suspendido/bloqueado rechazado | mismas reglas que `get_or_create_chat` (20260912130000) |
| Bloqueo bidireccional y suspensión | `vicino_guard.bloqueados_conmigo()` y `vicino_guard.cuenta_suspendida()` (R-01 y R-05) |
| No-leídos, des-ocultar y push al insertar el mensaje | triggers de `messages` ya existentes; el mensaje se inserta una vez, así que no se duplican |

`get_or_create_chat` **no se toca**: la sigue usando `avisarCitaEnChat`. Se sustituye solo en el flujo de la ficha cuando se integre.

## Entrada

`POST /rest/v1/rpc/iniciar_conversacion` (solo `authenticated`; `anon` recibe 401/42501). Desde la app: server action `iniciarConversacion(input)` en `apps/web/app/(marketplace)/chat/actions.ts`.

| Argumento SQL | Server action | Tipo | Obligatorio | Notas |
|---|---|---|---|---|
| `p_vendedor_id` | `sellerId` | uuid | sí | perfil visible; distinto del actor; sin bloqueo en ningún sentido |
| `p_producto_id` | `productId` | uuid | solo con `compra` | debe ser **de ese vendedor**, no oculto; para `compra`, además `estatus = 'disponible'` |
| `p_intencion` | `intencion` | `'contacto'` \| `'compra'` | no (default `contacto`) | `contacto` solo abre/obtiene el chat |
| `p_clave` | `clave` | uuid | solo con `compra` | generada por el cliente (`crypto.randomUUID()`) al pintar el botón; única por autor |

El comprador **no es un argumento**: es `auth.uid()`.

## Salida

```json
{ "chat_id": "uuid", "message_id": "uuid|null", "chat_nuevo": false, "mensaje_nuevo": false, "repetida": true }
```

Server action: `{ chatId, messageId, chatNuevo, mensajeNuevo, repetida }` o `{ error: string }` (texto ya traducido, nunca el mensaje crudo del motor).

| Situación | `chat_nuevo` | `mensaje_nuevo` | `repetida` | `message_id` |
|---|---|---|---|---|
| Primera vez, con intención | true/false | true | false | uuid |
| Misma clave otra vez (F5, atrás, doble toque, reintento) | false | false | **true** | el **mismo** uuid |
| Clave nueva (otra vista de la ficha) | false | true | false | uuid nuevo, **mismo** `chat_id` |
| `contacto` | true/false | false | false | null |

## Errores (SQLSTATE → HTTP por PostgREST → texto en la app)

| Código | Cuándo | HTTP | Texto |
|---|---|---|---|
| `42501` | sin sesión; cuenta suspendida | 401/403 | «Tu cuenta está suspendida.» / «No tienes permiso…» |
| `22023` | intención inválida; `compra` sin producto o sin clave; chat consigo mismo | 400 | «Datos inválidos para iniciar la conversación.» |
| `PT404` | vendedor no visible o con bloqueo; producto inexistente, oculto, de otro vendedor o no disponible | 404 | «Este vendedor o producto ya no está disponible.» |
| `23514` | más de 30 intenciones en 24 h | 400 | «Demasiadas intenciones de compra hoy. Inténtalo mañana.» |
| `23505` | la clave ya se usó en **otra** conversación (bug del cliente) | 409 | «Esta operación ya se registró con otros datos…» |

Vendedor suspendido, inexistente o bloqueado devuelven **la misma** respuesta: no se confirman bloqueos. Estos cinco códigos no van a Sentry (son respuestas); cualquier otro sí, con el `details` de Postgres.

## Garantías

1. **Sin estados parciales.** Todo ocurre dentro de la RPC (una transacción). Si falla el registro de la intención, tampoco queda el chat recién creado y la llamada devuelve error. Probado saboteando el `INSERT` con un trigger temporal: 0 chats después del fallo.
2. **Mismo `chat_id` para peticiones equivalentes.** Llave advisory por par (`chat:par:<menor>:<mayor>`) + `idx_chats_pair`. Dos peticiones simultáneas entran de una en una; `get_or_create_chat` y esta RPC devuelven el mismo chat para el mismo par (probado).
3. **Idempotencia por clave.** `messages.clave_idempotencia` con índice único parcial `(autor_id, clave_idempotencia)`. Se comprueba antes y después de tomar la llave, y el `INSERT` lleva `ON CONFLICT … DO NOTHING` + relectura: **nunca** dos mensajes con la misma clave, ni con dos peticiones simultáneas.
4. **RLS intacta.** No hay policies nuevas; `messages` y `chats` conservan las suyas. La RPC es `SECURITY DEFINER` y por eso repite por dentro las comprobaciones que la policy de INSERT haría (participante, suspensión).
5. **Protegida ante llamadas directas.** `EXECUTE` solo para `authenticated`; actor derivado; producto validado contra el vendedor; texto compuesto en la base (no viaja desde el cliente); cuota de 30/24 h por cuenta contando filas de `messages` (sin policy de DELETE, no se pueden borrar para resetearla).

## Pruebas

- **SQL** (bloque VERIFY de la migración, ejercido bajo `BEGIN … ROLLBACK` en el proyecto de pruebas): misma clave → mismo mensaje y 1 fila; clave nueva → mensaje nuevo en el mismo chat; contacto no inserta; anon/consigo mismo/producto ajeno/sin clave/intención rara/producto inexistente/bloqueo/suspendido/agotado → el código esperado; clave reutilizada con otro vendedor → 23505; fallo parcial → 0 chats; 30 intenciones entran y la 31.ª da 23514; sin sobrecargas; `get_or_create_chat` devuelve el mismo chat.
- **HTTP con concurrencia real** (`scripts/probar-iniciar-conversacion.mjs`, contra Supabase local o un proyecto de pruebas, nunca producción): A. dos peticiones simultáneas con la misma clave → mismo chat, mismo mensaje, exactamente una con `mensaje_nuevo`, 1 fila; B. reintento → `repetida`; C. clave nueva → mensaje nuevo, 1 chat; D. anon 401, consigo mismo 22023, producto ajeno PT404, compra sin clave 22023, intención rara 22023; E. fallo sin estado parcial; F. 10 claves distintas en paralelo → 10 mensajes, 1 chat. Resultado del 12-sep-2026: **16/16**.

Cómo correrlo:

```bash
VICINO_PRUEBAS_JSON=/ruta/credenciales.json node scripts/probar-iniciar-conversacion.mjs
```

(o las variables `VICINO_PRUEBAS_*` que documenta el script; se niega a correr contra `oxxdkwywprkfghhbnoto`).

## Integración propuesta (pantallas: Alejandro)

1. **La clave nace en la ficha.** `sticky-cta.tsx` y `product-detail-desktop.tsx` generan `k = crypto.randomUUID()` al renderizar y la añaden al `href`: `/chat?seller=…&product=…&intent=buy&k=<uuid>`. Así F5, «atrás» y el reintento de red llevan la misma clave; volver a la ficha genera otra (intención nueva). Sin `k`, el servidor puede generar una por petición, pero entonces el F5 vuelve a duplicar: la clave **tiene** que venir de la vista.
2. **`chat/page.tsx`** sustituye `getOrCreateChat` + el `INSERT` manual por una llamada a `iniciarConversacion({ sellerId, productId, intencion: intent === 'buy' ? 'compra' : 'contacto', clave: k })` y redirige a `/chat/${chatId}`. `intentFailed=1` deja de existir: si falla la intención, no hay chat que abrir; se muestra el `error` traducido.
3. **Tipos.** `apps/web/lib/chat/iniciar-conversacion.ts` envuelve la RPC con un solo `as` porque `database.types.ts` se genera desde producción y la RPC aún no está ahí. Al aplicar la migración: `node scripts/gen-types.mjs`, borrar el envoltorio y llamar `supabase.rpc("iniciar_conversacion", …)` directo.
4. **Rate limit.** La acción ya llama a `enforce(writeRateLimit, …)`; recuerda que en producción los limitadores son no-op hasta que Upstash tenga credenciales (pendiente de Pedro). La cuota de 30/24 h vive en la base y sí aplica.

## Despliegue y reversión

Aplicar (cuando se apruebe): `node scripts/apply-migration.mjs 20260912300000_iniciar_conversacion_idempotente.sql` y después `node scripts/gen-types.mjs`. La migración es idempotente y no toca datos existentes (la columna nueva nace `NULL` en todos los mensajes).

Reversión (`docs/rollback/20260912300000_iniciar_conversacion_rollback.sql`): quita la RPC, el índice y la columna. Los mensajes ya registrados **se conservan** (solo pierden la clave); los que nacieron con `message_type = 'purchase_intent'` siguen siendo mensajes válidos y el chat los pinta como texto. El código TS que llame a la RPC hay que retirarlo antes (volver a `getOrCreateChat` + `INSERT`).

## Preguntas abiertas para Alejandro

- ¿`repetida: true` se muestra al usuario («ya avisaste al vendedor») o se ignora y se abre el chat sin más?
- ¿El aviso de compra debe seguir siendo un mensaje normal en el hilo, o el chat lo pinta distinto ahora que lleva `message_type = 'purchase_intent'`?
- Cuota de 30 intenciones/24 h por cuenta: ¿suficiente para el uso real de un comprador activo?
