# Contrato: `iniciar_conversacion` (contacto / intención de compra)

Rama: `feat/chat-intencion-idempotente`. Nada de esto está en producción ni cambia pantallas; se comparte primero para coordinar la integración (Alejandro) y después se aplica.

## Qué resuelve

Hoy el botón «Quiero comprarlo» lleva a `/chat?seller=&product=&intent=buy`, y `chat/page.tsx` hace dos cosas sueltas: `get_or_create_chat` y luego un `INSERT` en `messages` con el aviso «quiere comprar». Un F5, un «atrás» o un doble toque repiten el segundo paso: el vendedor recibe el mismo aviso varias veces y no hay nada que identifique la operación.

La RPC `iniciar_conversacion` hace las dos cosas en **una** transacción, con una **clave de idempotencia** que el servidor genera al pintar la ficha. Misma clave = misma operación (no duplica). Clave nueva = intención nueva (sigue siendo posible).

## Lo que ya existía y se reutiliza

| Garantía | De dónde viene |
|---|---|
| Un solo chat por par comprador↔vendedor, en cualquier sentido | índice único `idx_chats_pair` (`LEAST/GREATEST`), respetado con `ON CONFLICT` + relectura |
| Actor derivado de la sesión, chat consigo mismo rechazado, vendedor suspendido/bloqueado rechazado | mismas reglas que `get_or_create_chat` (20260912130000) |
| Bloqueo bidireccional y suspensión | `vicino_guard.bloqueados_conmigo()` y `vicino_guard.cuenta_suspendida()` (R-01 y R-05) |
| No-leídos, des-ocultar y push al insertar el mensaje | triggers de `messages` ya existentes; el mensaje se inserta una vez, así que no se duplican |

`get_or_create_chat` conserva su firma (la sigue usando `avisarCitaEnChat`). La migración 20260912310000 le añade `ON CONFLICT` al `INSERT` del par (dos creaciones simultáneas del mismo chat ya no mueren con un 23505 crudo), le quita el `EXECUTE` a `anon`, le pone `42501` al «sin sesión» y le exige que el producto sea del vendedor. La misma migración cierra la policy de INSERT de `chats`, que dejaba crear el chat por REST a quien la RPC rechaza (bloqueado o suspendido): ahora exige comprador = quien llama, vendedor distinto, sin bloqueo y cuenta no suspendida. Ningún código de la app inserta en `chats` directamente.

## Entrada

`POST /rest/v1/rpc/iniciar_conversacion` (solo `authenticated`; `anon` recibe 401). Desde la app: server action `iniciarConversacion(input)` en `apps/web/app/(marketplace)/chat/actions.ts`.

| Argumento SQL | Server action | Tipo | Obligatorio | Notas |
|---|---|---|---|---|
| `p_vendedor_id` | `sellerId` | uuid | sí | perfil visible; distinto del actor; sin bloqueo en ningún sentido |
| `p_producto_id` | `productId` | uuid | solo con `compra` | debe ser **de ese vendedor**, no oculto, ni en borrador ni eliminado; para `compra`, además `estatus = 'disponible'` |
| `p_intencion` | `intencion` | `'contacto'` \| `'compra'` | no (default `contacto`) | `contacto` solo abre/obtiene el chat y **ignora** la clave |
| `p_clave` | `clave` | uuid | solo con `compra` | generada en el servidor al pintar la ficha; única por autor |

El comprador **no es un argumento**: es `auth.uid()`.

## Salida

```json
{ "chat_id": "uuid", "message_id": "uuid|null", "chat_nuevo": false, "mensaje_nuevo": false, "repetida": true }
```

Server action: `{ chatId, messageId, chatNuevo, mensajeNuevo, repetida }` o `{ error: string }` (texto ya traducido, nunca el mensaje crudo del motor).

| Situación | `chat_nuevo` | `mensaje_nuevo` | `repetida` | `message_id` |
|---|---|---|---|---|
| Primera vez, con intención | true/false | true | false | uuid |
| Misma clave otra vez (F5, atrás, doble toque, reintento) | false | false | **true** | el **mismo** uuid, aunque el producto se haya agotado entre medias |
| Clave nueva (otra vista de la ficha) | false | true | false | uuid nuevo, **mismo** `chat_id` |
| `contacto` (con o sin clave) | true/false | false | false | null |

## Errores (SQLSTATE → HTTP por PostgREST → texto en la app)

| Código | Cuándo | HTTP | Texto |
|---|---|---|---|
| `42501` | sin sesión; cuenta suspendida | 401/403 | «Tu cuenta está suspendida.» / «No tienes permiso…» |
| `22023` | intención inválida; `compra` sin producto o sin clave; chat consigo mismo | 400 | «Datos inválidos para iniciar la conversación.» |
| `PT404` | vendedor no visible o con bloqueo; producto inexistente, oculto, de otro vendedor, en borrador o eliminado; para `compra`, no disponible | 404 | «Este vendedor o producto ya no está disponible.» |
| `23514` | más de 30 intenciones en 24 h | 400 | «Demasiadas intenciones de compra hoy. Inténtalo mañana.» |
| `PT409` | la clave ya se usó en **otra** operación (otro vendedor u otro producto): bug del cliente | 409 | «Esta operación ya se registró con otros datos…» |

Vendedor suspendido, inexistente o bloqueado devuelven **la misma** respuesta: no se confirman bloqueos. Estos cinco códigos no van a Sentry (son respuestas). Cualquier otro sí, con el `details` de Postgres; en particular un `23505` real (unique_violation del motor) es un fallo, por eso el conflicto de negocio usa `PT409` y no `23505`.

## Garantías

1. **Sin estados parciales.** Todo ocurre dentro de la RPC (una transacción). Si falla el registro de la intención (cuota, cualquier error), tampoco queda el chat recién creado ni el bump de `ultimo_producto_id`, y la llamada devuelve error. Probado saboteando el `INSERT` con un trigger temporal (0 chats después) y por HTTP con la cuota (la 31.ª da 23514 y `updated_at` no cambia).
2. **Mismo `chat_id` para peticiones equivalentes.** Dos llaves advisory en orden fijo (`chat:intencion:<actor>` y luego `chat:par:<menor>:<mayor>`) + `idx_chats_pair` con `ON CONFLICT`. Dos peticiones simultáneas entran de una en una; `get_or_create_chat` y esta RPC devuelven el mismo chat para el mismo par (probado).
3. **Idempotencia por clave, antes de revalidar.** `messages.clave_idempotencia` con índice único parcial `(autor_id, clave_idempotencia)`. La clave se consulta **antes** de mirar vendedor y producto (un reintento devuelve lo mismo aunque el producto se haya agotado), se vuelve a consultar bajo las llaves exigiendo que el mensaje sea de este chat, y el `INSERT` lleva `ON CONFLICT … DO NOTHING` + relectura: **nunca** dos mensajes con la misma clave. La clave identifica una operación (autor + vendedor + producto): con otro vendedor u otro producto es `PT409`.
4. **RLS conservada y cerrada.** Las policies de SELECT y UPDATE de `chats` y `messages` no cambian. La de INSERT de `chats` pasa a exigir lo mismo que las RPC (comprador = quien llama, vendedor distinto, sin bloqueo, no suspendido). La policy de INSERT de `messages` conserva sus condiciones (participante, no suspendido) y además **rechaza `clave_idempotencia` y `message_type` arbitrarios desde el cliente**: por REST solo entran mensajes `user_text` sin clave, o el `sale_confirmed` que `confirmSale` escribe sobre una venta completada de la que el actor es parte. Los avisos `purchase_intent` solo nacen en la RPC. `sendMessage` y `confirmSale` siguen funcionando tal cual (probado).
5. **Protegida ante llamadas directas.** `EXECUTE` solo para `authenticated`; actor derivado; producto validado contra el vendedor y su estado; texto compuesto en la base (no viaja desde el cliente); cuota de 30/24 h por cuenta contada bajo la llave del actor (30 peticiones en paralelo hacia vendedores distintos entran de una en una: la 31.ª ve las 30), contando filas de `messages`, que no se pueden borrar por REST.

## Pruebas

- **SQL** (bloque VERIFY de la migración, ejercido bajo `BEGIN … ROLLBACK` en el proyecto de pruebas, 9 casos): misma clave → mismo mensaje y 1 fila; clave nueva → mensaje nuevo en el mismo chat; contacto no inserta e ignora la clave; reintento tras agotar el producto → misma respuesta; anon/consigo mismo/producto ajeno/sin clave/intención rara/producto inexistente/borrador/bloqueo/suspendido → el código esperado; clave reutilizada con otro vendedor u otro producto → PT409; fallo parcial (trigger saboteador) → 0 chats; 30 intenciones entran y la 31.ª da 23514; sin sobrecargas; `get_or_create_chat` devuelve el mismo chat; acento en «Cotización».
- **HTTP con concurrencia real** (`scripts/probar-iniciar-conversacion.mjs`, 25 comprobaciones): A. dos peticiones simultáneas con la misma clave → mismo chat, mismo mensaje, exactamente una con `mensaje_nuevo`, 1 fila; B. reintento → `repetida`; C. clave nueva → mensaje nuevo, 1 chat; D. anon 401 por ACL (permission denied), consigo mismo 22023, producto ajeno PT404, compra sin clave 22023, intención rara 22023, misma clave con otro producto PT409, contacto ignora la clave, INSERT directo forjando `purchase_intent` o con clave → 42501, texto normal sigue entrando; E. fallo sin rastro; F. 10 claves distintas en paralelo → 10 mensajes, 1 chat; G. 30 intenciones en paralelo entran, la 31.ª da 23514 y no deja bump, contacto sigue. Resultado del 12-sep-2026: **25/25**.

El harness **crea usuarios nuevos en cada corrida** (signup por GoTrue; exige autoconfirmación de correo, como la trae `supabase start`), porque la cuota de 30/24 h no se puede resetear por REST y con usuarios fijos la tercera corrida del día fallaba pareciendo una regresión. Se niega a correr contra producción.

```bash
VICINO_PRUEBAS_JSON=/ruta/credenciales.json node scripts/probar-iniciar-conversacion.mjs
```

(`{ url, anon, productoId, users.vendedor.id }`, o las variables `VICINO_PRUEBAS_*` que documenta el script).

## Integración propuesta (pantallas: Alejandro)

1. **La clave nace en el servidor, no en el cliente.** `sticky-cta.tsx` y `product-detail-desktop.tsx` son componentes cliente: un `crypto.randomUUID()` en su render daría un HTML distinto en servidor y cliente (error de hidratación). La clave se genera en el **componente de servidor** de la ficha (`app/(marketplace)/[categoria]/[slug]/page.tsx`) con `crypto.randomUUID()` y se pasa como prop `k` a ambos; ellos la añaden al `href`: `/chat?seller=…&product=…&intent=buy&k=<uuid>`. Así el HTML servido ya la trae, F5/«atrás»/reintento repiten la misma, y cada carga nueva de la ficha genera otra (intención nueva).
2. **`chat/page.tsx`** sustituye `getOrCreateChat` + el `INSERT` manual por la acción. Antes de llamar, normaliza la clave: `const clave = z.string().uuid().safeParse(k).success ? k : undefined;` y `intencion: intent === 'buy' && clave ? 'compra' : 'contacto'`. Así un `k` ausente, vacío, truncado por un cliente de mensajería o manipulado **no** termina en un error de validación: se abre el chat como `contacto` y no se registra intención (generar una clave por petición en el servidor volvería a duplicar con el F5). Para que el comprador no crea que ya avisó, en ese caso se redirige a `/chat/${chatId}?sinIntencion=1` y el chat pinta un aviso de una línea («Vuelve a la publicación y pulsa Quiero comprarlo para avisar al vendedor»). `intentFailed=1` deja de existir: si falla la intención, no hay chat que abrir; se muestra el `error` traducido.
3. **Tipos.** `apps/web/lib/chat/iniciar-conversacion.ts` envuelve la RPC con un solo `as` porque `database.types.ts` se genera desde producción y la RPC aún no está ahí. Al aplicar la migración: `node scripts/gen-types.mjs`, borrar el envoltorio y llamar `supabase.rpc("iniciar_conversacion", …)` directo.
4. **Rate limit.** La acción ya llama a `enforce(writeRateLimit, …)`; en producción los limitadores son no-op hasta que Upstash tenga credenciales (pendiente de Pedro). La cuota de 30/24 h vive en la base y sí aplica.

## Despliegue y reversión

Aplicar (cuando se apruebe), en este orden: `node scripts/apply-migration.mjs 20260912300000_iniciar_conversacion_idempotente.sql`, `node scripts/apply-migration.mjs 20260912310000_get_or_create_chat_on_conflict.sql`, y después `node scripts/gen-types.mjs`. Las dos son idempotentes y no tocan datos existentes (la columna nueva nace `NULL` en todos los mensajes). Ojo: la policy de INSERT de `messages` queda más estricta; cualquier código que hoy inserte mensajes con `message_type` distinto de `user_text`/`sale_confirmed` dejaría de funcionar (revisado: no hay ninguno).

Reversión (`docs/rollback/20260912300000_iniciar_conversacion_rollback.sql`): quita la RPC, el índice y la columna, y devuelve la policy de INSERT a su forma de 20260912120000. Los mensajes ya registrados **se conservan** (solo pierden la clave); los `purchase_intent` siguen siendo mensajes válidos y el chat los pinta como texto. `get_or_create_chat` puede quedarse con el `ON CONFLICT` (es estrictamente más robusto). El código TS que llame a la RPC hay que retirarlo antes (volver a `getOrCreateChat` + `INSERT`).

## Preguntas abiertas para Alejandro

- ¿`repetida: true` se muestra al usuario («ya avisaste al vendedor») o se ignora y se abre el chat sin más?
- ¿El aviso de compra debe seguir siendo un mensaje normal en el hilo, o el chat lo pinta distinto ahora que lleva `message_type = 'purchase_intent'`?
- Cuota de 30 intenciones/24 h por cuenta: ¿suficiente para el uso real de un comprador activo?
