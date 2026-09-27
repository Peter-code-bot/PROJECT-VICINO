# Plan PT09-deriva-permisos-rest

**Pendiente:** PT09: deriva de permisos repo↔prod y sondeo de acceso REST/RPC directo

**Fuentes en Notion:** A l.22 (PT09-staging-deriva-permisos); C l.441 (PT09-rest-rpc-directo)

**Estado conciliado (26-sep ~23:30):** parcial. 9dfc4ba deja un staging fiel, pero el repo concede 34 permisos de tabla y 369 de columna más que prod, que los revocó a mano: reconstruir solo desde el repo los abriría. Existe scripts/audit-policies-vs-grants.mjs.

**Qué falta:** Plan: generar desde prod, en solo lectura, una migración con los REVOKE que prod ya tiene; aplicarla en un staging creado solo con replicar-esquema, sin igualar, y comprobar que el diff de permisos frente a prod es 0; en prod sería un no-op y se registra con el OK de Pedro. Sondear en staging con anon, authenticated, bloqueado y suspendido los límites nulos o excesivos de las RPC del catálogo y los accesos directos.

## Objetivo

Que reconstruir la base solo desde el repo dé exactamente los permisos de producción. Para eso hace falta una migración generada desde prod, que en un staging limpio deje la diferencia en 0 y que en prod no cambie nada. Después, sondear en ese staging el acceso REST/RPC directo (anon, autenticado, bloqueado y suspendido): límites nulos o excesivos, privacidad, escrituras directas y uso de service_role.

## Pasos

1. 1. Precondición: avisar a Pedro de que se va a recrear vicino-staging (fautpkprtlspugbqhnfy). Tiene costo micro por hora y se pierde el estado actual, que es sintético. Nadie debe estar corriendo e2e contra él mientras tanto. Comprobar en prod, en solo lectura, que el ledger tiene 177 versiones, las mismas que supabase/migrations.
2. 2. Nuevo scripts/staging/permisos-acl.mjs, con funciones puras sin red. SQL de ACL crudas por aclexplode: pg_class.relacl (relkind r, v, m, p, f y S en public), pg_attribute.attacl, pg_proc.proacl (public y vicino_guard) y pg_namespace.nspacl. Grantee: anon, authenticated y PUBLIC (oid 0), incluido el grantor. Otra consulta de privilegios EFECTIVOS con has_table_privilege, has_column_privilege y has_function_privilege, que es el criterio de aprobado. No usar information_schema.column_privileges: ahí cada GRANT de tabla sale repetido en todas sus columnas, y de ahí vienen los 369.
3. 3. En ese módulo, generarSql(diff, prod) emite en este orden. (a) REVOKE de tabla que solo existe en el repo, seguido INMEDIATAMENTE de un GRANT por columna con TODAS las columnas que prod tiene para esa tabla, rol y privilegio: un REVOKE de tabla borra también los GRANT por columna, y sin esto se repite la saga de profiles con el error 42501. (b) REVOKE por columna de lo que solo existe en el repo. (c) REVOKE EXECUTE de funciones, incluido el de PUBLIC. (d) Secuencias. (e) Lo que solo tiene prod sale aparte, comentado y marcado para revisión. No debería haber nada.
4. 4. Nuevo scripts/test-permisos-acl.ts (apps/web/node_modules/.bin/jiti scripts/test-permisos-acl.ts). Casos: REVOKE de tabla con el re-GRANT exacto de las columnas de prod; REVOKE solo de columna; EXECUTE de PUBLIC; grantor distinto marcado como residuo; conjuntos iguales que producen un SQL vacío; comillas y mayúsculas en los identificadores; y que nunca aparezcan service_role ni postgres como grantee.
5. 5. Nuevo scripts/staging/diff-permisos.mjs, que en prod solo usa prodRead. Sin argumentos compara el staging con prod (efectivos y crudos) y sale con 1 si hay diferencia. --generar <archivo> escribe la migración. --snapshot prod guarda el JSON en .staging/ para comparar antes y después.
6. 6. Arreglar scripts/staging/borrar.mjs para que borre también .staging/aplicadas.json. Hoy solo quita staging.json, y en un proyecto nuevo replicar-esquema se saltaría las 177 migraciones creyéndolas aplicadas.
7. 7. Recrear el staging: borrar.mjs --si, crear.mjs y replicar-esquema.mjs --hasta 20260926100000, SIN igualar-con-prod. Comprobar 0 filas en cron.job cuyo comando contenga oxxdkwywprkfghhbnoto. Correr diff-permisos.mjs y anotar la línea base: tabla, columna, EXECUTE y secuencias. Las cifras de 34 y 369 son de antes de S04 y pueden haber cambiado.
8. 8. diff-permisos.mjs --generar supabase/migrations/<AAAAMMDDhhmmss>_permisos_del_repo_iguales_a_prod.sql, con fecha posterior a 20260926100000. Revisarla a mano: cada REVOKE de tabla lleva su re-GRANT por columna, no hay GRANT solo de prod y no se toca service_role. Añadir la cabecera explicativa y una sección VERIFY con el estilo de las migraciones del repo.
9. 9. replicar-esquema.mjs aplica la migración nueva. diff-permisos.mjs debe dar 0 efectivos y 0 crudos; el residuo de grantor se documenta. Para simular prod, volver a aplicarla con reaplicar-migracion.mjs <version>, usando un deshacer vacío guardado en el scratchpad, y confirmar que sigue en 0. Ese es el no-op que tendrá en prod.
10. 10. Extender scripts/staging/igualar-con-prod.mjs con una sección 7 para el EXECUTE de funciones (proacl de anon, authenticated y PUBLIC). Hoy copia 10 funciones que solo existen en prod y nacen con los privilegios por defecto (EXECUTE a PUBLIC, anon y authenticated), lo que falsearía el sondeo. Luego correr igualar-con-prod.mjs --aplicar --forzar. --forzar es seguro aquí porque la única versión que falta en el ledger de prod es la de permisos, que equivale a prod. Debe informar 0 en permisos de tabla y de columna, y diff-permisos.mjs debe seguir en 0.
11. 11. Regresión funcional en ese staging: probar-s04.mjs 35/35, e2e-chat-venta.mjs 9/9 y e2e-campus-home.mjs 11/11. Los fixtures deben terminar con 0 restantes.
12. 12. scripts/staging/fixtures.mjs: añadir a crearProducto un parámetro opcional de ubicación (lat/lng) para tener un producto a unos 60 km. Sin él no se puede probar el tope de radio.
13. 13. Nuevo scripts/staging/sondeo-rest-rpc.mjs, con el patrón de probar-s04 (caso/esperar, sale con 1 si algo falla, limpiar llega a 0). Actores: anon, A autenticado, V vendedor, B bloqueado por V y S suspendido (profiles.is_hidden). Productos de V: disponible, pausado, eliminado, oculto y lejano; más uno de S. (Casos en el paso 14.)
14. 14. Casos del sondeo, primera parte. RPC: search_nearby_products_v4 con result_limit null da como máximo 150, con 100000 como máximo 300 y con 0 o -5 como máximo 1; con radius 1e9 no sale el producto lejano; con sin_limite más término, como máximo 500; un cursor basura da 4xx y no 5xx. feed_nearby_requests con null o valores enormes, como máximo 100. count_nearby_vendors con radio enorme, tope de 50 km. get_ranking_hiperlocal con p_limit 1000 da un error controlado. descubrir_comunidades, feed_muro_comunidad, comentarios_de_publicacion y solicitudes_de_comunidad aplican su tope con null. Las funciones de comunidad llamadas por anon devuelven 401 o 42501.
15. 15. Casos del sondeo, segunda parte. REST directo: GET products_services con limit=100000 da como máximo 1000 (max_rows); select=ubicacion_geo da 42501 a anon y a autenticado; las columnas sensibles de profiles, derivadas de los privilegios efectivos de prod y no escritas a mano, no se pueden leer; seller_verification solo devuelve la fila propia. B no ve a V ni por RPC ni por tabla. Los productos de S no salen para anon, y S recibe 42501 al insertar productos o iniciar un trato. Escrituras de anon y PATCH o DELETE de A sobre filas ajenas (products_services, profiles, user_roles, sale_confirmations, messages): comprobar después con una lectura como postgres que no cambió nada, para detectar el 204 silencioso.
16. 16. Matriz de EXECUTE: listar desde el staging, ya igualado, las funciones de public ejecutables por anon y compararlas con las de prod. Entregar la lista a Pedro para revisarla.
17. 17. Revisión estática del bypass con service_role en apps/web: lib/supabase/admin.ts, lib/university-data.ts, app/(marketplace)/actions.ts, app/(marketplace)/chat/actions.ts, app/(marketplace)/[categoria]/[slug]/page.tsx, app/actions/verify-document.ts, app/admin/verifications/page.tsx, app/api/products/[id]/location-map/route.ts y lib/rate-limit.ts. En cada uno: solo corre en servidor, autentica a quien llama antes de usar el cliente admin y devuelve solo lo necesario (en c337ef7, solo ids).
18. 18. Cualquier caso que falle en los pasos 14 a 16 se trata como hallazgo de seguridad activo, que puede adelantar PT09. Se corrige con una migración nueva validada en staging, que en prod solo se aplica con el OK de Pedro. No se mezcla con la de permisos.
19. 19. Registro en prod, solo con el OK explícito de Pedro. Ejecutar diff-permisos.mjs --generar de nuevo en solo lectura y confirmar que el SQL no cambió. Luego: diff-permisos.mjs --snapshot prod (antes); node scripts/apply-migration.mjs <archivo> --dry-run; Pedro autoriza node scripts/apply-migration.mjs <archivo>, que aplica y registra en una sola transacción; snapshot después, con 0 diferencias en efectivos; ledger con 178 versiones.
20. 20. Smoke de prod en solo lectura: node scripts/audit-policies-vs-grants.mjs (sin fallos de clase A) y node scripts/smoke-produccion.mjs. Actualizar la sección PT09 de docs/PENDIENTES-2026-09-26.md con las cifras de la línea base, el diff en 0, el resultado del sondeo y la lista de EXECUTE de anon. Commits convencionales separados: herramientas, migración y sondeo. Borrar el staging al terminar si Pedro no quiere conservarlo.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/permisos-acl.mjs (nuevo, puro)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/diff-permisos.mjs (nuevo, CLI; prod solo por prodRead)
- C:/Users/pedro/Projects/startup-marketplace/scripts/test-permisos-acl.ts (nuevo, unitaria con jiti)
- C:/Users/pedro/Projects/startup-marketplace/supabase/migrations/<AAAAMMDDhhmmss>_permisos_del_repo_iguales_a_prod.sql (nuevo, generado desde prod)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/igualar-con-prod.mjs (añadir sección de EXECUTE de funciones)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/borrar.mjs (borrar también .staging/aplicadas.json)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/fixtures.mjs (ubicación opcional en crearProducto)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/sondeo-rest-rpc.mjs (nuevo, e2e de seguridad contra staging)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md (sección PT09 con evidencia)
- Solo lectura o uso: scripts/staging/lib.mjs, scripts/staging/crear.mjs, scripts/staging/replicar-esquema.mjs, scripts/staging/reaplicar-migracion.mjs, scripts/staging/probar-s04.mjs, scripts/staging/e2e-chat-venta.mjs, scripts/staging/e2e-campus-home.mjs, scripts/apply-migration.mjs, scripts/audit-policies-vs-grants.mjs, scripts/smoke-produccion.mjs
- Revisión estática de service_role (sin cambios salvo hallazgo): apps/web/lib/supabase/admin.ts, apps/web/lib/university-data.ts, apps/web/app/(marketplace)/actions.ts, apps/web/app/(marketplace)/chat/actions.ts, apps/web/app/(marketplace)/[categoria]/[slug]/page.tsx, apps/web/app/actions/verify-document.ts, apps/web/app/admin/verifications/page.tsx, apps/web/app/api/products/[id]/location-map/route.ts, apps/web/lib/rate-limit.ts

## Pruebas

- Unitaria: apps/web/node_modules/.bin/jiti scripts/test-permisos-acl.ts. Orden de las sentencias generadas, re-GRANT de columnas tras un REVOKE de tabla, EXECUTE de PUBLIC, grantor distinto e idempotencia (conjuntos iguales dan SQL vacío).
- Staging recién replicado sin igualar: diff-permisos.mjs con diferencia distinta de 0 (línea base registrada).
- Staging con la migración nueva: diff-permisos.mjs con 0 efectivos y 0 crudos, y exit 0.
- No-op en prod simulado: reaplicar la migración con reaplicar-migracion.mjs sobre un staging que ya coincide con prod y confirmar que diff-permisos sigue en 0.
- igualar-con-prod.mjs --aplicar --forzar informa 0 en permisos de tabla, de columna y de EXECUTE; diff-permisos sigue en 0.
- Regresión en staging: probar-s04.mjs 35/35, e2e-chat-venta.mjs 9/9, e2e-campus-home.mjs 11/11 y fixtures con 0 restantes.
- E2E de seguridad en staging: sondeo-rest-rpc.mjs con todos los casos en OK (límites de RPC, max_rows, ubicacion_geo en 42501, columnas de profiles, seller_verification, bloqueo, suspensión, escrituras sin efecto verificadas como postgres, matriz de EXECUTE igual a prod) y limpiar() en 0.
- Prod, solo lectura, antes y después del registro: diff-permisos.mjs --snapshot prod sin cambios en efectivos; apply-migration.mjs --dry-run correcto; audit-policies-vs-grants.mjs sin clase A; smoke-produccion.mjs en verde; ledger con 178 versiones.

## Riesgos

- Un REVOKE a nivel de tabla borra también los GRANT por columna, y en prod eso rompería profiles con 42501. Mitigación: el generador vuelve a conceder todas las columnas que tiene prod justo después, con prueba unitaria, y la migración se aplica en una sola transacción.
- Un REVOKE por columna no tiene efecto si existe un privilegio de tabla, y no da ningún aviso. Mitigación: se usan ACL crudas y no information_schema, y el criterio de aprobado son los privilegios efectivos (has_*_privilege).
- Si el grantor es distinto (supabase_admin en vez de postgres), el REVOKE ejecutado por postgres no hace nada en silencio. Mitigación: la diferencia de efectivos en 0 es la prueba, y cualquier residuo se lista.
- Los privilegios por defecto de Supabase vuelven a dar ALL o EXECUTE a anon y authenticated en cada tabla o función nueva, así que la deriva reaparecerá. La migración solo corrige el historial; las migraciones nuevas deben llevar su REVOKE explícito.
- Hoy borrar.mjs no elimina .staging/aplicadas.json: en un proyecto nuevo, replicar-esquema no aplicaría nada. Se arregla en el paso 6.
- igualar-con-prod copia funciones que solo existen en prod sin su ACL, y la matriz de EXECUTE del staging saldría falsa. Se arregla en el paso 10.
- Queda fuera de alcance otra deriva entre repo y prod: 10 funciones que solo existen en prod, 20 con otra versión y policies. Reconstruir solo desde el repo seguiría sin igualar prod en esos puntos; conviene abrir una tarea aparte.
- Si prod cambia a mano entre la generación y el registro, la migración queda vieja. Mitigación: regenerar y comparar justo antes de aplicar, con una captura de antes y después.
- El sondeo puede destapar un hueco real. Se trata como hallazgo activo que adelanta PT09 y necesita una migración nueva con el OK de Pedro.
- Recrear el staging dispara crons. replicar-esquema los desprograma, pero hay que comprobar que queden 0 apuntando a prod (el 26-sep ya hubo dos 401).
- La Management API devuelve 429: la replicación puede tardar. lib.mjs ya reintenta con retroceso.

## Requiere antes

- Visto bueno o aviso a Pedro para recrear vicino-staging: tiene costo micro por hora, se pierde el estado actual (sintético) y nadie debe estar corriendo e2e contra él.
- Token de la Management API en .env (ya responde desde esta máquina; nunca se imprime).
- Confirmar en prod, en solo lectura, que el ledger tiene 177 versiones, las mismas que el repo, antes de fechar la migración nueva.
- OK explícito de Pedro para aplicar y registrar la migración en prod con scripts/apply-migration.mjs. Es un no-op probado en staging, pero escribe en el ledger de prod.
- No hace falta dispositivo ni decisión de diseño: no toca apariencia.

**Responsable:** Claude (herramientas, staging, migración generada, sondeo y documentación); Pedro (visto bueno para recrear vicino-staging y OK explícito para aplicar y registrar la migración en el ledger de prod)

**Estimación:** 8-10 h de Claude en dos sesiones. A) Permisos: 4-5 h, incluida aproximadamente 1 h de espera por crear el proyecto y replicar 177 migraciones con el límite de la Management API. B) Sondeo REST/RPC y revisión de service_role: 3-4 h. Más unos 15 min de Pedro para el registro en prod, y el costo micro por hora del staging mientras exista.

**Ejecutable por Claude ahora:** sí
