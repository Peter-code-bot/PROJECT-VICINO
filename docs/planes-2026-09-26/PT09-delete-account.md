# Plan PT09-delete-account

**Pendiente:** PT09: desplegar la versión actual de delete-account (prod tiene la del 16-jul)

**Fuentes en Notion:** A l.22 (PT09-delete-account); B l.302-309 (PT09-completo-backend)

**Estado conciliado (26-sep ~23:30):** pendiente. En el repo los últimos cambios son c1da71a (26-ago) y bbc739b (fotos de reseña). config.toml no declara delete-account, así que verify_jwt es true por defecto. La llama /api/account/delete con Authorization. Es compromiso de Data Safety de Play.

**Qué falta:** Plan: (1) Claude la despliega en staging y borra una cuenta fixture (fotos de reseña, avatars y filas). (2) Leer el verify_jwt desplegado en prod y mantenerlo igual. (3) Pedro: supabase functions deploy delete-account --project-ref oxxdkwywprkfghhbnoto. Fecha: 28-sep.

## Objetivo

Poner en producción la versión del repo de supabase/functions/delete-account/index.ts, que incluye bbc739b y c1da71a del 26-ago. Hoy prod corre la del 16-jul, equivalente a 8c1d55e. La versión nueva barre review-media por {saleConfirmationId}/ antes de delete_user_data, deja rastro en storage_cleanup_pending de lo que no pudo borrar y limpia en recursivo. El verify_jwt debe quedar igual. Antes se prueba en staging con fixtures sintéticos y en prod solo hay smoke no destructivo. No se toca el código de la función ni /api/account/delete.

## Pasos

1. 1. Claude, prod en solo lectura: GET https://api.supabase.com/v1/projects/oxxdkwywprkfghhbnoto/functions/delete-account. Anotar version, updated_at (se espera 16-jul), verify_jwt y entrypoint_path.
2. 2. Claude, prod en solo lectura: respaldo para rollback con `supabase functions download delete-account --project-ref oxxdkwywprkfghhbnoto --workdir <scratchpad>/rollback-delete-account`. NUNCA dentro del repo, porque sobrescribiría supabase/functions/delete-account/index.ts. Compararlo con `git show 8c1d55e:supabase/functions/delete-account/index.ts` para confirmar que no trae carpetasDeResenas, anotarFallo ni la recursión.
3. 3. Claude, prod en solo lectura con prodRead de scripts/staging/lib.mjs (BEGIN READ ONLY). Confirmar lo que el código nuevo necesita: to_regclass('public.storage_cleanup_pending') no es nulo (migración 20260826280000); has_table_privilege('service_role','public.storage_cleanup_pending','INSERT') = true; existe delete_user_data(target_user_id uuid); sale_confirmations tiene buyer_id y seller_id. Además GET /v1/projects/oxxdkwywprkfghhbnoto/secrets, solo nombres, debe incluir SB_PUBLISHABLE_KEY y SB_SECRET_KEY.
4. 4. Claude, repo: en supabase/config.toml añadir el bloque `[functions.delete-account]` con `verify_jwt = <el valor leído en el paso 1>` y un comentario: la llama apps/web/app/api/account/delete/route.ts con el JWT del usuario, y sin esta entrada un deploy aplica el default del CLI. Va en commit aparte: `fix(functions): fijar verify_jwt de delete-account en config.toml`. Sin tocar index.ts.
5. 5. Claude, staging: comprobar que el proyecto está ACTIVE_HEALTHY y que .staging/aplicadas.json incluye 20260826280000 y 20260912230000. Si falta algo, correr scripts/staging/crear.mjs, luego replicar-esquema.mjs y luego igualar-con-prod.mjs.
6. 6. Claude, staging: cargar los secretos SB_PUBLISHABLE_KEY y SB_SECRET_KEY con POST /v1/projects/<ref-staging>/secrets desde node. Los valores salen de /api-keys?reveal=true del staging (tipo publishable/secret; si no existen, las legacy anon/service_role que ya guarda .staging/staging.json). Nunca en la línea de comandos ni en la salida; antes, assertNoProd.
7. 7. Claude, staging: `supabase functions deploy delete-account --project-ref <ref-staging>` desde la raíz del repo, para que tome el verify_jwt del paso 4. Si el clasificador lo bloquea, este comando lo corre Pedro.
8. 8. Claude, repo: escribir scripts/staging/e2e-delete-account.mjs, que importa lib.mjs y fixtures.mjs y usa solo @staging.vicino.test. Fixtures: A (la cuenta a borrar), B (contraparte) y C (control), creados con crearUsuario y completarOnboarding; un producto de A con crearProducto; por SQL, una venta A→B completed y otra B→C como control. Por Storage API con la service del staging se suben PNG de 1x1 a: avatars/A/, product-media/A/, verification-documents/A/, chat-media/A/chat1/ (prueba la recursión), chat-media/A/1/2/3/4/5/6/ (prueba el tope de profundidad), review-media/<venta A-B>/, y como controles avatars/B/ y review-media/<venta B-C>/.
9. 9. Claude: correr el script contra staging hasta que salgan todos los casos en verde. Informe en .staging/e2e/delete-account.json. Limpieza en finally: fixtures.limpiar(); borrar por Storage API los objetos que queden, porque storage.objects no se borra por SQL; y borrar por SQL las filas de storage_cleanup_pending de los former_user_id del fixture.
10. 10. Pedro, prod, con autorización explícita el 28-sep: en master con el commit del paso 4, desde la raíz del repo, `supabase functions deploy delete-account --project-ref oxxdkwywprkfghhbnoto`. Añadir `--no-verify-jwt` SOLO si el paso 1 dio verify_jwt=false.
11. 11. Claude, smoke de prod no destructivo: repetir el GET del paso 1 (version +1, updated_at del 28-sep, mismo verify_jwt) y hacer las peticiones negativas descritas en pruebas. Sin borrar ninguna cuenta en prod.
12. 12. Rollback si el smoke falla: Pedro corre `supabase functions deploy delete-account --project-ref oxxdkwywprkfghhbnoto --workdir <scratchpad>/rollback-delete-account` con el respaldo del paso 2.
13. 13. Claude: marcar PT09 en docs/PENDIENTES-2026-09-26.md (línea 244) y en la página de Notion de la jornada, anotando la versión y el verify_jwt. En el primer borrado real, leer en prod en solo lectura account_deletion_log y storage_cleanup_pending sin resolver para ese former_user_id.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/supabase/config.toml (añadir [functions.delete-account] verify_jwt = valor leído en prod)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-delete-account.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md (marcar PT09, línea 244)
- C:/Users/pedro/Projects/startup-marketplace/supabase/functions/delete-account/index.ts (solo se despliega, no se edita)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/api/account/delete/route.ts (solo lectura: quien la llama, Bearer del usuario + apikey anon)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/lib.mjs y fixtures.mjs (se reutilizan, sin cambios)

## Pruebas

- Staging, caso 1: POST /functions/v1/delete-account sin Authorization debe dar 401, y A sigue en auth.users.
- Staging, caso 2: POST con la anon del staging como Bearer debe dar 401 (Invalid session), y A sigue existiendo.
- Staging, caso 3: GET con el token de A debe dar 405, o 401 si el gateway corta antes. A sigue existiendo.
- Staging, caso 4: POST con el token de A y apikey anon debe dar 200 con success=true y user_id=A.
- Staging, caso 5, por SQL como postgres: A ya no está en auth.users ni en profiles; la venta A-B desapareció; account_deletion_log tiene 1 fila con deleted_user_id=A.
- Staging, caso 6: storage.objects queda con 0 objetos bajo A/ en product-media, verification-documents y avatars, y bajo A/chat1/ en chat-media, lo que prueba la recursión. También queda vacío review-media/<venta A-B>/, lo que prueba el arreglo de bbc739b.
- Staging, caso 7: storage_cleanup_pending tiene exactamente 1 fila con former_user_id=A y motivo 'demasiada profundidad' para chat-media/A/1/2/3/4/5/6/. Prueba que el rastro se escribe.
- Staging, caso 8, controles: B y C siguen existiendo, avatars/B/ intacto, review-media/<venta B-C>/ intacto, venta B-C intacta.
- Staging, caso 9: repetir el POST con el token viejo de A debe dar 401, nunca 500.
- Staging, opcional: el mismo borrado por la UI con dev-contra-staging.mjs en :3100, entrando en /configuracion y escribiendo ELIMINAR. Prueba la cadena route→función con la apikey anon.
- Unitarias con jiti: no aplican. La función es Deno con imports remotos y no se modifica. apps/web/scripts/qa-delete-account.mjs solo prueba la RPC, no la función, así que no basta.
- Prod, smoke no destructivo: el GET de metadatos muestra version nueva, fecha 28-sep y el verify_jwt sin cambiar. POST a https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/delete-account sin Authorization da 401; con la anon como Bearer da 401 (Invalid session). POST https://vicinomarket.com/api/account/delete con {confirmText:'ELIMINAR'} sin sesión da 401 (Sesión inválida). Los logs de la función no deben mostrar errores de arranque.

## Riesgos

- Cambio de verify_jwt: un deploy sin entrada en config.toml usa el default del CLI (true). Si prod estaba en false, se cambiaría el comportamiento. Lo mitigan los pasos 1 y 4.
- Gateway y JWT asimétricos: si en staging el gateway con verify_jwt=true rechaza tokens de usuario válidos (prod firma con ES256), el caso 4 lo delata. Entonces la decisión es de Pedro: verify_jwt=false es seguro porque la función ya valida con auth.getUser.
- `supabase functions download` escribe en supabase/functions/<slug> del directorio de trabajo: siempre con --workdir en el scratchpad o sobrescribe el index.ts del repo.
- Si falta storage_cleanup_pending en prod, el insert falla sin lanzar (supabase-js devuelve el error) y el rastro no se escribe. El paso 3 lo comprueba antes.
- Cambio de alcance: la versión nueva borra review-media/<venta> de TODAS las ventas donde A fue comprador o vendedor. Eso incluye fotos que subió la contraparte en reseñas que delete_user_data conserva anonimizadas (reviewed_id=NULL). Hoy la columna fotos no se pinta en ningún sitio, así que no hay impacto visible, pero conviene que Pedro lo confirme como comportamiento deseado.
- El clasificador de permisos puede bloquear también el deploy en staging, como bloqueó send-push en prod. En ese caso el paso 7 pasa a Pedro.
- Los secretos de staging solo por Management API desde node, nunca en la línea de comandos (PowerShell/PSReadLine los guarda en el historial).
- Los objetos de Storage de los fixtures no se pueden borrar por SQL: la limpieza del script tiene que usar la Storage API o quedan huérfanos en staging.
- En prod no hay prueba de borrado real (no se crean cuentas en prod). La prueba de verdad es el primer borrado de un usuario: vigilar account_deletion_log y storage_cleanup_pending.

## Requiere antes

- Autorización explícita de Pedro para el despliegue en prod del paso 10.
- Staging vivo (vicino-staging) con migraciones hasta 20260912230000 y .staging/staging.json vigente.
- SUPABASE_ACCESS_TOKEN (PAT) en .env con acceso a la org djjcnwqrqzpgndyktfcq, para Management API y CLI.
- Supabase CLI en la máquina de Pedro con sesión iniciada; comandos desde la raíz del repo.
- Resultado del paso 1 (verify_jwt en prod) antes de escribir config.toml y antes de cualquier deploy.

**Responsable:** Claude prepara, hace las lecturas de prod y la prueba en staging (pasos 1-9, 11 y 13); Pedro despliega en prod (paso 10) y, si hace falta, el rollback (paso 12).

**Estimación:** Claude: 3-4 h. Lecturas de prod y respaldo 20 min, config.toml 10 min, preparar staging y desplegar 30-45 min, script e2e 1.5-2 h, corridas y limpieza 30 min. Pedro: 15 min de despliegue más 15 min de smoke. Despliegue en prod: 28-sep.

**Ejecutable por Claude ahora:** sí
