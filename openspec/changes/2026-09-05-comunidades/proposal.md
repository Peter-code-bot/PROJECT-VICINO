# Proposal — Comunidades hiperlocales

## Why

VICINO es un marketplace de proximidad, pero hoy la proximidad solo sirve para transaccionar: el feed acerca productos, las Solicitudes acercan necesidades, y ahí se acaba. No existe ningún sitio donde la gente de un barrio hable entre sí sin estar comprando o vendiendo algo. Un vecino que quiere avisar de un apagón, preguntar por un plomero de confianza o convocar una junta de la privada no tiene dónde hacerlo, y termina en un grupo de WhatsApp que nadie modera y del que no se puede salir sin quedar mal.

Las Comunidades son esa capa que falta: grupos de barrio con centro geográfico, muro de texto, comentarios y reacciones. Es también lo que sostiene la retención entre transacciones — alguien entra a VICINO tres veces al mes a comprar, pero entra diario si su cuadra está adentro.

Hay una segunda razón, menos vistosa y más importante: **construir esto obliga a cerrar tres agujeros que ya están abiertos en producción y que esta funcionalidad heredaría enteros si se copiara el molde existente sin mirarlo.**

1. **El bloqueo bidireccional está roto.** `user_blocks` tiene una sola policy (`USING (auth.uid() = blocker_id)`), así que el `NOT EXISTS` bidireccional que las policies de `profiles`, `reviews`, `products_services` y `messages` escriben *dentro de la policy* solo ve la mitad en la que yo bloqueo: la dirección contraria se filtra por RLS y el `NOT EXISTS` devuelve `true` por falta de **permiso**, no por falta de bloqueo. Si A bloquea a B, B sigue viendo a A.
2. **Los reportes se quedan huérfanos.** `reports.target_id` no tiene clave foránea (el polimorfismo es a propósito), así que al borrar contenido sus reportes se quedan `pending` para siempre apuntando a nada, y el panel los pinta como "no encontrado".
3. **Suspender a alguien no le impide publicar.** `profiles.is_hidden = TRUE` solo lo esconde de los feeds; ninguna policy de INSERT del proyecto mira esa columna.

Comunidades no hereda ninguno de los tres: usa helpers `SECURITY DEFINER` para el bloqueo desde el día uno (`autor_vetado_para_mi` en las policies y en los feeds, `hay_bloqueo_con` en las escrituras), cierra sus reportes con un trigger que cubre también las cascadas, y comprueba la suspensión explícitamente en las **cinco** RPC que publican algo: fundar, publicar (que es la misma RPC que comentar), reaccionar, **entrar** a una comunidad y **editar la descripción**. Salir no la comprueba a propósito: una cuenta suspendida deja de entrar a comunidades nuevas, no se queda encerrada en las que ya tiene. Este párrafo ha tenido que corregirse **dos veces**, y las dos por el mismo motivo: prometía superficies que el SQL no cubría. La primera revisión encontró que reaccionar y unirse pasaban de largo; la segunda, que `editar_descripcion_comunidad` es una quinta superficie de escritura pública —300 caracteres visibles para todo el barrio a 5 km, en `descubrir_comunidades`— y tampoco la miraba. Las dos están cerradas, y la edición de descripción lleva además su propia cuota de 24 h.

Y una razón de proceso: la lección de `purchase_requests` es que **lo que no entra en la migración de la tabla no entra nunca**. Esa tabla lleva desde el 10 de julio siendo contenido de usuario con texto libre e imagen, sin `is_hidden`, sin ser reportable y sin aparecer en ningún panel de moderación. Aquí el ciclo de moderación completo entra en la misma entrega que las tablas, no después.

## What

Una sección "Comunidades" con tres sub-pestañas:

- **Explorar** — muro unificado con lo más reciente de todas mis comunidades. No lleva argumentos geográficos: el filtro es la pertenencia, no la distancia, así que funciona igual sin permiso de ubicación.
- **Tus comunidades** — directorio de las mías, ordenado por actividad.
- **Otras comunidades** — descubrimiento a 5 km. Enseña nombre, descripción, miembros, actividad y distancia. **Cero contenido**: leer el muro exige pertenencia.

Más un botón "+" para fundar una comunidad (nombre + centro tomado de la ubicación actual), publicaciones de solo texto, comentarios de profundidad 1 y reacciones.

El backend entero: **cinco tablas** (`communities`, `community_members`, `community_posts`, `community_post_likes` y `community_post_quota`, el ledger append-only que sostiene las cuotas por ventana), dieciocho índices (diecisiete explícitos más la PK compuesta de likes, que hace de índice del LEFT JOIN y de la FK), tres policies de SELECT, veintinueve funciones nuevas (seis helpers `SECURITY DEFINER`, `comunidades_limite()`, `comunidad_traspasa_mando()`, trece RPC y ocho funciones de trigger), un job de `pg_cron` que purga el ledger, cuatro funciones existentes modificadas y un valor nuevo e irreversible en `report_target_type`.

Reparto en tres archivos, en este orden:

| # | Archivo | Contenido |
|---|---|---|
| 1 | `supabase/migrations/20260905200000_comunidades_base.sql` | Las 5 tablas con sus CHECK, los 17 índices explícitos, los 6 helpers `SECURITY DEFINER`, `comunidades_limite`, `comunidad_traspasa_mando` (la única implementación del traspaso de mando), las 3 policies, los grants (por columna en `communities`, de tabla en `community_members` y `community_posts`, **ninguno** en `community_post_likes` ni en `community_post_quota` —ni en su secuencia de identidad, que es un objeto con ACL propia—), la purga programada del ledger, los 7 triggers que **no** mencionan el enum, y las 13 RPC. |
| 2 | `supabase/migrations/20260905210000_comunidades_report_target.sql` | **Solo** `alter type public.report_target_type add value if not exists 'community_post';` |
| 3 | `supabase/migrations/20260905220000_comunidades_moderacion.sql` | Las cuatro funciones de moderación con su rama nueva, `publicacion_cierra_sus_reportes` + su trigger, el parche a `delete_user_data`, y los dos `DO $comprobacion$` ampliados. |

El enum va **solo, en su propio archivo y con su propio commit** porque un valor de enum recién añadido no se puede *usar* hasta que su transacción cierre: meterlo en el archivo 1 produce un error que parece de sintaxis y no lo es. Y porque es **irreversible** — en Postgres los valores de enum no se pueden borrar — así que merece ser suyo.

## Scope

### IN (este change)

- **Migración 1 — base.** Las cinco tablas con RLS habilitada, `centro geography(POINT, 4326)` con el `CHECK communities_centro_en_rejilla`, `fundador_id` separada de `owner_id` y congelada contra cualquier re-apuntado (pero **no** contra el vaciado que escribe `ON DELETE SET NULL`), la FK compuesta que impide que un comentario viva en otra comunidad que su publicación madre, los diecisiete índices explícitos (incluido `idx_community_posts_muro`, que es el producto), los seis helpers `SECURITY DEFINER`, `comunidades_limite()`, `comunidad_traspasa_mando()`, las tres policies de SELECT, los `REVOKE ... FROM PUBLIC, anon, authenticated` —tablas, funciones **y la secuencia del ledger**— y los grants declarados a mano, la purga del ledger programada en `pg_cron`, los siete triggers de derivadas, contadores, relevo de mando y avisos, y las trece RPC.
- **Migración 2 — el enum.** `report_target_type += 'community_post'`, sola.
- **Migración 3 — moderación.** `auto_hide_on_threshold` y `handle_child_safety_report` con su rama de `community_posts`; `moderate_set_content_hidden` **versionada por primera vez** en el repo (hoy es un objeto fantasma que solo existe en la base y en `database.types.ts`) con su rama nueva; `publicacion_cierra_sus_reportes` y su trigger; el bloque de comunidades dentro de `delete_user_data` (traspaso de mando **delegado en `comunidad_traspasa_mando`**, likes, publicaciones, membresías y asientos del ledger) sin cambiar la aridad; y la ampliación de los dos bloques `DO $comprobacion$` que hoy pasarían en verde si alguien se comiera la rama nueva.
- Los tres archivos idempotentes de punta a punta, envueltos en `begin;`/`commit;`, en ASCII puro, con prosa en español explicando el porqué, `COMMENT ON` en tablas, columnas no obvias y funciones, y bloque VERIFY comentado al final que **ejercita los ataques** dentro de `BEGIN; SET LOCAL ROLE authenticated; ... ROLLBACK;`.
- Estos tres documentos de OpenSpec.

### OUT (no es este change)

**Todo el frontend, y es la exclusión que más conviene decir en voz alta.** No es que falte tiempo: es que **hay preguntas de producto sin responder** que cambian el código que se escribiría, y escribirlo antes de contestarlas garantiza tirarlo. Las tres que más pesan:

1. Las otras tres pestañas del home (`Para ti`, `Siguiendo`, `Solicitudes`) **no son rutas**: son un query param sobre `/` (`/?feed=following`). O las cuatro pasan a rutas reales con su `loading.tsx`, o "Comunidades" se queda como un `?feed=` más y se acepta el desnivel. Es una decisión de arquitectura de navegación, no un detalle: `scripts/check-rutas.mjs` corre dentro de `pnpm build` y **rompe el build** ante cualquier `href` a una ruta inexistente.
2. `home-tabs.tsx` pinta tres etiquetas a `text-[19px]` en un `flex gap-4` **sin scroll**. "Comunidades" son once caracteres y desborda a 375 px. Hace falta decidir entre `overflow-x-auto` y una etiqueta más corta, y eso toca un componente compartido con las tres pestañas que ya existen.
3. El arranque en frío. El primer día no hay ni una comunidad a 5 km de nadie, así que "Otras comunidades" nace vacía para todo el mundo. Qué se pinta ahí, y con qué copy, es una decisión de producto que define la pantalla entera.

La lista completa de preguntas abiertas está en `tasks.md`, marcadas como bloqueantes de esa fase.

Tampoco entran:

- **Los cinco espejos de TypeScript** (`REPORT_TARGET_TYPES`, `REPORT_REASONS_BY_TARGET`, `REPORT_TARGET_LABELS`, `MODERATION_TARGET`, la rama de `checkSelfReport`) ni la card del panel de admin. Son código de `apps/web` y `packages/shared`, van con el frontend. Quedan anotados como **bloqueantes para lanzar**: sin ellos un reporte de tipo `community_post` entra en la tabla y no lo cuenta nadie.
- **Imágenes en las publicaciones.** v1 es solo texto. El camino de extensión está escrito (`media_assets` con `owner_type = 'community_post'`, bucket privado propio, las cuatro policies), y cuesta un `DROP`+`ADD` del CHECK más la reescritura de cuatro cadenas de OR con el peor modo de fallo posible: si se añade el valor al CHECK y no a las policies, el insert muere con `42501` y el CHECK no dice nada.
- **Push por comentario.** La fila en `notifications` sí; el push no. Los triggers de push cuelgan de las tablas de negocio, no de `notifications`, así que sería un trigger nuevo con su Vault y su ceguera de `net._http_response`.
- **Nombrar moderadores.** La columna `role` va desde el día uno precisamente para que esto sea aditivo después, sin backfill ni reescritura de policies. La RPC no entra.
- **Badge de no leídos por comunidad**, **reportar la comunidad entera** (`ALTER TYPE ... ADD VALUE 'community'`), y **borrar una comunidad** (solo se archiva).
- **El arreglo de R-01** — pasar las cuatro policies de `profiles`, `reviews`, `products_services` y `messages` a `NOT public.autor_vetado_para_mi(...)`. El helper se crea aquí, pero cambiar esas cuatro policies es **su propia migración** y no se cuela en esta.
- **El arreglo de R-04** — `feed_nearby_requests` sigue devolviendo la distancia al metro con `(CEIL(ST_Distance(...)))::INT`, o sea que la pestaña Solicitudes es hoy un trilaterador de domicilios de compradores. Esta especificación no lo copia, pero arreglar la función original es una línea y merece su propia migración.
- **Chats de grupo y GPS continuo.** Excluidos por producto, se respeta al pie de la letra. La membresía **no caduca por mudanza**: sin GPS continuo nadie puede ser expulsado por moverse, así que el directorio se ordena por actividad y lo de la ciudad vieja se hunde solo.

## Stakeholders

| Rol | Persona | Responsabilidad |
|---|---|---|
| Founder / backend | Pedro | Aprueba la especificación, aplica los tres archivos por la Management API (en orden, con commit separado el del enum), corre el VERIFY y regenera `database.types.ts` |
| Producto | Pedro | Contesta las preguntas abiertas de UX que bloquean la fase de frontend (navegación, copy del estado vacío, etiqueta de la pestaña) |
| Diseño / frontend | Alejandro (rama `design`) | Las pantallas, una vez desbloqueadas las preguntas de arriba |
| Moderación | Panel de admin (`/admin/moderation`) | Recibe el tipo nuevo `community_post`; hoy cuenta con un objeto de **cuatro claves fijas** y hay que ampliarlo o el reporte se vuelve invisible en silencio |

## Success criteria (medibles)

Todos se comprueban con el bloque VERIFY de las migraciones, no con una impresión. Los que ejercitan permisos van dentro de `BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '...'; ... ROLLBACK;` — con `set_config` a secas el editor SQL corre como `postgres`, bypasea RLS y **el test miente en verde**.

1. **`anon` a cero.** `has_table_privilege('anon', t, 'SELECT')` es `false` en las cinco tablas, y `has_function_privilege('anon', ...)` es `false` en las trece RPC, en los seis helpers y en `comunidades_limite(text)`. Y para `authenticated` también es `false` en `public.hay_bloqueo_con(uuid)` y en `public.comunidad_traspasa_mando(uuid, uuid)`: a esas dos no las llama ninguna policy ni el cliente, así que se revocan y no se conceden.
2. **Ni el centro ni el mando salen.** `has_column_privilege('authenticated','public.communities','centro','SELECT')` es `false`, igual que `celda`, `nombre_norm`, `owner_id` y `fundador_id`. Y las tres formas mueren con `42501`: `SELECT centro`, `WHERE centro IS NOT NULL` y `ORDER BY centro` — Postgres exige privilegio de columna también en el WHERE y en el ORDER BY. Las dos columnas de mando entraron aquí tras la revisión: con `owner_id` concedido, un `?select=owner_id,nombre` devuelve el mapa fundador → barrio de toda la base, sin radio y paginable.
3. **El muro está cerrado.** Un no-miembro autenticado devuelve `0` en `SELECT count(*) FROM public.community_posts` por REST, y `feed_muro_comunidad('<comunidad>')` le lanza `42501` con mensaje legible.
4. **Nadie escribe por REST.** `has_table_privilege('authenticated', t, 'INSERT'|'UPDATE'|'DELETE'|'TRUNCATE')` es `false` en las cinco tablas, y los INSERT/UPDATE directos del VERIFY mueren con `42501`.
5. **Ni los likes ni el ledger de cuotas son legibles.** `has_table_privilege('authenticated', t, 'SELECT')` es `false` en `community_post_likes` y en `community_post_quota`, y `pg_policies` devuelve **cero filas** para las dos.
6. **Las cuotas muerden a la segunda llamada.** La segunda `fundar_comunidad` de la misma cuenta da `23514` (una cada 24 h). El índice único por celda se ejercita aparte y **con dos cuentas distintas**, porque con una sola la cuota de 24 h dispara antes y la prueba no llega nunca al índice que dice probar: `'Barrio de prueba'` desde la cuenta A y `'BARRIO DE PRUEBA'` en la misma celda desde la cuenta B da `23505`. Es además el caso real — la cuota de separación de 1 km solo restringe al mismo fundador.
7. **El padrón no es enumerable.** Un miembro raso que cuenta `community_members` de su comunidad ve `1` fila, no el padrón.
8. **El plan no degrada.** `EXPLAIN (ANALYZE, BUFFERS, VERBOSE)` de `feed_comunidades_explorar(NULL, NULL, 30)` muestra `Index Only Scan using idx_community_members_vivas` como driver e `Index Only Scan using idx_community_posts_muro` dentro del nested loop, con `Heap Fetches` bajo, y **ni un `Seq Scan` ni un `Bitmap Heap Scan`** sobre `community_posts`. La cota del fan-out afirmada: `membresias_vivas × pagina_muro = 600`. Es una cota **nominal**, no un invariante duro, y la segunda revisión obligó a decirlo: como el tope de 20 cuenta solo plazas en comunidades vivas, des-archivar una comunidad —acción manual de admin— deja a sus miembros con 21 membresías vivas y este criterio puede salir en rojo sin que nadie haya hecho nada malo. La respuesta correcta a ese rojo es mirar quién se pasó, no relajar la aserción; acotar el fan-out con un `LIMIT` sobre las membresías haría que el muro **ignorara comunidades del usuario en silencio**, que es peor.
9. **El descubrimiento no miente ni se ensancha.** `SELECT DISTINCT distancia_m % 500` devuelve una sola fila con `0`, `max(distancia_m) <= 5500`, y `EXPLAIN` muestra `Index Scan using idx_communities_centro` con `Index Cond: (centro && _st_expand($punto, 5100))`, nunca un `Seq Scan`. Los dos números son distintos y los dos son correctos: el radio de búsqueda son 5100 m (5 km más el colchón de 100 m del snap de entrada), y el cubo de 500 m **redondea hacia arriba**, así que 5100 se reporta como 5500. Este criterio decía `<= 5100` y era inalcanzable: afirmaba una cota que la aritmética del propio cubo no puede dar.
10. **Los contadores no derivan.** Las tres consultas de deriva (miembros, likes/comentarios, publicaciones) devuelven **0 filas**.
11. **La moderación conoce el tipo nuevo.** `pg_get_functiondef` menciona `community_posts` en las **cuatro** funciones tocadas, y `handle_child_safety_report` **no** menciona `public.communities` (una comunidad entera no se auto-oculta por denuncias).
12. **Cero sobrecargas.** Agrupando `pg_proc` por nombre sobre las trece RPC, ninguna tiene `count(*) <> 1`. Una sobrecarga accidental devuelve `300 PGRST203` a todas las llamadas que no manden el argumento nuevo, y la página carga con 200 y el feed vacío.
13. **No hay comentarios de nivel 2** ni comentarios cruzados de comunidad: la consulta de anidamiento devuelve `0`, y el INSERT cruzado del VERIFY muere con `23503` por `community_posts_parent_fkey`.

Y los cuatro que cierran los críticos de la **primera** revisión adversarial, todos ejercitados y ninguno deducido:

14. **Borrar no devuelve cuota.** Publicar 10, borrar las 10, y la 11.ª sigue dando `23514`. Trescientos ciclos like/unlike sobre la misma publicación, y el 301 da `23514`. La cuota cuenta asientos de `community_post_quota`, que son eventos y no se borran.
15. **Soltar el mando tampoco.** `fundar_comunidad` → `alternar_membresia_comunidad` (salir, con traspaso) → `fundar_comunidad` da `23514` en la tercera llamada: las tres cuotas de fundación cuelgan de `fundador_id`, que es inmutable, no de `owner_id`, que se traspasa.
16. **Comentar exige lo mismo que ver.** Con A bloqueando a B, `publicar_en_comunidad('<comunidad>', '<texto>', '<publicación de A>')` llamada por B lanza `P0002`. Antes devolvía el id del comentario, mientras el like a esa misma publicación ya daba `42501`.
17. **De una comunidad archivada se sale.** `alternar_membresia_comunidad` sobre una comunidad archivada u oculta **deja salir** y devuelve `{soy_miembro: false}`; entrar a esa misma comunidad sigue dando `P0002`. Y la cuota de membresías vivas, contada después, baja: la plaza deja de estar ocupada.

Y los cuatro que cierran lo que destapó la **segunda** vuelta, la que auditó los parches de la primera:

18. **Ninguna comunidad se queda sin mando.** Después de `delete_user_data`, toda comunidad tocada cumple `archived_at IS NOT NULL` **o** tiene exactamente **una** fila `role = 'owner'` con `left_at IS NULL`. Cero owners vivos con `archived_at NULL` es el estado sin vuelta atrás, y es el que producían las tres copias divergentes del traspaso.
19. **El borrado de cuenta no deja el identificador dentro.** En esa misma prueba, `communities.fundador_id` acaba en `NULL`. No es decorativo: es la única forma de comprobar que el congelador de la columna no revierte la acción referencial `ON DELETE SET NULL`, que el motor **no** rechaza porque la comprobación referencial se salta cuando la clave no cambia. La consulta de referencias colgantes (`fundador_id NOT NULL` sin fila en `profiles`) devuelve `0`, siempre.
20. **Traspasar el mando no traspasa la autoría.** Desde la cuenta del relevo, `mis_comunidades()` devuelve `mi_rol = 'owner'` y `soy_fundador = false`, porque esa columna responde contra `fundador_id` y no contra el rol.
21. **El ledger tiene fecha de caducidad.** `SELECT count(*) FROM cron.job WHERE jobname = 'purga_community_post_quota'` devuelve `1`. Una retención que vive en un comentario no la ejecuta nadie, y lo que queda entonces no es una cuota: es un diario de rutinas por persona que sobrevive al borrado del contenido.

## Desviaciones del reporte original

El reporte de producto es correcto en la **intención** y describe un esquema que no existe. Estas son las desviaciones, y ninguna es negociable:

| Lo que decía el reporte | La realidad del repo | Qué se hace |
|---|---|---|
| Tabla **`users`** | **No existe.** El perfil es `public.profiles`, cuya PK **es** `auth.users.id`, y tiene GRANTs **por columna**: una columna nueva sin su GRANT rompe todo SELECT que la incluya con `42501`. | Todas las FK de autor y de miembro apuntan a `public.profiles(id)`. Ninguna a `auth.users` — salvo `user_blocks`, que ya está así y no se toca. |
| Tabla **`posts`** con `community_id` | **No existe.** El "feed" son `products_services` y las "solicitudes" son `purchase_requests`. Y `posts` a secas es un nombre genérico en el esquema `public`, que PostgREST expone entero. | Tabla nueva `community_posts`, con prefijo `community_` para que `\dt community*` liste la funcionalidad completa y un grep de `community_` sea exhaustivo. |
| **`geom geometry(Point,4326)`** | El repo usa `geography(POINT, 4326)` en las dos tablas con geo, sin una sola excepción. No hay ni una columna `geometry` persistida en 149 migraciones. | `centro geography(POINT, 4326)`. Con `geometry` en 4326, el tercer argumento de `ST_DWithin` pasa de **metros a grados sin dar error**: `ST_DWithin(g, p, 5000)` significaría 5000 grados y devolvería la tabla entera. En un producto entrenado para pintar "no hay nada cerca" cuando algo falla, un filtro que no filtra pasa desapercibido meses. |
| Tabla puente **`user_communities`** | — | Se llama `community_members`, y su PK es **`(user_id, community_id)` en ese orden**: es el driver del fan-out del muro unificado, que arranca con `WHERE user_id = :yo`. Con la PK al revés sería un escaneo. |
| "Centro desde mi ubicación" | La ubicación sale de la cookie `vicino_location`, que **la escribe el navegador** con `document.cookie`, no es `HttpOnly`, no va firmada y ya viene redondeada a 3 decimales. | Se acepta la cookie como insumo y **toda** la defensa vive en la base: snap a 2 decimales (~1.1 km) al guardar, `CHECK` que lo verifica en la tabla, cuota de fundación bajo advisory lock, unicidad por celda, y `centro` sin GRANT para nadie. No se finge un control de cercanía que se rodea con una línea en la consola. |
| "Likes y comentarios" | **No existe ningún patrón de "me gusta"** en las 149 migraciones ni en `apps/web`. Y no hay **ningún** hilo de comentarios: `reviews.respuesta` es una columna, no una fila. | `community_post_likes` copia la forma de `favorites` (par único, sin UPDATE) pero **sin** su columna `id` y **sin** la visibilidad pública de `store_follows`. Los comentarios son filas de `community_posts` con `parent_post_id`. |
| "Sub-pestaña junto a Para ti / Siguiendo / Solicitudes" | Esas tres no son rutas: son `?feed=`. Y `check-rutas.mjs` rompe el build ante un `href` a una ruta inexistente. | Decisión de frontend, **fuera del alcance de esta entrega** y anotada como pregunta abierta bloqueante. |
| "Explorar = muro unificado" | — | Se implementa con **fan-out `CROSS JOIN LATERAL`** acotado a `membresías × límite`, no con `community_id = ANY(...)` ni con un índice global por fecha. Los dos son correctos, los dos parecen bien con 200 filas en desarrollo, y los dos degradan **sin dar error**. |
| "Otras comunidades a ≤5 km" | — | Radio **constante** dentro de la función, sin parámetro: si el radio no se puede variar, el oráculo de búsqueda binaria de la distancia no existe de raíz. Distancia en cubos de 500 m y **sin** paginación por cursor — mezclar orden por distancia con un keyset sobre `(created_at, id)` es la trampa que ya vive latente en la rama `sort_by_distance` de la v4. |

Y **lo que el reporte no menciona y la migración trae igual**, porque lo que no entra aquí no entra nunca: `is_hidden` en las publicaciones, el valor de enum de reportes, las tres ramas de moderación, el borrado de cuenta, el ciclo de vida de la comunidad (archivar, traspaso de mando) y las cuotas anti-abuso.
