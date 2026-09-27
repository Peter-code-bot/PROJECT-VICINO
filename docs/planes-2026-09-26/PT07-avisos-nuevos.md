# Plan PT07-avisos-nuevos

**Pendiente:** PT07: avisos nuevos (oferta a Solicitud, cita al comprador) con un trigger único y sin duplicados

**Fuentes en Notion:** A l.21,85-91 (PT07-avisos-nuevos)

**Estado conciliado (26-sep ~23:30):** decision. AUDITORIA §6 propone un solo trigger sobre notifications con un mapa tipo → prioridad/enlace/preferencia en send-push, lo que obliga a quitar push_on_appointment_pgnet y push_on_sale_pgnet. No hay migración ni código.

**Qué falta:** Decidir la v1 (propuesta: oferta a Solicitud y cita al comprador). Después, una sola migración: fila en notifications para request_responses, trigger único de push y DROP de los 2 triggers pgnet (firma de Pedro). Mapa en send-push, prueba de no duplicados en staging y despliegue con Pedro.

## Objetivo

Que el teléfono suene (una sola vez) cuando alguien oferta en tu Solicitud y cuando te agendan una cita como comprador, con un solo trigger de push sobre notifications y un mapa tipo→grupo/enlace en send-push, retirando push_on_appointment_pgnet y push_on_sale_pgnet en la misma transacción. Sin cambios de apariencia.

## Pasos

1. 0. DECISIONES (Pedro+Javier), antes de escribir código. D1: alcance v1 = oferta a Solicitud + cita al comprador; recordatorios, comunidades y reseña quedan fuera. D2: ¿sale_confirmation entra al trigger único (2 DROP, como propone la auditoría) o conserva push_on_sale_pgnet (1 DROP)? Propuesta: entra. D3: la oferta usa el grupo 'ventas', y el texto del interruptor pasa a «Confirmaciones de venta, citas que te agendan y ofertas a tus solicitudes». D4: el push usa titulo/mensaje de la fila. En la pantalla de bloqueo salen el nombre y el título del producto; la dirección nunca. D5: el icono y la etiqueta de 'oferta_solicitud' en la campana salen de la familia existente; Javier los aprueba sin estilo nuevo.
2. 1. Prerrequisito, fuera de este plan: Pedro despliega send-push del repo (9f1ab8d) y se corre la prueba en dispositivo de AUDITORIA §5. Sin esa línea base no se puede afirmar 'sin duplicados'.
3. 2. PASO 0 en prod, solo lectura (scripts/db-query.mjs): pg_get_functiondef de notify_appointment_created, notify_sale_confirmation_created, call_send_push_on_appointment y call_send_push_on_sale; pg_trigger de appointments, sale_confirmations, notifications y request_responses; columnas notifications.push_sent, purchase_requests.title/buyer_id y sale_confirmations.chat_id. Si prod difiere del repo (redefinido en Studio, como pasó con notify_push), se parte de la versión de prod.
4. 3. Rama feat/pt07-avisos-trigger-unico desde master actualizado (git fetch + log).
5. 4. Nuevo módulo puro supabase/functions/send-push/avisos.ts, sin imports de Deno. TIPOS_CON_PUSH = { oferta_solicitud: grupo 'ventas', url /solicitudes/<request_id>; cita_agendada: 'ventas', /citas/<appointment_id>; sale_confirmation: 'ventas', /chat/<chat_id> o /historial }. avisoDesdeNotificacion(record) devuelve {receiverId: record.user_id, titulo, cuerpo recortado, url, grupo} o null. Los ids se validan como UUID; si no lo son, se usa la ruta de respaldo, y nunca una URL externa.
6. 5. Pruebas unitarias en supabase/functions/send-push/avisos.test.ts (node:test con jiti, como apps/web/lib/geo/location-search.test.ts): url y grupo de cada tipo; null para tipo desconocido, review_reminder, trust_upgrade y comunidad_*; respaldo si el id no es UUID; y los tipos del WHEN de la migración (se lee el .sql) coinciden con las claves del mapa.
7. 6. supabase/functions/send-push/index.ts: acepta table='notifications' y conserva messages/appointments/sale_confirmations para la transición y la reversión. Con 'notifications', aplica el mapa y consulta acepta_notificacion con su grupo. Después hace el reclamo atómico `update notifications set push_sent=true where id=$1 and push_sent is not true returning id`: sin fila → 200 {ignored:'already sent'}. Queda como 'a lo sumo una vez'. Todas las respuestas llevan {via: table, tipo, notification_id} para poder contarlas.
8. 7. Migración nueva supabase/migrations/20260927100000_push_unico_sobre_notifications.sql, en una sola transacción. (a) notificar_oferta_en_solicitud(): SECURITY DEFINER, search_path ''; trigger AFTER INSERT ON request_responses que escribe una fila 'oferta_solicitud' para purchase_requests.buyer_id con data {request_id, response_id, seller_id}. Salta bloqueos en ambos sentidos (user_blocks) y la re-oferta del mismo vendedor a la misma solicitud en menos de 24 h (borrar y reinsertar serviría para mandar spam). Molde EXCEPTION→WARNING de notify_appointment_created. (b) Si D2=entra: CREATE OR REPLACE de notify_sale_confirmation_created añadiendo chat_id a data (hoy no lo lleva; también arregla el enlace de la campana). (c) call_send_push_on_notification(), con el molde de call_send_push_on_*: Vault service_role_key y timeout de 30000. Toma la URL del secreto de Vault 'send_push_url' y, si falta, la de prod; así staging se llama a sí mismo. (d) Trigger push_on_notification AFTER INSERT ON notifications WHEN (NEW.tipo IN ('oferta_solicitud','cita_agendada','sale_confirmation')). (e) DROP TRIGGER push_on_appointment_pgnet ON appointments y push_on_sale_pgnet ON sale_confirmations (firma de Pedro). Las funciones viejas se conservan para poder revertir. (f) Bloque VERIFY.
9. 8. Reversión en docs/rollback/20260927100000_push_unico_sobre_notifications_rollback.sql: recrea los 2 triggers pgnet, quita push_on_notification y el trigger de ofertas, y restaura notify_sale_confirmation_created.
10. 9. Campana, sin tocar la apariencia: en apps/web/app/(marketplace)/notificaciones/notification-list.tsx, entrada TIPO_CONFIG 'oferta_solicitud' que reutiliza un estilo existente (D5) y case en getNotificationHref → /solicitudes/<request_id> con esUuid. Si D3, solo el texto de 'ventas' en apps/web/app/(marketplace)/configuracion/notificaciones/preferencias-form.tsx. En apps/web/lib/notificaciones/claves.ts, comentario que apunte a avisos.ts.
11. 10. Staging (nunca prod; assertNoProd): Vault de staging con service_role_key y send_push_url propios; desplegar send-push en staging sin FIREBASE (los fixtures no tienen fcm_token, así que responde 200 ignored con via/tipo); aplicar la migración con scripts/staging/reaplicar-migracion.mjs.
12. 11. Nuevo scripts/staging/e2e-avisos-push.mjs, con fixtures.mjs y usuarios sintéticos que se retiran al final. Cuenta las respuestas de net._http_response posteriores a t0 y los triggers de pg_trigger (casos en 'pruebas').
13. 12. Loop de revisión adversarial del CLAUDE.md sobre la migración y send-push; después type-check, lint y pnpm build 56/56.
14. 13. Pedro despliega send-push vNext en prod ANTES de la migración (acepta los dos formatos): `supabase functions deploy send-push --project-ref oxxdkwywprkfghhbnoto --no-verify-jwt`. Smoke: POST sin Authorization → 401.
15. 14. Pedro firma y aplica la migración en prod (Management API, porque db push está bloqueado). Justo después, smoke de solo lectura: pg_trigger sin push_on_appointment_pgnet ni push_on_sale_pgnet y con push_on_notification.
16. 15. Merge a master (la campana y el texto entran por Vercel). Prueba en dispositivo con 2 cuentas de prueba (iPhone 1.1 (6) y Android de la prueba cerrada): oferta → suena al comprador y abre /solicitudes/<id>; cita → una vez a cada uno; venta → una vez, abre el chat. Antes de 6 h, net._http_response con un 200 por notificación.
17. 16. Registrar el cierre en docs/PENDIENTES-2026-09-26.md, en AUDITORIA-push-2026-09-26.md §6 y en la página de Notion de la jornada.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/supabase/functions/send-push/index.ts
- C:/Users/pedro/Projects/startup-marketplace/supabase/functions/send-push/avisos.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/supabase/functions/send-push/avisos.test.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/supabase/migrations/20260927100000_push_unico_sobre_notifications.sql (nuevo, timestamp tentativo)
- C:/Users/pedro/Projects/startup-marketplace/docs/rollback/20260927100000_push_unico_sobre_notifications_rollback.sql (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/notificaciones/notification-list.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/configuracion/notificaciones/preferencias-form.tsx (solo texto, si D3)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/notificaciones/claves.ts (solo comentario)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-avisos-push.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/docs/AUDITORIA-push-2026-09-26.md
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md
- Referencia, no se editan: supabase/migrations/20260826090000_push_triggers_timeout_and_vault.sql (molde call_send_push_*), 20260826140000_appointments_slot_reuse_and_notify.sql (notify_appointment_created ya escribe la fila del comprador), 20260411000002_notification_triggers.sql (notify_sale_confirmation_created sin chat_id), 20260710000001_purchase_requests.sql (request_responses; la inserta el cliente desde components/solicitudes/offers-list.tsx:73)

## Pruebas

- Unitarias (node:test + jiti) en supabase/functions/send-push/avisos.test.ts: mapa tipo→url/grupo, null para tipos no mapeados (review_reminder, trust_upgrade, comunidad_*), respaldo si el id no es UUID, y los tipos del WHEN del .sql coinciden con las claves del mapa.
- e2e en staging, scripts/staging/e2e-avisos-push.mjs. Línea base antes de la migración: la cita da 1 respuesta via=appointments. Después: oferta → 1 fila y 1 respuesta via=notifications al comprador; oferta de alguien bloqueado → 0; borrar y reinsertar la oferta en menos de 24 h → 0 nuevas; cita → exactamente 2 (comprador y vendedor) y 0 via=appointments; confirmación de venta → exactamente 1, con chat_id en data; fila trust_upgrade → 0 llamadas; reenviar el mismo record → ignored 'already sent'; pg_trigger sin los 2 triggers pgnet.
- Smoke de solo lectura en prod tras aplicar: consulta a pg_trigger sobre appointments, sale_confirmations, notifications y request_responses; POST a send-push sin Authorization → 401.
- Dispositivo con 2 cuentas de prueba, app en segundo plano y cerrada: oferta, cita y venta suenan una sola vez y abren la ruta correcta; revisar net._http_response antes de 6 h (ignorar los 401 de notify_push, que son un pendiente aparte).
- Regresión: type-check, lint (0 errores), pnpm build 56/56 y scripts/staging/e2e-chat-venta.mjs sigue en verde (el push de chat no cambia).

## Riesgos

- Orden del despliegue. Si la migración va antes que send-push vNext, la v20 responde 400 a table=notifications y las citas se quedan sin push. Si se crea el trigger nuevo sin quitar los viejos, al vendedor le suena dos veces. Mitigación: primero send-push, que acepta los dos formatos, y después la migración en una sola transacción.
- Funciones redefinidas en Studio (ya pasó con notify_push): un CREATE OR REPLACE desde el repo borraría cambios de prod. Mitigación: PASO 0 y partir de pg_get_functiondef de prod.
- Venta: la fila 'sale_confirmation' no lleva chat_id. Sin añadirlo, el push pasa de abrir /chat/<id> a abrir /chat (regresión).
- Colisión de tipo: send-appointment-reminders escribe 'review_reminder', el mismo tipo que «Nueva reseña», y la campana espera recordatorio_cita_1d/1h. Por eso review_reminder NO entra al mapa en v1; hay que corregirlo cuando se hagan los recordatorios.
- Spam de ofertas: borrar y reinsertar una oferta evade el UNIQUE y volvería a avisar. Mitigación: ventana de 24 h por (solicitud, vendedor) dentro del trigger.
- Privacidad: el nombre y el título salen en la pantalla de bloqueo; la dirección nunca, y se respetan los bloqueos. Hace falta el OK de D4.
- Garantía de 'a lo sumo una vez': si FCM falla después del reclamo de push_sent, ese push se pierde (sigue en la campana). Es aceptable, pero queda documentado.
- Tres copias del catálogo de grupos y tipos (claves.ts, avisos.ts y el WHEN del SQL). La prueba cruzada con el .sql solo cubre el WHEN.
- Staging no tiene los triggers de push (igualar-con-prod.mjs no copia pg_net hacia prod). Sin Vault ni send-push propios en staging, la e2e no prueba nada.
- La entrega real puede fallar por causas ajenas a este cambio (aps-environment del .ipa, clave APNs G6K8JJCWA4). No confundir con un fallo de PT07.
- notify_push sigue produciendo 401 en cada venta hasta su DROP aparte. Hay que excluirlos al contar respuestas en net._http_response.

## Requiere antes

- Decisiones D1-D5 de Pedro y Javier (alcance, si entra sale_confirmation, grupo y texto del interruptor, textos en la pantalla de bloqueo, icono y etiqueta en la campana).
- send-push del repo (9f1ab8d) desplegada por Pedro y prueba en dispositivo de AUDITORIA §5 hecha, como línea base.
- Acceso de solo lectura a prod (token de la Management API en .env) para el PASO 0.
- Staging operativo (.staging/staging.json) con Vault configurable y permiso para desplegar send-push ahí.
- Firma de Pedro para DROP de push_on_appointment_pgnet y push_on_sale_pgnet, y autorización para aplicar la migración en prod.
- Pedro despliega send-push en prod (el clasificador bloquea ese despliegue a Claude).
- 2 cuentas de prueba (nunca reales), iPhone con TestFlight 1.1 (6) y Android de la prueba cerrada.

**Responsable:** Pedro+Javier deciden D1-D5 → Claude hace código, migración y staging → Pedro despliega send-push, firma los DROP y aplica en prod → Pedro/Javier prueban en dispositivo

**Estimación:** Claude: 6-8 h (PASO 0 1 h, código y pruebas unitarias 3 h, e2e en staging 2-3 h, revisión). Pedro: ~1 h (despliegue, firma, aplicar y smoke). Dispositivo: 30-45 min. Calendario: 1,5 días desde las decisiones; fecha propuesta 29-sep (día de iOS/push), después del despliegue pendiente de send-push.

**Ejecutable por Claude ahora:** no
