# Bandeja de WhatsApp — Spec (delta, capacidad nueva)

Anclada al codigo de la rama `feat/bandeja-whatsapp-20261108`. Cada Requirement apunta a
un archivo del repo; nada se afirma que no se pueda senalar.

## Purpose

Un negocio con el modo vendedor activo recibe en VICINO los mensajes que sus clientes le
escriben a su numero de WhatsApp Business (Cloud API de Meta) y los responde desde
`/seller/bandeja`. La entrada de mensajes es el webhook `/api/webhooks/whatsapp`; la
salida, la Server Action `responderWhatsApp`. Los datos viven en cinco tablas con RLS por
negocio y se escriben solo por RPC.

## Glossary

- **Canal** — fila de `canales_whatsapp`: un `phone_number_id` de Meta conectado a un
  `negocio_id` (perfil vendedor). `activo` o `pausado`.
- **Conversacion** — fila de `conversaciones_whatsapp`: (canal, `wa_id` del cliente).
- **wamid** — identificador de mensaje de WhatsApp; unico en `mensajes_whatsapp`.
- **Estado huerfano** — un `statuses[]` de Meta que llego antes de que el mensaje saliente
  tuviera wamid; vive en `estados_huerfanos_whatsapp` hasta que `cerrar_envio` lo aplica.
- **Ventana de 24 h** — periodo desde `ultimo_entrante_at` en el que WhatsApp permite
  responder con texto libre.
- **Firma** — cabecera `X-Hub-Signature-256` (`sha256=` + HMAC-SHA256 del cuerpo crudo con
  el App Secret de la app de Meta).

## Requirements

### Requirement: El webhook solo acepta avisos firmados por Meta, verificados dos veces

WHEN llega un POST a `/api/webhooks/whatsapp`, the system SHALL exigir `WHATSAPP_APP_SECRET`
en el servidor (503 y Sentry si falta), verificar la firma con el en tiempo constante (401
sin tocar la base si no coincide) y reenviar el cuerpo CRUDO y la cabecera al RPC
`ingerir_webhook_whatsapp`; el RPC SHALL recalcular el HMAC-SHA256 con el secreto
`whatsapp_app_secret` del Vault, compararlo por resumenes y rechazar con SQLSTATE `P0401`
todo cuerpo cuya firma no coincida, sin escribir ninguna fila. WHEN el RPC devuelve `P0401`
tras haber pasado la ruta, the system SHALL responder 401 y reportarlo a Sentry (los dos
secretos divergen).

Anclado en `apps/web/app/api/webhooks/whatsapp/route.ts` (POST),
`apps/web/lib/whatsapp/firma.ts` y `supabase/migrations/20261108180000_bandeja_whatsapp.sql`
(seccion 4).

#### Scenario: Firma valida
- GIVEN el App Secret esta en Vercel y en el Vault
- WHEN Meta manda un aviso con `X-Hub-Signature-256` correcto
- THEN la ruta responde 200 con `{ok, duplicado, nuevos, estados, estados_sin_mensaje, sin_canal, ignorados}`

#### Scenario: Firma ausente o invalida
- WHEN el POST no trae la cabecera, o trae una que no coincide, o esta mal formada
- THEN la ruta responde 401 sin llamar a la base y sin Sentry

#### Scenario: Secretos distintos
- GIVEN el App Secret de Vercel no es el del Vault
- WHEN llega un aviso firmado por Meta
- THEN la ruta lo acepta, el RPC lanza `P0401`, la ruta responde 401 y Sentry recibe un error

#### Scenario: Secreto ausente en el Vault
- GIVEN no existe `whatsapp_app_secret` en el Vault
- WHEN llega un aviso
- THEN el RPC lanza 55000, la ruta responde 503 y lo reporta a Sentry (Meta reintentara)

#### Scenario: Privilegios perdidos
- GIVEN la funcion ya no puede leer el Vault o usar pgcrypto
- WHEN llega un aviso
- THEN el RPC lanza 42501, la ruta responde 500 y Sentry recibe la excepcion (nunca se
  confunde con una firma invalida)

### Requirement: La verificacion del endpoint sigue el protocolo de Meta

WHEN llega un GET con `hub.mode=subscribe`, `hub.verify_token` igual a
`WHATSAPP_VERIFY_TOKEN` y un `hub.challenge` de hasta 128 caracteres alfanumericos, the
system SHALL responder 200 con el challenge en texto plano; en cualquier otro caso SHALL
responder 403, y 503 si la variable no esta configurada.

Anclado en `route.ts` (GET) y `lib/whatsapp/config.ts` (`tokenVerificacionWebhook`).

### Requirement: Un aviso se procesa una sola vez y se recorta si no dejo nada

WHEN el mismo cuerpo llega dos veces, the system SHALL responder 200 con `duplicado: true`
sin escribir; WHEN llega un mensaje cuyo `wamid` ya existe (en otro cuerpo), the system
SHALL no duplicar el mensaje ni los contadores; WHEN un aviso no produce mensajes nuevos,
estados ni huerfanos, the system SHALL conservar del evento solo la huella, el resumen, el
`object` y los `phone_number_id` que traia.

Anclado en la migracion, seccion 4.3 (huella sha256 UNIQUE), el `ON CONFLICT (wamid) DO
NOTHING` con `IF FOUND` y el UPDATE final de `eventos_webhook_whatsapp`.

### Requirement: Solo los numeros conectados reciben; pausar no pierde mensajes

WHEN el `phone_number_id` del aviso no corresponde a ningun canal, the system SHALL contar el
cambio como `sin_canal` y no crear conversaciones ni mensajes. WHEN corresponde a un canal
`pausado`, the system SHALL guardar los mensajes y los estados igual que si estuviera activo.

#### Scenario: Canal pausado
- GIVEN un canal pausado por un admin con `cambiar_estado_canal_whatsapp(id, false)`
- WHEN llega un mensaje a ese numero
- THEN el mensaje se guarda y `preparar_envio_whatsapp` sigue rechazando con 55000 hasta que
  el admin reactive

### Requirement: Solo el negocio dueno ve sus conversaciones y mensajes

WHEN un usuario autenticado consulta `conversaciones_whatsapp` o `mensajes_whatsapp`, the
system SHALL devolver solo filas con `negocio_id = auth.uid()`; un administrador SHALL ver
`canales_whatsapp` pero no conversaciones ni mensajes; `anon` SHALL no tener SELECT en
ninguna de las cinco tablas; `eventos_webhook_whatsapp` y `estados_huerfanos_whatsapp` SHALL
no ser legibles por ningun rol de cliente. The system SHALL impedir, con FK compuestas
`(canal_id, negocio_id)` y `(conversacion_id, negocio_id)`, que el `negocio_id` de una
conversacion o un mensaje difiera del de su canal.

Anclado en la migracion, secciones 1 y 2 (FK, REVOKE/GRANT y policies).

### Requirement: Responder exige dueno, canal activo, ventana abierta y ritmo

WHEN el negocio llama a `preparar_envio_whatsapp(conversacion, texto)`, the system SHALL
rechazar con P0002 si la conversacion no es suya, con 55000 si el canal esta pausado, si
`ultimo_entrante_at` es nulo o anterior a `now() - 24 h`, o si lleva 30 salientes en el
ultimo minuto, y con 22023 si el texto limpio no tiene entre 1 y 4096 caracteres; si todo
pasa SHALL insertar el mensaje como `pendiente` y devolver `{mensaje_id, phone_number_id,
wa_id, texto}`. Los mensajes de esos errores SHALL estar escritos para la persona, con
acentos.

Anclado en la migracion, seccion 5, y en `app/seller/bandeja/actions.ts`
(`responderWhatsApp`, que ademas aplica `whatsappEnvioRateLimit` por usuario).

#### Scenario: Envio aceptado por Meta
- WHEN Graph responde `{messages:[{id}]}`
- THEN `cerrar_envio_whatsapp(mensaje_id, wamid)` deja el mensaje `enviado` con su wamid,
  aplica el estado huerfano si lo habia, y la conversacion refleja el ultimo texto

#### Scenario: Envio rechazado por Meta
- WHEN Graph responde `{error:{code:131047,...}}`
- THEN `cerrar_envio_whatsapp(mensaje_id, NULL, 131047, detalle)` deja el mensaje
  `fallido` y la persona ve el mensaje traducido ("Pasaron más de 24 horas...")

#### Scenario: Envio sin confirmar
- WHEN no hay respuesta de Graph, se agota el tiempo o Meta responde 2xx sin un
  identificador usable
- THEN el mensaje se queda `pendiente`, no se llama a `cerrar_envio_whatsapp`, Sentry
  recibe un aviso y la persona lee que no se pudo confirmar y que no lo reenvie todavia

#### Scenario: Servidor sin token
- GIVEN `WHATSAPP_ACCESS_TOKEN` no esta en el servidor
- WHEN el negocio responde
- THEN no se llama a Graph, el mensaje se cierra como `fallido` con el codigo propio -1, se
  avisa a Sentry y la persona ve que el envio no esta configurado (sin el nombre de la variable)

#### Scenario: Lo que ve el negocio de un fallo
- WHEN el hilo pinta un mensaje `fallido`
- THEN muestra `mensajeParaUsuario(error_codigo)`; `error_detalle` no viaja al navegador

### Requirement: Los estados de un envio solo avanzan, y los que se adelantan no se pierden

WHEN llega un `statuses[]` para un wamid saliente del negocio, the system SHALL aplicar el
estado solo si su rango (`enviado` 1 < `entregado` 2 < `leido` 3; `fallido` 9) es mayor que
el actual, guardando `error_codigo` y `error_detalle` en `fallido`; WHEN no existe ningun
mensaje con ese wamid, the system SHALL guardarlo en `estados_huerfanos_whatsapp` (el de
mayor rango) y `cerrar_envio_whatsapp` SHALL aplicarlo y borrarlo al poner el wamid; `played`
y estados desconocidos SHALL ignorarse sin error; un estado bajo el numero de otro negocio
SHALL no tocar nada.

Anclado en la migracion (`whatsapp_rango_estado`, el UPDATE de statuses y
`cerrar_envio_whatsapp`).

### Requirement: Solo un admin conecta, pausa, reactiva y desconecta numeros; un numero, un negocio

WHEN se llama a `conectar_canal_whatsapp`, the system SHALL exigir `has_role(uid,'admin')`
(42501), digitos en `phone_number_id` y `waba_id` (22023), un perfil con `es_vendedor`
(22023), y SHALL rechazar con 23505 conectar un numero ya conectado a otro negocio o un
segundo numero a un negocio que ya tiene uno; repetir la misma conexion SHALL ser
idempotente y SHALL no deshacer una pausa. `cambiar_estado_canal_whatsapp` y
`eliminar_canal_whatsapp` SHALL exigir el rol admin (42501) incluso al dueno del canal;
eliminar SHALL borrar en cascada conversaciones y mensajes. La busqueda del negocio por
usuario en `/admin/whatsapp` SHALL no distinguir mayusculas.

Anclado en la migracion, seccion 6, y `app/admin/whatsapp/actions.ts`.

### Requirement: Retencion acotada

The system SHALL borrar `eventos_webhook_whatsapp` y `estados_huerfanos_whatsapp` con mas de
7 dias, `mensajes_whatsapp` con mas de 180 dias y `conversaciones_whatsapp` con mas de 180
dias sin actividad y ya sin mensajes, mediante los jobs de pg_cron
`purgar-eventos-webhook-whatsapp` (04:41 UTC), `purgar-estados-huerfanos-whatsapp` (04:43),
`purgar-mensajes-whatsapp` (04:47) y `purgar-conversaciones-whatsapp` (04:53).

### Requirement: El hilo muestra lo mas reciente y la hora correcta

WHEN se abre `/seller/bandeja/[id]`, the system SHALL cargar los ULTIMOS 300 mensajes
(orden descendente por `marca_tiempo`, `created_at`, invertidos para pintar), indicar si hay
mas antiguos, pintar la hora de cada mensaje solo despues de hidratar (zona del navegador) y
bajar al final solo cuando llega un mensaje nuevo. WHEN no se puede leer el estado del
canal, the system SHALL decirlo en vez de afirmar que esta pausado.

Anclado en `app/seller/bandeja/[id]/page.tsx` y `app/seller/bandeja/hilo-whatsapp.tsx`.

### Requirement: La pantalla existe solo con la bandera

WHEN `NEXT_PUBLIC_VICINO_BANDEJA_WHATSAPP` no es exactamente `"1"`, the system SHALL
responder 404 en `/seller/bandeja`, `/seller/bandeja/[id]` y `/admin/whatsapp`, no mostrar
las entradas de menu y las Server Actions de la bandeja SHALL rechazar; el webhook SHALL
funcionar igual. WHEN la bandera esta encendida y el negocio no tiene canal, the system
SHALL explicar que la bandeja esta en piloto con un numero de prueba y un solo negocio.

Anclado en `lib/whatsapp/bandera.ts` y sus usos.
