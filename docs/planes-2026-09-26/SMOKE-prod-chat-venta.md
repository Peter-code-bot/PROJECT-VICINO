# Plan SMOKE-prod-chat-venta

**Pendiente:** Smoke de chat y venta en producción con cuentas de prueba dedicadas (cierre de los P0 de chat y confirmar venta)

**Fuentes en Notion:** A l.19 (PT03-smoke-chat-venta); B l.182-189 (PT03-S04-staging, smoke); C l.477-481 (TM-habilitar-publicacion-S04); D l.646 (R02-chat-sincronizacion-p0), l.648 (R04, smoke), l.954,967,1001 (S04-validacion-staging-dos-sesiones); E l.1181 (D01-S04-06-staging, punto 1); F l.1418-1434 (S04A-chat-sincronizacion), l.1464-1482 (S04B-selector-producto-venta); G l.1693-1706 (G-P0-chat-sync, G-P0-confirmar-venta-selector); H l.17 (H17), l.19 (H19)

**Estado conciliado (26-sep ~23:30):** pendiente. Solo hay evidencia en staging (35/35 y 9/9). En prod solo se comprobó HTTP (producto_revision 200; la RPC da 401 sin sesión). PENDIENTES PT03: '[ ] Probar en producción con una cuenta de prueba dedicada'.

**Qué falta:** Plan: Pedro autoriza o crea 2 cuentas dedicadas no reales y 1 publicación de prueba. Correr e2e-chat-venta.mjs en modo prod, con las cuentas por env, o a mano: mensaje en vivo, cambio de producto por ambos, iniciar y confirmar venta, cortar y recuperar la red, y comprobar que el aviso 'Sincronización pendiente' no queda pegado. Después retirar la venta (suma puntos y ventas) y ocultar las cuentas. Fecha propuesta: 28-sep.

## Objetivo

Cerrar en producción los P0 de chat ("Sincronización pendiente") y de confirmar venta con selector de producto. Se usan 2 cuentas de prueba dedicadas y los mismos 9 pasos que ya dieron 9/9 en staging. La venta de prueba se retira después: sin rastro en puntos, ventas ni rankings, y sin tocar a ningún usuario real.

## Pasos

1. Fase 0. Pedro autoriza en el chat la ventana del smoke (propuesta: 28-sep en hora de poco tráfico) y las escrituras en prod, limitadas a 2 cuentas smoke y sus 2 publicaciones. La limpieza se firma aparte (paso 13).
2. Fase 0. Pedro crea las 2 cuentas en Supabase Dashboard > Authentication > Add user, con Auto Confirm para que no salga correo: smoke-vendedor@smoke.vicino.test y smoke-comprador@smoke.vicino.test. Guarda las contraseñas solo en variables de entorno de usuario (VICINO_SMOKE_VENDEDOR_EMAIL/_PASSWORD y VICINO_SMOKE_COMPRADOR_EMAIL/_PASSWORD) con Read-Host -AsSecureString. Nunca en el chat ni en el repo.
3. Fase 0. Pedro entra con cada cuenta en vicinomarket.com y completa el onboarding: nombre 'Prueba Vendedor' o 'Prueba Comprador', ubicación Puebla. En la cuenta vendedor activa el modo vendedor casual; no pide datos personales.
4. Fase 1 (Claude, en una rama, sin tocar prod). Sacar los 9 pasos de scripts/staging/e2e-chat-venta.mjs a un módulo nuevo, scripts/staging/chat-venta-pasos.mjs: login, abrirChat, enviar y los pasos 1-9. Reciben BASE, las cuentas, chat, P2 y una función leer(). e2e-chat-venta.mjs sigue siendo el runner de staging con sus fixtures y su limpiar().
5. Fase 1. Crear scripts/smoke-chat-venta-prod.mjs. BASE fija en https://vicinomarket.com; sin el flag --confirmo-produccion sale con código 2 sin hacer nada. Cuentas y productos se leen del entorno (VICINO_SMOKE_P1/P2). No usa service key ni crearUsuario, crearProducto o limpiar. La evidencia se lee con prodRead de scripts/staging/lib.mjs, que corre dentro de BEGIN READ ONLY.
6. Fase 1. Barandales en scripts/smoke-guardas.mjs. El script aborta antes del login si algún correo no termina en @smoke.vicino.test, si P1 o P2 no son del vendedor smoke o no están 'disponible', si el chat tiene un participante que no es smoke o si ya hay una venta pending_confirmation. Prechequeo de solo lectura: pg_publication_tables de supabase_realtime incluye chats, messages y sale_confirmations.
7. Fase 1. El chat se crea con la RPC iniciar_conversacion (p_vendedor_id, p_producto_id=P1, p_intencion='contacto', p_clave=uuid). Va con el JWT del comprador, que sale de su login por GoTrue con la anon pública de prod; es la misma llamada que hace apps/web/lib/chat/iniciar-conversacion.ts.
8. Fase 1. Antes de correr, el script guarda una línea base de solo lectura: trust_points y total_sales de las 2 cuentas y ventas_count de P2. Después exige los deltas exactos: vendedor +10 puntos y +1 venta, comprador +3, P2 +1. También exige 1 sale_proposed, 1 sale_confirmed y la venta en 'completed' a $85. Como paso final el vendedor pausa P1 y P2 con su propia sesión (estatus='pausado', lo mismo que hace la app). Los ids de chat, venta y usuarios se guardan en .staging/e2e/smoke-prod-<fecha>.json, que ya está ignorado por git.
9. Fase 1. Regresión del refactor: con dev-contra-staging.mjs levantado, e2e-chat-venta.mjs tiene que seguir en 9/9 y dejar 0 fixtures. Luego commit en la rama y revisión. A master sin desplegar nada: son scripts y no cambian la app.
10. Fase 2 (28-sep, con Pedro presente). Comprobar que el despliegue de Vercel en prod corresponde al SHA de master. Pedro publica desde la cuenta vendedor '[PRUEBA INTERNA] Mesa' ($150) y '[PRUEBA INTERNA] Silla' ($90) justo antes de correr, con cualquier foto, y exporta los ids como VICINO_SMOKE_P1 y VICINO_SMOKE_P2.
11. Fase 2. Correr node scripts/smoke-chat-venta-prod.mjs --confirmo-produccion (unos 3-5 min). Criterio de cierre: 9/9 pasos, deltas exactos y 0 errores de página. Si falla un paso no se repite a ciegas: se guarda la captura, se lee el estado con db-query.mjs y se decide con Pedro.
12. Fase 2. Pase manual en iPhone, porque el P0 original se vio en iOS: TestFlight 1.1 (6), que carga la web remota, con el comprador, y el vendedor en un navegador de escritorio. Se prueba el mensaje en vivo, la app en segundo plano 30 s y de vuelta, y el modo avión 10 s y de vuelta. El aviso 'Sincronización pendiente' no debe quedarse pegado.
13. Fase 3. Claude redacta docs/smoke/limpieza-smoke-chat-venta-prod.sql con los ids del paso 8. Todo va en un solo BEGIN…COMMIT. Primero comprueba que todos los chats de las cuentas smoke son solo entre ellas; si no, RAISE y no borra nada. Después borra de notifications, messages, sale_confirmations, chats y products_services las filas de esas 2 cuentas. Devuelve trust_points y total_sales a la línea base y borra la fila de seller_rankings del vendedor smoke si existe. Pone profiles.is_hidden=true en las 2 cuentas; no se borran, porque PT07 las reusa. Cierra con un DO $verify$ que exige 0 filas restantes.
14. Fase 3. Pedro lee y firma el SQL. Se ejecuta antes de las 03:00 CDMX del día siguiente, porque el cron /api/cron/recompute-rankings corre a las 09:00 UTC. Verificación de solo lectura con scripts/db-query.mjs: 0 filas smoke en chats, messages, sale_confirmations, notifications y products_services, y las 2 cuentas con is_hidden=true. Después se corre node scripts/smoke-produccion.mjs y tiene que salir en verde.
15. Registro. Marcar [x] la línea de PT03 en docs/PENDIENTES-2026-09-26.md ('Probar en producción con una cuenta de prueba dedicada'). Se anota la fecha y la hora, el SHA del script, 9/9, los deltas, el resultado del iPhone y los ids truncados. En la página de la jornada en Notion va un bloque D01 con los mismos datos, con el permiso de Pedro.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-chat-venta.mjs (refactor: usa los pasos compartidos)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/chat-venta-pasos.mjs (nuevo: los 9 pasos compartidos)
- C:/Users/pedro/Projects/startup-marketplace/scripts/smoke-chat-venta-prod.mjs (nuevo: runner de producción)
- C:/Users/pedro/Projects/startup-marketplace/scripts/smoke-guardas.mjs (nuevo: barandales de las cuentas smoke) y su prueba node --test
- C:/Users/pedro/Projects/startup-marketplace/docs/smoke/limpieza-smoke-chat-venta-prod.sql (nuevo: limpieza que Pedro firma)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md (marcar PT03)
- Solo lectura, sin cambios: scripts/staging/lib.mjs (prodRead), scripts/db-query.mjs, scripts/smoke-produccion.mjs, apps/web/lib/chat/iniciar-conversacion.ts, apps/web/app/(marketplace)/chat/[id]/chat-window.tsx, chat-product-selector.tsx y sale-confirmation-form.tsx (selectores), supabase/migrations/20260925010000_chat_producto_y_venta_atomica.sql y 20260320000007_sale_confirmations.sql (efectos de la venta)

## Pruebas

- Unitaria (node --test) de scripts/smoke-guardas.mjs: acepta solo correos @smoke.vicino.test, rechaza un producto ajeno, no disponible o de un tercero, y rechaza un chat con un participante que no es smoke.
- En seco contra prod, sin escribir: sin --confirmo-produccion el script sale con código 2; con un correo que no es smoke aborta antes del login.
- Staging: node scripts/staging/dev-contra-staging.mjs y luego node scripts/staging/e2e-chat-venta.mjs siguen en 9/9 y dejan 'Fixtures restantes: 0' después de extraer chat-venta-pasos.mjs.
- Producción: node scripts/smoke-chat-venta-prod.mjs --confirmo-produccion da 9/9, cuadran los deltas (+10/+1 vendedor, +3 comprador, ventas_count +1), hay 1 sale_proposed y 1 sale_confirmed, la venta queda completed a $85 y no hay errores de página. Capturas en .staging/e2e/.
- Manual en iPhone con TestFlight 1.1 (6): mensaje en vivo, segundo plano 30 s y modo avión 10 s, sin que el aviso de sincronización quede pegado.
- Después de la limpieza, solo lectura con scripts/db-query.mjs: 0 filas de las cuentas smoke en chats, messages, sale_confirmations, notifications y products_services; los perfiles con is_hidden=true y sin fila en seller_rankings. node scripts/smoke-produccion.mjs en verde.

## Riesgos

- Las 2 publicaciones se ven en el feed público durante unos 10 min y un usuario real podría escribir al vendedor smoke. Mitigación: título '[PRUEBA INTERNA]', hora de poco tráfico, pausa automática al final, y la limpieza aborta si encuentra chats con terceros.
- La venta tiene efectos reales en prod. check_sale_completion suma +10 puntos y +1 total_sales al vendedor, +3 puntos al comprador y la cantidad a ventas_count; también se crean notificaciones. El cron de rankings de las 09:00 UTC contaría la venta de septiembre. Mitigación: limpiar antes de ese corte; la lectura de rankings ya filtra perfiles ocultos.
- No se debe probar la cancelación: el trigger on_sale_cancellation resta puntos (-5/-3) y descuadraría la línea base.
- Cada mensaje dispara notify_push hacia send-push, y la v20 no está desplegada. Las cuentas smoke no tienen tokens, así que no se entrega nada; quedan filas en net._http_response que se borran solas a las 6 h.
- Supabase podría rechazar el dominio .test al crear las cuentas. Alternativa: alias + de un buzón del equipo, nunca la cuenta de una persona real.
- El Chromium de Playwright no es el WKWebView de iOS: 9/9 en web no prueba el ciclo de vida en iPhone. Por eso el pase manual es obligatorio para cerrar el P0.
- El paso 7 (sin red) depende de la red real y tiene un timeout de 45 s. Un fallo intermitente se registra y se investiga, no se tapa repitiendo.
- Si Pedro no firma la limpieza, el mínimo no destructivo es pausar los productos y ocultar las cuentas; los contadores y la fila de ranking se quedarían.
- Si falla el mensaje en vivo en prod es una regresión del P0 que afecta a usuarios reales. Hay que decidir con Pedro entre corregir o usar la reversión de docs/rollback/20260925010000_chat_producto_y_venta_atomica_rollback.sql junto con el Instant Rollback de Vercel.

## Requiere antes

- Autorización explícita de Pedro en el chat para escribir en prod, limitada a las 2 cuentas smoke, y con la ventana horaria definida.
- Las 2 cuentas creadas por Pedro en el Dashboard con Auto Confirm, y sus contraseñas en variables de entorno de usuario, no en el chat.
- Onboarding completo en las 2 cuentas, modo vendedor casual en la del vendedor y 2 publicaciones '[PRUEBA INTERNA]' creadas justo antes de correr.
- Firma de Pedro sobre el SQL de limpieza, porque son DELETE en prod.
- El despliegue de Vercel en prod en el SHA de master, que ya trae el selector de producto y el arreglo de Realtime.
- Staging vivo (.staging/staging.json) para repetir la regresión del refactor.
- El iPhone con TestFlight 1.1 (6) para el pase manual.

**Responsable:** Pedro (autoriza, crea las cuentas, publica, firma la limpieza y hace el pase en iPhone); Claude (script, barandales, corrida y SQL de limpieza)

**Estimación:** Unas 4 h en total, de las que unas 1.5 h son de Pedro. Claude: script, refactor y regresión en staging, 2 h. Pedro: cuentas, onboarding y publicaciones, 40 min. Corrida en prod y pase en iPhone, 30 min. Limpieza (redactar, firmar, ejecutar y verificar), 40 min. Registro en el doc y en Notion, 15 min. Fecha propuesta: 28-sep; la Fase 1 puede adelantarse el 27-sep.

**Ejecutable por Claude ahora:** no
