# Plan PT10-fechas-siguiente-fase

**Pendiente:** PT10: fijar el 5-oct las fechas de implementación de S09/S10 y recordatorios

**Fuentes en Notion:** B l.350-357 (PT10-siguiente-fase-fechas)

**Estado conciliado (26-sep ~23:30):** decision. Es un hito de calendario sin pasos. El insumo es la auditoría push y los D02-S09/S10.

**Qué falta:** Decidir el 5-oct, después de cerrar D02-S09 y D02-S10. Para prepararlo sirve una estimación por bloque: recordatorios por servidor frente a Live Activities, y S09/S10.

## Objetivo

Llegar al lunes 5-oct a las 18:00 con un paquete de estimación por bloque: S09, S10, recordatorios por servidor, notificaciones locales, aviso fijo en Android y Live Activity. Con él, Pedro y Javier fijan en una sola reunión, para cada bloque, fecha de inicio y fin, o «no por ahora» con su criterio para retomarlo. La decisión queda anotada en la fila «PT10 · siguiente fase» del calendario de la jornada del 26-sep y en docs/PENDIENTES-2026-09-26.md §PT10. Este pendiente no implementa nada.

## Pasos

1. 1. Ahora (Claude, solo lectura): registrar como insumo dos defectos de los recordatorios que ya existen, porque cambian la estimación del bloque de recordatorios por servidor. (a) supabase/functions/send-appointment-reminders/index.ts toma appointment_date y appointment_start (DATE y TIME en hora local, sin zona) como si fueran UTC. La ventana de 1 día (l.35-42) compara fechas UTC y avisa «Cita mañana» la tarde de dos días antes. La de 1 h (l.58-71, setHours en UTC) avisa unas 7 h antes en CDMX. (b) Escribe tipo 'review_reminder' con data {} (l.51-52 y l.76-77), mientras apps/web/app/(marketplace)/notificaciones/notification-list.tsx ya espera 'recordatorio_cita_1d' y '_1h' con data.appointment_id (l.47, 56, 153-156); hoy, al tocarlo, abre /seller/reviews. citas/[id]/actions.ts:38 supone la misma zona horaria. Se abre como bug aparte, sin esperar al 5-oct.
2. 2. Ahora (Claude, solo lectura): medir en producción el uso de citas con SQL de solo lectura por la Management API: total, últimos 14 y 30 días, reparto por estado, y cuántos compradores y vendedores con cita tienen fcm_token. Anotar las cifras con fecha y hora. Son la base del criterio para retomar las notificaciones locales o la Live Activity. Hoy hay 1 cita en toda la base.
3. 3. Borrador de estimación del bloque R1a, recordatorios en su hora y con su enlace, solo en la campana. Archivos: send-appointment-reminders/index.ts, sacando la ventana a una función pura con America/Mexico_City y los tipos recordatorio_cita_1d/_1h más appointment_id. Estimación: 2-3 h con pruebas. El despliegue de la Edge Function lo autoriza Pedro. No toca la apariencia: la lista ya tiene esos tipos.
4. 4. Borrador del bloque R1b, push de los recordatorios. Depende de 4 cosas: send-push desplegada (Pedro); DROP de notify_push (firma de Pedro); un trigger único sobre notifications con un mapa tipo → prioridad/enlace/preferencia en supabase/functions/send-push/index.ts (hoy allowedTables está en l.112 y el payload fijo en l.260-293); y quitar push_on_appointment_pgnet y push_on_sale_pgnet al mismo tiempo (firma de Pedro). El aviso de 1 día, sin sonido, necesita un segundo canal en apps/web/hooks/usePushNotifications.ts:148 y apns-priority 5. Es web remota: no pide binario nuevo. Estimación: 1-1,5 días más la prueba en dispositivo.
5. 5. Borradores de los bloques nativos, que piden binario nuevo y revisión de tienda. R2, notificaciones locales con @capacitor/local-notifications: 2-3 días, con sincronización al cancelar o mover la cita. R3, aviso fijo en Android (ongoing o Live Updates): 2-3 días, solo Android. R4, Live Activity en iPhone: 4-6 días, más Mac, Xcode y revisión de Apple. Hoy no existe ningún target de ActivityKit ni de WidgetKit en apps/web/ios/App. Antes de estimar R4 hay que confirmar si FCM HTTP v1 acepta tokens de Live Activity o si hace falta APNs directo. Se propone que R2, R3 y R4 sigan en «no por ahora» mientras no se cumpla el umbral de uso del paso 2 (por ejemplo, 20 citas confirmadas en 14 días). El umbral lo deciden Pedro y Javier.
6. 6. 2-oct a las 18:00: tomar las estimaciones de S09 y S10 de D02-S09 y D02-S10 ya cerradas. Separar la parte técnica (Pedro/Claude) de la UI (Javier). Base conocida de S09: apps/web/lib/university-data.ts, seller_verification con document_type 'Credencial Universitaria' (RLS: cada quien solo ve su propia fila) y apps/web/app/(onboarding)/, que no tiene paso de estudiante. S10: no hay RPC por área visible; se partiría de count_nearby_vendors (20260826263000) y de la regla de 20260913140000 (ubicacion_geo no pública, redondeo a 3 decimales). La migración nueva la autoriza Pedro. Si D02 no está cerrado, el 5-oct se fija la fecha de definición del bloque, no la de implementación.
7. 7. 4-oct a las 20:00: armar una tabla de una página con estas columnas: bloque, depende de, estimación técnica, espera diseño de Javier (sí/no), pide binario nuevo (sí/no), pide firma de Pedro (sí/no) y fecha propuesta. Pegarla bajo la fila «PT10 · siguiente fase» de la jornada del 26-sep y en docs/PENDIENTES-2026-09-26.md §PT10. Avisar a Javier para que la revise antes de la reunión.
8. 8. 5-oct a las 18:00 (Pedro y Javier, 30-45 min): decidir por bloque fecha de inicio, fecha de fin y responsable, o «no por ahora» con su criterio para retomarlo. Las fechas de diseño las pone Javier. PT08, los bugs del release y la seguridad activa (PT09) van antes que cualquier bloque de PT10.
9. 9. Tras la reunión: añadir al calendario de Notion una fila por cada bloque aprobado y pasar «PT10 · siguiente fase» a «Decidido», conservando la fecha anterior en el historial. Actualizar docs/PENDIENTES-2026-09-26.md §PT10 y la memoria del proyecto.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/supabase/functions/send-appointment-reminders/index.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/notificaciones/notification-list.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/citas/[id]/actions.ts
- C:/Users/pedro/Projects/startup-marketplace/supabase/functions/send-push/index.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/hooks/usePushNotifications.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/university-data.ts
- C:/Users/pedro/Projects/startup-marketplace/supabase/migrations/20260826263000_contar_vendedores_cerca.sql
- C:/Users/pedro/Projects/startup-marketplace/supabase/migrations/20260913140000_ubicacion_geo_deja_de_ser_publica.sql
- C:/Users/pedro/Projects/startup-marketplace/docs/AUDITORIA-push-2026-09-26.md
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/fixtures.mjs
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/borrar.mjs

## Pruebas

- Evidencia del defecto horario (se escribe cuando se autorice R1a): prueba unitaria con jiti sobre la función pura de ventanas. Con una cita el día D a las 13:00 en CDMX, el aviso de 1 h solo entra con now entre 11:45 y 12:15 CDMX, y el de 1 día solo con now entre D-1 11:45 y D-1 14:15 CDMX. Contra el código actual (l.35-71) la prueba falla; así queda documentado el bug.
- e2e en staging para R1a: crear con scripts/staging/fixtures.mjs una cita sintética confirmada en now+60 min (hora local), invocar send-appointment-reminders de staging con el CRON_SECRET de staging y comprobar una fila en notifications con tipo recordatorio_cita_1h, data.appointment_id correcto y reminder_1h_sent=true. Limpiar con scripts/staging/borrar.mjs; quedan 0 fixtures.
- Smoke de solo lectura en producción: las consultas de uso de citas (paso 2) y SELECT tipo, count(*) FROM notifications WHERE titulo LIKE 'Cita%' GROUP BY tipo, que confirma el tipo 'review_reminder' en los recordatorios reales, si los hubo.
- Criterio de cierre de PT10: la fila «PT10 · siguiente fase» tiene, para cada bloque (S09, S10, R1a, R1b, R2, R3, R4), una fecha y un responsable, o «no por ahora» con un criterio medible; D02-S09 y D02-S10 enlazados; la tabla de estimación visible en Notion y en docs/PENDIENTES-2026-09-26.md.

## Riesgos

- Si D02-S09 o D02-S10 no están cerrados el 2-oct, sus fechas serían inventadas: en ese caso se fija solo la fecha de definición.
- El envío iOS (PT08, 2-oct) puede retrasarse y consumir a las mismas personas; PT10 cede siempre ante los bugs del release y la seguridad activa.
- Si se activa el push de recordatorios (R1b) sin arreglar antes la zona horaria (R1a), los teléfonos recibirían avisos a la hora equivocada. Hoy no se nota porque solo llegan a la campana y hay 1 cita.
- Si se pone el trigger único sobre notifications sin quitar push_on_appointment_pgnet y push_on_sale_pgnet, esos avisos llegan dos veces. Quitarlos requiere la firma de Pedro.
- R2, R3 y R4 piden binario nuevo y revisión de tienda: sus fechas dependen del ciclo de release, no solo del código.
- Con 1 cita en la base no hay métrica de uso: decidir hoy una Live Activity sería construir para nadie.
- Cualquier UI de S09 o S10 que se estime sin el diseño de Javier invade el rediseño que le está reservado. La estimación técnica debe separar backend y contrato de la parte visual.

## Requiere antes

- D02-S09 y D02-S10 cerrados el 2-oct a las 18:00 (Pedro, con la definición de producto de Javier).
- send-push desplegada y la prueba de PT07 en dispositivo hecha (Pedro); sin eso, la estimación de R1b no es fiable.
- Acceso de lectura a producción (token de la Management API en el .env) para medir el uso de citas.
- Disponibilidad de Javier para poner las fechas de diseño de S09 y S10 y revisar la tabla antes del 5-oct.
- Solo si se considera R4: Mac con Xcode y confirmar el soporte de tokens de Live Activity en FCM.

**Responsable:** Pedro + Javier deciden. Claude prepara en solo lectura el inventario y los borradores de estimación (pasos 1-5 y 7).

**Estimación:** 3-4 h en total, entre el 2 y el 5 de octubre: 1,5-2 h de inventario y borradores (Claude, en solo lectura), 30 min para montar la tabla, 30-45 min de reunión y 15 min de registro. Las estimaciones de los bloques (R1a 2-3 h; R1b 1-1,5 días; R2 y R3 2-3 días cada uno; R4 4-6 días más revisión de Apple; S09 5-8 h o más; S10 45-60 min de alcance más 4-8 h) son borradores para la decisión; no son compromisos.

**Ejecutable por Claude ahora:** no
