# Tasks — Comunidades hiperlocales

> Marcado `[x]` = **escrito y entregado en este change**. No significa aplicado en producción.
> La fase 4 (aplicación) y todo lo que va después siguen pendientes.

- [x] **0. PASO 0 — comprobaciones previas contra producción**
  - [x] Leer el DDL real de `profiles`, `user_blocks`, `reports`, `notifications` contra la base (no contra notas viejas)
  - [x] Confirmar los enums vivos: `report_target_type` = `listing, user, message, review` — **hoy una publicación de comunidad no se puede reportar**
  - [x] Confirmar `has_column_privilege('authenticated','public.profiles','is_hidden','SELECT')` (la especificación no depende de la respuesta, pero se comprueba para saber)
  - [x] Recuperar con `pg_get_functiondef` el cuerpo **vivo** de `auto_hide_on_threshold`, `handle_child_safety_report`, `moderate_set_content_hidden` y `delete_user_data` — `moderate_set_content_hidden` **no tiene archivo en el repo**, existe solo en la base
  - [x] `SELECT ... FROM pg_policies WHERE tablename LIKE 'communit%'` → 0 filas (nada creado desde el Dashboard que se OR-ee con lo nuevo)
  - [x] Confirmar PostGIS en el esquema `public` (3.3.7): `SET search_path TO 'public'` basta en los `SECURITY DEFINER`

- [x] **1. Migración base — `supabase/migrations/20260905200000_comunidades_base.sql`**
  - [x] Tabla `communities` con `centro geography(POINT, 4326)`, RLS habilitada y los CHECK: nombre 3–40, nombre de una sola línea (con `chr()`, sin bytes raros), descripción ≤300, contadores no negativos y **`communities_centro_en_rejilla`** (centro a 2 decimales, tolerancia `1e-9`)
  - [x] `nombre_norm` no puede quedar **cadena vacía**: un nombre sin una sola letra ni dígito latino (emojis, cirílico, chino) normalizaba a `''` y ocupaba la ranura del nombre vacío para toda la celda de ~1.1 km y para siempre. Se resuelve en el trigger, con el `md5` del nombre recortado, y **no** con un CHECK — con el trigger el invariante ya se cumple siempre y un CHECK solo añadiría un modo de fallo
  - [x] Columna `fundador_id` en `communities`, separada de `owner_id`: las tres cuotas de fundación cuelgan de ella, porque `owner_id` se traspasa y una cuota colgada de una columna traspasable no es una cuota
  - [x] `comunidad_normaliza` congela `fundador_id` contra el **re-apuntado** y deja pasar el **vaciado a NULL**. La distinción es todo el hallazgo: la acción referencial `ON DELETE SET NULL` es un `UPDATE` que pasa por ese mismo `BEFORE`, y un congelador a secas la revertía dejando la fila apuntando a un perfil borrado **sin que el motor se queje** (la comprobación referencial se salta cuando la clave no cambia)
  - [x] Sin backfill de `fundador_id`: las cinco tablas nacen en este archivo, así que no hay ni una fila anterior a la columna. El `update ... where fundador_id is null` que había se volvía a ejecutar en cada re-aplicación y, en una comunidad ya traspasada, escribía al **heredero** — o sea reinstalaba el hallazgo C-4 fila por fila
  - [x] Tabla `community_members` con PK **`(user_id, community_id)`** en ese orden, `role` NOT NULL con DEFAULT y CHECK, y `left_at` como borrado suave
  - [x] Tabla `community_posts` con `parent_post_id`, el `UNIQUE (id, community_id)` que es el destino de la FK, y la **FK compuesta** `(parent_post_id, community_id) → (id, community_id) ON DELETE CASCADE`
  - [x] Tabla `community_post_likes` con PK `(post_id, user_id)`, sin columna `id`
  - [x] Tabla `community_post_quota` — ledger **append-only** de las cuotas por ventana de 24 h. No es contenido: existe porque `community_posts` y `community_post_likes` se borran en duro y una cuota que cuenta filas vivas se resetea borrando lo que ya publicaste
  - [x] Las cinco con `enable row level security`, sin excepción
  - [x] Los 17 índices explícitos (el decimoctavo es la PK compuesta de likes, que hace de índice del LEFT JOIN y de la FK), ninguno con `CONCURRENTLY` — no corre dentro de una transacción: `idx_communities_centro` (GiST parcial), `idx_communities_owner`, `idx_communities_fundador`, `uq_communities_celda_nombre` (parcial por `archived_at`, **no** por `is_hidden`), `idx_community_members_vivas`, `idx_community_members_padron`, `idx_community_members_altas` (no parcial, a propósito), `idx_community_members_comunidad`, `idx_community_posts_muro` (el que es el producto), `idx_community_posts_hilo`, `idx_community_posts_padre`, `idx_community_posts_comunidad`, `idx_community_posts_autor`, `idx_community_post_likes_usuario`, `idx_community_post_quota_ventana`, `idx_community_post_quota_purga`, `idx_profiles_suspendidos`
  - [x] Los **tres** índices bajo claves foráneas que sí se recorren al borrar (`idx_community_posts_padre`, `idx_community_members_comunidad`, `idx_community_posts_comunidad`): sin ellos cada borrado de publicación o de comunidad era un `Seq Scan` de la tabla entera. El único índice sobre `parent_post_id` era parcial por `is_hidden` y por tanto inservible para la cascada, y `idx_community_posts_muro` es parcial por partida doble, así que tampoco sirve para `community_id = $1` a secas. La segunda revisión encontró que la regla estaba escrita tres veces y aplicada dos — y la que faltaba era la de la tabla grande
  - [x] `idx_community_post_quota_purga (created_at)`: el índice de la ventana lleva `user_id` de prefijo, así que la purga —que filtra **solo** por `created_at`— recorrería entera la tabla más escrita del producto en cada pasada, sin dar error y sin dejar señal (`pg_cron` reporta éxito sin leer la respuesta)
  - [x] Los 7 triggers que **no** mencionan el enum: `comunidad_normaliza`, `comunidad_cuenta_miembros`, `comunidad_releva_mando`, `publicacion_nace_limpia`, `publicacion_cuenta`, `publicacion_cuenta_likes`, `notificar_comentario_de_comunidad`
  - [x] `comunidad_traspasa_mando(uuid, uuid)` — **la única implementación del traspaso de mando**. La llaman los tres caminos (la rama SALIR de `alternar_membresia_comunidad`, el trigger `comunidad_releva_mando` y `delete_user_data`, en el archivo 3). Toma la llave `comunidad:mando:<id>` y elige al relevo con `FOR UPDATE`, así que no queda hueco entre elegir y coronar; y archiva **si y solo si** no queda ni un miembro vivo. No se concede a ningún rol
  - [x] La purga del ledger, programada **en la migración** y no en un comentario: `cron.schedule('purga_community_post_quota', '17 4 * * *', ...)` con retención de 48 h (el doble de la ventana de 24). Molde de `20260826190000_cron_expire_purchase_requests.sql`: es SQL directo, no un `net.http_post`, así que no le aplica la ceguera de `net._http_response`
  - [x] Los 6 helpers `SECURITY DEFINER`, ninguno con más de **un argumento**: `es_miembro_de_comunidad`, `mis_comunidades_ids`, `es_moderador_de_comunidad`, `autor_vetado_para_mi`, `puedo_ver_publicacion` y `hay_bloqueo_con` (este último no lo llama ninguna policy: es la regla del bloqueo bidireccional para los caminos de **escritura**, que la tenían escrita de tres formas distintas o no la tenían)
  - [x] `mis_comunidades_ids()` sin argumentos, para que la policy del muro resuelva la pertenencia en **un InitPlan por consulta** en vez de una llamada `SECURITY DEFINER` por fila. Con `es_miembro_de_comunidad(community_id)` dentro de la policy, un `GET /rest/v1/community_posts?select=id&limit=1` de cualquier cuenta ejecutaba la función una vez por fila de la tabla: el `LIMIT` se aplica **después** del filtro de RLS, y envolverla en `(select ...)` no arregla nada porque la subconsulta sería correlacionada
  - [x] `comunidades_limite(text)` con todos los topes en un solo sitio y `RAISE` ante clave desconocida (nunca un COALESCE, que convertiría una errata en "sin límite")
  - [x] Las 3 policies de SELECT (`TO authenticated`, `auth.uid()` **y** `has_role()` envueltos en `(select ...)` para que sean InitPlan y no una llamada por fila), y **cero** en `community_post_likes` y en `community_post_quota`
  - [x] `revoke all ... from public, anon, authenticated` en las cinco tablas, antes de cualquier grant — **y en la secuencia** `community_post_quota_id_seq`, que es un objeto con ACL propia que el `REVOKE` de la tabla no cubre y que el `ALTER DEFAULT PRIVILEGES` del esquema `public` sí concede: `last_value` es el número total de escrituras del producto y `UPDATE` habilita `setval()`
  - [x] Grants **por columna** en `communities` dejando fuera `centro`, `nombre_norm`, `celda`, `owner_id` y `fundador_id`; grants **de tabla** (solo SELECT) en `community_members` y `community_posts`; **nada** en `community_post_likes` ni en `community_post_quota`
  - [x] `revoke`/`grant execute` con la **firma completa de tipos** en helpers y RPC; triggers sin conceder a nadie; y dos funciones revocadas y **no concedidas**: `hay_bloqueo_con(uuid)`, porque no la llama ninguna policy ni el cliente, y `comunidad_traspasa_mando(uuid, uuid)`, que concedida dejaría a cualquiera destituir al mando de una comunidad ajena con una petición
  - [x] Las 13 RPC: `feed_comunidades_explorar`, `feed_muro_comunidad`, `comentarios_de_publicacion`, `mis_comunidades`, `descubrir_comunidades`, `centro_de_mi_comunidad`, `fundar_comunidad`, `alternar_membresia_comunidad`, `editar_descripcion_comunidad`, `archivar_comunidad`, `publicar_en_comunidad`, `eliminar_publicacion_comunidad`, `alternar_like_publicacion`
  - [x] La guardia de suspensión en las **cinco** superficies que publican algo, no en cuatro: fundar, publicar/comentar, reaccionar, entrar y **editar la descripción**. La descripción es texto libre que `descubrir_comunidades` sirve a cualquier cuenta a 5 km sin pertenencia, así que una cuenta suspendida conservaba un cartel de 300 caracteres visible para todo el barrio. Lleva además cuota propia (`descripciones_24h`), porque sin ella la RPC admitía reescritura en bucle
  - [x] `mis_comunidades` devuelve `soy_fundador` contra **`fundador_id`**, no contra `role = 'owner'`. Con el rol, quien hereda una comunidad ajena recibía la insignia de fundador y quien la fundó la perdía al traspasarla: las dos respuestas falsas a la vez, en la única salida al cliente de esa distinción
  - [x] En todas: columnas **calificadas con alias** (los nombres de `RETURNS TABLE` son variables y una referencia sin calificar aborta con `42702` en **ejecución**, no en despliegue), alias que no se solapan (`c`/`p`/`hijo`/`au`/`l`/`m`), cursor validado como par atómico, `LEAST/GREATEST` sobre el límite, y `au.trust_level::TEXT` con cast explícito
  - [x] `notify pgrst, 'reload schema'` al final
  - [x] Envuelto en `begin;`/`commit;`, ASCII puro, idempotente de punta a punta, `COMMENT ON` en tablas / columnas no obvias / funciones, y bloque VERIFY comentado que ejercita los ataques dentro de `BEGIN; SET LOCAL ROLE authenticated; ... ROLLBACK;`

- [x] **2. Migración del enum — `supabase/migrations/20260905210000_comunidades_report_target.sql`**
  - [x] `alter type public.report_target_type add value if not exists 'community_post';` y **nada más**
  - [x] Archivo y commit propios: el valor nuevo **no se puede usar** hasta que su transacción cierre, y es **irreversible** (en Postgres los valores de enum no se borran)
  - [x] Se añade **uno** y no dos: `'community'` (reportar la comunidad entera) queda fuera de v1 a propósito — se puede añadir después sin migrar datos, quitarlo nunca

- [x] **3. Migración de moderación — `supabase/migrations/20260905220000_comunidades_moderacion.sql`**
  - [x] `auto_hide_on_threshold` partiendo del **cuerpo vivo** de `pg_proc`, con la rama `community_post` (umbral de 3 reportes activos)
  - [x] `handle_child_safety_report` partiendo del cuerpo vivo, con la rama `community_post` en el bloque de auto-ocultado, conservando el límite de 3 por cuenta y el encolado a `critical_reports`
  - [x] `moderate_set_content_hidden` **versionada por primera vez en el repo** (hoy es un objeto fantasma) con su rama `community_post`, misma firma `(text, uuid, boolean)`
  - [x] `publicacion_cierra_sus_reportes` + trigger `AFTER DELETE` sobre `community_posts`: los reportes se marcan `resolved` con nota `[auto]`, **no se borran** (son evidencia de cumplimiento)
  - [x] Parche a `delete_user_data` **con el mismo número de argumentos** (cambiar la aridad crearía una sobrecarga y PostgREST devolvería `300`): traspaso de mando, archivado de las que quedan sin nadie, y borrado de likes, publicaciones, membresías y asientos del ledger de cuotas, cada uno con su entrada en `deleted_summary`
  - [x] El traspaso **delega en `public.comunidad_traspasa_mando`** y no lleva copia propia. La copia que llevaba divergió: promovía sin exigir `left_at IS NULL` y sin tomar la llave `comunidad:mando:<id>`, así que una salida concurrente podía dejar coronado a alguien que acababa de irse y la comunidad viva con **cero** filas `role = 'owner'` vivas. El bucle recorre las comunidades que esa persona manda **ordenadas por `community_id`**, porque cada vuelta toma una llave
  - [x] Ya no hace falta acotar el archivado con un `EXISTS` de pertenencia viva (hallazgo I-15): el cursor solo enumera comunidades donde esa persona es `owner` **vivo**, así que una membresía muerta de hace meses no puede arrastrar a la comunidad de otra gente. El filtro es el driver, no un cinturón
  - [x] Preflight y `DO $comprobacion$` comprueban que `comunidad_traspasa_mando(uuid, uuid)` existe y que el cuerpo de `delete_user_data` la **llama**: plpgsql no resuelve nombres de función al definir, así que sin esa línea una base con el archivo base viejo aceptaría la migración en verde y el fallo saldría dentro de un borrado de cuenta real
  - [x] `community_post_quota` entra con `DELETE` **explícito** aunque su FK sea `ON DELETE CASCADE`: la cascada la borra igual, pero `deleted_summary` es evidencia de cumplimiento y el ledger es un diario de actividad con marca de tiempo. Decidido a conciencia y escrito en el archivo, no heredado por inercia
  - [x] `communities.fundador_id` **no** lleva sentencia propia: es `ON DELETE SET NULL` y no se traspasa (quien fundó es un hecho histórico; el relevo hereda el mando, no la autoría). El riesgo que el archivo anotaba **era real y estaba materializado**: el congelador de `comunidad_normaliza` revertía la acción referencial y dejaba una referencia colgante silenciosa. Arreglado en `20260905200000` —se congela el re-apuntado, no el vaciado— y el C9 del VERIFY es la prueba
  - [x] Preflight ampliado: se comprueba también `to_regclass('public.community_post_quota')`, porque plpgsql no resuelve nombres de tabla al definir la función y el fallo saldría dentro de un borrado de cuenta real
  - [x] Los dos `DO $comprobacion$` ampliados con `public.community_posts` (y el de `delete_user_data`, también con `public.community_post_quota`), para que perder la rama nueva **no pase en verde**
  - [x] `notify pgrst, 'reload schema'` y bloque VERIFY propio, con las pruebas nuevas C9 (`fundador_id` acaba en NULL **y** toda comunidad tocada queda archivada o con exactamente un `owner` vivo) y C11 (una membresía muerta no archiva la comunidad de otra gente)
  - [x] La cabecera cuadra con lo que crea la base: **cinco tablas** de comunidades y **seis entradas** en `deleted_summary`, porque `communities` aporta dos (traspasadas y archivadas) y es la única que no se borra. Decía seis tablas, y el VERIFY del mismo archivo decía cinco claves

- [x] **3.5. PRIMERA vuelta adversarial — auditar el código contra la especificación**
  - [x] Auditoría de los tres archivos contra la especificación canónica: **35 hallazgos**, 4 críticos
  - [x] **C-1** — comentar se saltaba el bloqueo bidireccional que la policy sí aplica y que reaccionar sí comprobaba. Cerrado: comentar exige lo mismo que ver, y la regla vive en `hay_bloqueo_con`
  - [x] **C-2** — de una comunidad archivada u oculta no se podía salir, y esa plaza seguía gastando el tope de 20 membresías vivas. Cerrado: la disponibilidad se exige solo para entrar
  - [x] **C-3** — las cuotas de 24 h contaban filas que se borran, así que borrar devolvía cuota y el bombardeo de `notifications` por comentario era ilimitado. Cerrado con el ledger `community_post_quota`
  - [x] **C-4** — las tres cuotas de fundación colgaban de `owner_id`, que se traspasa. Cerrado con `fundador_id` inmutable
  - [x] Importantes que cambiaron la forma de la entrega: **I-8** (segunda llave de advisory lock, por comunidad), **I-9** (trigger `comunidad_releva_mando`), **I-11** (`owner_id` fuera del grant por columna), **I-13** (los dos índices que faltaban bajo claves foráneas), **I-14** (`hay_bloqueo_con`), **I-15** (el `left_at` del `EXISTS` de `delete_user_data`)
  - [x] Correcciones que eran de los documentos y no del SQL: **S-17** y **S-18** (dos criterios de éxito que citaban pruebas del VERIFY **inalcanzables**), **S-20** (la validación del cursor, que el texto decía primera y el código tenía después) y **S-21** (los tres inventarios de objetos, desfasados)

- [x] **3.6. SEGUNDA vuelta adversarial — auditar los parches, no solo el código**
  - [x] Se volvió a auditar la entrega **ya corregida**: **17 hallazgos**, de los cuales **12 los habían introducido los arreglos de la primera vuelta**. El patrón es uno solo: cada crítico se cerró **añadiendo maquinaria** (una columna con su congelador, un trigger de refuerzo, un cinturón por si un `UPDATE` no encuentra su fila, una tabla nueva), y la maquinaria trae modos de fallo que ninguna prueba cubre, porque las pruebas se escribieron contra el fallo viejo. Regla que queda: **antes de añadir un trigger, preguntar si basta con quitar una línea**
  - [x] **R-1 (crítico)** — el congelador de `fundador_id` revertía la acción referencial `ON DELETE SET NULL` y dejaba una referencia colgante a un perfil borrado, sin que el motor se quejara. Cerrado congelando solo el re-apuntado. El C9 del archivo 3 lo prueba, y con el código anterior habría salido en rojo el primer día
  - [x] **R-2** — el backfill de `fundador_id` se re-ejecutaba en cada re-aplicación y re-anclaba las cuotas al **heredero**. Cerrado quitándolo: las cinco tablas nacen en el mismo archivo, así que no había nada que backfillear
  - [x] **R-3** — `soy_fundador` seguía significando "mando". Cerrado devolviendo `(fundador_id = quien consulta)`
  - [x] **R-4** — vocabulario pre-C-4 en tres sitios, uno de ellos **mensaje de usuario** ("Solo quien fundó la comunidad puede archivarla", cuando la guardia es `owner` o admin). Corregidos los tres
  - [x] **R-5** — `comunidad_releva_mando`, el trigger nacido en I-9, repetía el bug que I-8 acababa de cerrar: promovía sin `left_at IS NULL` y sin la llave de mando
  - [x] **R-6** — el cinturón de I-8 archivaba una comunidad **viva de 200 personas** cuando el relevo desaparecía entre el `SELECT` y el `UPDATE`; y no hay RPC de desarchivar. La versión anterior al parche fallaba ruidosa: el parche cambió un error visible por una pérdida silenciosa
  - [x] **R-7** — la llave `comunidad:mando:<id>` solo servía contra sí misma, porque `delete_user_data` —el otro camino que traspasa— no la pedía
  - [x] R-5, R-6 y R-7 se cerraron **borrando las tres copias** y dejando una: `comunidad_traspasa_mando`, con la llave dentro y `FOR UPDATE` en la elección del relevo, que hace innecesarios los dos `IF NOT FOUND`
  - [x] **R-8** — el ledger de cuotas nacía **sin purga**: la retención vivía en un comentario que no ejecuta nadie. Cerrado con `cron.schedule` dentro de la migración
  - [x] **R-9** — y esa purga no tenía índice: filtra solo por `created_at` y el único índice llevaba `user_id` de prefijo. Cerrado con `idx_community_post_quota_purga`
  - [x] **R-10** — la **secuencia** de identidad del ledger nacía concedida, porque el `REVOKE` de la tabla no cubre un objeto con ACL propia. Cerrado con su `revoke all on sequence`
  - [x] **R-11** — la cota de 600 del fan-out dejó de ser un invariante cuando el tope de 20 pasó a contar solo plazas vivas: des-archivar una comunidad deja a sus miembros con 21. Decidido **aceptarlo y escribirlo** donde se lee (en `archivar_comunidad` y en los dos documentos): acotar el fan-out con un `LIMIT` haría que el muro ignorara comunidades del usuario en silencio, que es peor
  - [x] **R-12** — la cabecera del archivo 3 contaba **seis tablas de comunidades donde hay cinco**, y su propio VERIFY decía cinco claves donde hay seis. Misma especie que S-21, reabierta por el parche de C-3
  - [x] Y los **cinco que no eran regresiones**: el índice que faltaba bajo `community_posts.community_id`; la quinta superficie de escritura (`editar_descripcion_comunidad`) sin guardia de suspensión ni cuota; el traspaso de `delete_user_data` sin `left_at` ni llave; la policy del muro llamando `es_miembro_de_comunidad` una vez por fila (cerrado con `mis_comunidades_ids`); y `design.md` prometiendo que el centro crudo solo lo ve quien fundó

- [x] **4. Documentos OpenSpec**
  - [x] `openspec/changes/2026-09-05-comunidades/proposal.md`
  - [x] `openspec/changes/2026-09-05-comunidades/design.md` — incluida la sección "Hallazgos de la revisión adversarial", con sus **dos** vueltas: los 35 hallazgos de la primera y las 12 regresiones que la segunda encontró en los propios parches
  - [x] `openspec/changes/2026-09-05-comunidades/tasks.md`

---

- [ ] **5. Aplicación en producción** — `supabase db push` está bloqueado (ledger desincronizado); va por la Management API
  - [ ] Aplicar `20260905200000_comunidades_base.sql` completo
  - [ ] Correr su VERIFY entero: privilegios (`has_*_privilege`, nunca leyendo la ACL), policies (rol **real**, no el nombre), los ataques de la sección C, la deriva de contadores y los `EXPLAIN`
  - [ ] Tener listas **dos** cuentas de prueba antes de empezar, no una: el índice único `(celda, nombre_norm)` solo se puede ejercitar con dos fundadores distintos, porque con uno solo la cuota de 24 h dispara antes y la prueba nunca llega al índice que dice probar
  - [ ] Ejercitar los ataques nuevos de la revisión: publicar 10 → borrar las 10 → la 11.ª sigue dando `23514`; fundar → soltar el mando → fundar da `23514`; comentar la publicación de quien te bloqueó da `P0002`; salir de una comunidad archivada **funciona** y entrar sigue dando `P0002`
  - [ ] Aplicar `20260905210000_comunidades_report_target.sql` **en su propia transacción** y confirmar que commiteó antes de seguir
  - [ ] Aplicar `20260905220000_comunidades_moderacion.sql` y correr su VERIFY (las cuatro funciones conocen `community_posts`; `handle_child_safety_report` **no** menciona `public.communities`; en C9 `fundador_id` acaba en **NULL**, que es la prueba de que el congelador de `comunidad_normaliza` no revierte la acción referencial, **y** toda comunidad tocada queda archivada o con exactamente un `owner` vivo)
  - [ ] Comprobar las tres aserciones que salieron de la segunda vuelta y que no cuestan nada: `SELECT count(*) FROM cron.job WHERE jobname = 'purga_community_post_quota'` → 1; `has_sequence_privilege('authenticated','public.community_post_quota_id_seq','SELECT')` → false; y la de referencias colgantes, `SELECT count(*) FROM communities c WHERE c.fundador_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM profiles p WHERE p.id = c.fundador_id)` → 0, que hay que poder correr **siempre**, no solo hoy
  - [ ] `NOTIFY pgrst, 'reload schema'` — sin esto PostgREST sigue sirviendo el esquema viejo y los grants nuevos no existen para la API
  - [ ] `node scripts/gen-types.mjs` y commitear el `database.types.ts` regenerado junto a las migraciones
  - [ ] Confirmar en el codegen que los argumentos con `DEFAULT` salen con `?` y que **no hay ninguna sobrecarga**

- [ ] **6. Espejos de TypeScript** — un reporte de tipo `community_post` es **invisible** hasta que se toquen los cinco, y **ninguno lo detecta el build**
  - [ ] `packages/shared/src/validators/moderation.ts` — `REPORT_TARGET_TYPES`
  - [ ] `packages/shared/src/validators/moderation.ts` — `REPORT_REASONS_BY_TARGET` (`report-modal.tsx` hace `REPORT_REASONS_BY_TARGET[targetType]` **sin guardia**: si falta la clave es `undefined.map`)
  - [ ] `packages/shared/src/validators/moderation.ts` — `REPORT_TARGET_LABELS`
  - [ ] `apps/web/app/admin/moderation/actions.ts` — `MODERATION_TARGET`
  - [ ] `apps/web/app/api/reports/route.ts` — rama de `checkSelfReport` (sin ella cae en el `return "ok"` final y se acepta cualquier uuid inventado: basura en `reports` **más un correo por Resend por cada uno**)
  - [ ] `packages/shared/src/validators/community.ts` **y su alta en el barril** `src/index.ts` — un archivo que no está en el barril no existe para la app. Los límites que se declaren ahí son **cosméticos**: los de verdad están en la base

- [ ] **7. Panel de admin** — hoy `apps/web/app/admin/moderation/page.tsx` cuenta con un objeto de **cuatro claves fijas**, así que un `target_type` nuevo no se cuenta en ningún lado y el reporte se vuelve invisible en silencio
  - [ ] Card nueva de `community_post` en el resumen
  - [ ] Subpágina `/admin/moderation/comunidades` con `ReportRowActions`
  - [ ] Botón "Restaurar", análogo a `unhideListing`
  - [ ] Probar el ciclo completo: reportar → 3 reportes → auto-ocultado → ocultar/restaurar a mano desde el panel

- [ ] **8. Frontend** — **bloqueado por las preguntas de la sección 10.** Nada de esto se empieza antes de contestarlas
  - [ ] Decidir la navegación (rutas reales vs `?feed=`) y, si son rutas, `apps/web/app/(marketplace)/comunidades/page.tsx` + `loading.tsx` y `comunidades/[id]/page.tsx` + `loading.tsx` — los `loading.tsx` son **obligatorios**: la latencia de navegación del 5-sep se debió a **cero** `loading.tsx` en toda la app
  - [ ] `home-tabs.tsx`: `overflow-x-auto` o etiqueta más corta (a 375 px, "Comunidades" desborda)
  - [ ] Las tres sub-pestañas: Explorar, Tus comunidades, Otras comunidades
  - [ ] Muro por **Server Component** (patrón A, el de "Para ti"), **no** por isla cliente con `useEffect` (patrón B, el de "Solicitudes"): ese es el defecto que hizo salir tarde "Cerca de ti"
  - [ ] Tarjeta de publicación única para Explorar y para el muro (las dos RPC devuelven la misma forma de fila a propósito)
  - [ ] Hoja de comentarios, ascendente, con su cursor propio
  - [ ] Botón "+" de fundar, con el aviso de que el nombre es inmutable
  - [ ] Toggle de membresía y de like reconciliando contra el estado autoritativo que devuelven las RPC, no contra el optimista
  - [ ] Confirmación de borrado que **advierte de la cascada** sobre comentarios ajenos
  - [ ] Estados vacíos de las tres sub-pestañas, incluido el arranque en frío del descubrimiento
  - [ ] Estado sin ubicación: enlazar a `change-location-sheet.tsx`, que ya existe
  - [ ] Deep link de la notificación: `/comunidades/<id>?post=<uuid>`
  - [ ] `pnpm build` local antes de cada push (`check-rutas.mjs` rompe el build ante un `href` a ruta inexistente)

- [ ] **9. Verificación de cierre**
  - [ ] `pnpm type-check` y `pnpm build` en verde
  - [ ] CODEX Adversarial Review Loop sobre lo escrito
  - [ ] Smoke por **contenido**, no por código de estado: `curl -s https://vicinomarket.com/comunidades | grep -c "No hay comunidades cerca de ti"` → 0, y lo mismo con `"Algo salio mal"`
  - [ ] Volver a correr las tres consultas de deriva de contadores con datos reales
  - [ ] Volver a medir el `EXPLAIN` de `feed_comunidades_explorar` con datos reales y afirmar la cota `600`

- [ ] **10. Preguntas abiertas de UX — BLOQUEANTES de la fase 8**
  - [ ] ¿Las cuatro pestañas del home pasan a rutas reales o "Comunidades" se queda como `?feed=`? (`check-rutas.mjs` corre dentro de `pnpm build`)
  - [ ] ¿`overflow-x-auto` en `home-tabs.tsx` o una etiqueta más corta que "Comunidades"?
  - [ ] ¿Qué se pinta en "Otras comunidades" el primer día, cuando no hay ninguna a 5 km de nadie? ¿Se invita a fundar, y con qué copy?
  - [ ] ¿Las tres sub-pestañas son tabs anidados o un selector distinto?
  - [ ] Copy exacto de la confirmación de borrado (tiene que advertir de la cascada sobre comentarios ajenos)
  - [ ] ¿La tarjeta de descubrimiento muestra "Fundada por X"?
  - [ ] ¿El centro crudo **se hereda con el mando** o se queda con quien fundó? Hoy `centro_de_mi_comunidad` autoriza por `role = 'owner'`, así que quien hereda el mando —relevo automático y no consentido— ve el punto que otra persona eligió desde su propia ubicación. Es la única salida de coordenadas crudas del diseño, así que es una decisión de privacidad. Si la respuesta es "no se hereda", el cambio es una línea: `and c.fundador_id = (select auth.uid())`
  - [ ] Cuando la cuota de 1 fundación cada 24 h muerde, ¿botón deshabilitado con explicación o fallo con toast?
  - [ ] Tocar una comunidad ajena, ¿pantalla-puerta de "Únete" o muro bloqueado?
  - [ ] ¿El deep link de la notificación abre el hilo directamente?
  - [ ] Sin push (fase 2), ¿basta el badge de notificaciones para que un comentario se entere?

- [ ] **11. Migraciones aparte, que esta entrega destapa pero NO incluye**
  - [ ] **R-01** — pasar las policies de `profiles`, `reviews`, `products_services` y `messages` a `NOT public.autor_vetado_para_mi(...)`. Hoy, si A bloquea a B, **B sigue viendo a A**: el `NOT EXISTS` bidireccional escrito dentro de una policy solo ve la mitad en la que yo bloqueo. Comprobarlo primero con `SET LOCAL ROLE authenticated` y el `sub` del **bloqueado**
  - [ ] **R-04** — `feed_nearby_requests` devuelve la distancia **al metro** con `(CEIL(ST_Distance(...)))::INT`: la pestaña Solicitudes es hoy un trilaterador de domicilios de compradores. El arreglo es una línea
  - [ ] **R-05** — la suspensión (`profiles.is_hidden`) sigue sin impedir publicar en `products_services` y `purchase_requests`. Comunidades lo cierra solo para sí misma
  - [x] ~~**Purga del ledger de cuotas**~~ — ya **no** es una migración aparte. La segunda revisión encontró que "va en el cron de mantenimiento" era prosa que no ejecuta nadie: ninguna migración del repo programaba ese trabajo. El `cron.schedule('purga_community_post_quota', ...)` y el índice que ese `DELETE` necesita entran en `20260905200000`, y el VERIFY falla si el job no está

- [ ] **12. Fase 2 — fuera de alcance, con el camino ya escrito**
  - [ ] Imágenes en publicaciones (`media_assets` con `owner_type = 'community_post'`, bucket **privado propio**; `product-media` no sirve: su policy de DELETE deja a cualquier autenticado borrar cualquier objeto)
  - [ ] Push por comentario
  - [ ] `nombrar_moderador_comunidad` (aditivo: la columna `role` ya existe, no hay backfill)
  - [ ] Badge de no leídos (`ultima_visita_at` en `community_members`)
  - [ ] Reportar la comunidad entera — y con ella la decisión explícita de que **una comunidad no se auto-oculta por umbral**: apagar el barrio de 500 personas por tres denuncias es un arma
