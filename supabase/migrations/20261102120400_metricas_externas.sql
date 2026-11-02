-- Metricas solo con cuentas externas: una fuente unica para las convocatorias.
--
-- Requiere 20261102120000_cuentas_internas.sql y 20261102120300_actividad_diaria.sql.
--
-- Los conteos sacados a mano de la base mezclaban cuentas sinteticas, del
-- equipo y ventas de prueba. Estas dos funciones son la unica forma de sacar
-- cifras para terceros: excluyen public.cuentas_internas por construccion, y
-- cuentan actividad por ACCIONES, nunca por last_seen_at (muerto) ni por
-- vistas_count (lo suben bots y refrescos).
--
--   SELECT * FROM public.metricas_semanales_externas(12);  -- serie por semana
--   SELECT * FROM public.metricas_resumen_externas();      -- foto de hoy
--
-- Desde la maquina de Pedro, en solo lectura contra produccion:
--   node scripts/db-query.mjs "select * from metricas_semanales_externas(12)"
--
-- Definiciones (semana = lunes a domingo, hora de CDMX; la semana en curso sale
-- incompleta):
--   cuentas_nuevas        cuentas externas creadas esa semana.
--   publicaciones_nuevas  publicaciones de cuentas externas (sin borradores).
--   vendedores_activos    cuentas externas que esa semana publicaron, contestaron
--                         en un chat como vendedor, ofertaron a una solicitud o
--                         confirmaron una venta. Toda accion que tiene
--                         contraparte cuenta solo si la contraparte tambien es
--                         externa: contestarle a una prueba del equipo no es
--                         traccion.
--   compradores_activos   igual, del lado comprador: escribir en un chat como
--                         comprador, pedir algo, guardar en favoritos, seguir una
--                         tienda, confirmar una compra, resenar.
--   usuarios_activos      cualquiera de las anteriores o publicar en una comunidad.
--   usuarios_con_visita   cuentas externas con al menos un dia en
--                         actividad_diaria esa semana. Solo existe desde que se
--                         desplego el proxy que llama marcar_visto().
--   chats_calificados     chats entre dos cuentas externas en los que ya
--                         escribieron LAS DOS partes; cuentan en la semana en que
--                         contesto la segunda.
--   ventas_completadas    ventas completadas entre dos cuentas externas
--                         (completed_at); gmv_mxn suma precio_acordado, que es el
--                         total acordado por la cantidad.
--
-- Solo para service_role y postgres. No borra nada.
-- Reversion: docs/rollback/20261102120400_metricas_externas_rollback.sql
-- Idempotente.

CREATE OR REPLACE FUNCTION public.metricas_semanales_externas(p_semanas integer DEFAULT 12)
 RETURNS TABLE (
   semana               date,
   cuentas_nuevas       integer,
   cuentas_acumuladas   integer,
   publicaciones_nuevas integer,
   vendedores_nuevos    integer,
   vendedores_activos   integer,
   compradores_activos  integer,
   usuarios_activos     integer,
   usuarios_con_visita  integer,
   chats_iniciados      integer,
   chats_calificados    integer,
   solicitudes_nuevas   integer,
   ventas_completadas   integer,
   gmv_mxn              numeric,
   resenas              integer
 )
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH
parametros AS (
  SELECT GREATEST(1, LEAST(COALESCE(p_semanas, 12), 260)) AS n,
         date_trunc('week', now() AT TIME ZONE 'America/Mexico_City')::date AS esta_semana
),
semanas AS (
  SELECT (p.esta_semana - 7 * g)::date AS semana
    FROM parametros p, generate_series(0, p.n - 1) AS g
),
externas AS (
  SELECT pr.id, pr.created_at
    FROM public.profiles pr
   WHERE NOT EXISTS (SELECT 1 FROM public.cuentas_internas ci WHERE ci.user_id = pr.id)
),
acciones AS (
  SELECT ps.creador_id AS user_id, 'vendedor' AS rol, ps.created_at AS en
    FROM public.products_services ps
   WHERE ps.estatus <> 'borrador'
  UNION ALL
  SELECT m.autor_id, CASE WHEN m.autor_id = c.vendedor_id THEN 'vendedor' ELSE 'comprador' END, m.created_at
    FROM public.messages m
    JOIN public.chats c ON c.id = m.chat_id
   WHERE m.message_type = 'user_text'
     AND c.comprador_id IN (SELECT id FROM externas)
     AND c.vendedor_id  IN (SELECT id FROM externas)
  UNION ALL
  SELECT r.buyer_id, 'comprador', r.created_at
    FROM public.purchase_requests r
  UNION ALL
  SELECT rr.seller_id, 'vendedor', rr.created_at
    FROM public.request_responses rr
    JOIN public.purchase_requests r ON r.id = rr.request_id
   WHERE r.buyer_id IN (SELECT id FROM externas)
  UNION ALL
  SELECT f.usuario_id, 'comprador', f.created_at
    FROM public.favorites f
    JOIN public.products_services ps ON ps.id = f.producto_id
   WHERE ps.creador_id IN (SELECT id FROM externas)
  UNION ALL
  SELECT sf.follower_id, 'comprador', sf.created_at
    FROM public.store_follows sf
   WHERE sf.store_id IN (SELECT id FROM externas)
  UNION ALL
  SELECT s.seller_id, 'vendedor', s.seller_confirmed_at
    FROM public.sale_confirmations s
   WHERE s.buyer_id IN (SELECT id FROM externas)
  UNION ALL
  SELECT s.buyer_id, 'comprador', s.buyer_confirmed_at
    FROM public.sale_confirmations s
   WHERE s.seller_id IN (SELECT id FROM externas)
  UNION ALL
  SELECT rv.reviewer_id, CASE WHEN rv.review_type = 'seller_to_buyer' THEN 'vendedor' ELSE 'comprador' END, rv.created_at
    FROM public.reviews rv
   WHERE rv.reviewed_id IN (SELECT id FROM externas)
  UNION ALL
  SELECT cp.author_id, 'comunidad', cp.created_at
    FROM public.community_posts cp
),
acciones_externas AS (
  SELECT a.user_id, a.rol,
         date_trunc('week', a.en AT TIME ZONE 'America/Mexico_City')::date AS semana
    FROM acciones a
   WHERE a.en IS NOT NULL
     AND a.user_id IN (SELECT id FROM externas)
),
primera_publicacion AS (
  SELECT ps.creador_id,
         date_trunc('week', min(ps.created_at) AT TIME ZONE 'America/Mexico_City')::date AS semana
    FROM public.products_services ps
   WHERE ps.estatus <> 'borrador'
     AND ps.creador_id IN (SELECT id FROM externas)
   GROUP BY ps.creador_id
),
chats_externos AS (
  SELECT c.id,
         date_trunc('week', c.created_at AT TIME ZONE 'America/Mexico_City')::date AS semana_inicio,
         (SELECT min(m.created_at) FROM public.messages m
           WHERE m.chat_id = c.id AND m.autor_id = c.comprador_id AND m.message_type = 'user_text') AS primero_comprador,
         (SELECT min(m.created_at) FROM public.messages m
           WHERE m.chat_id = c.id AND m.autor_id = c.vendedor_id AND m.message_type = 'user_text') AS primero_vendedor
    FROM public.chats c
   WHERE c.comprador_id IN (SELECT id FROM externas)
     AND c.vendedor_id  IN (SELECT id FROM externas)
),
ventas_externas AS (
  SELECT date_trunc('week', s.completed_at AT TIME ZONE 'America/Mexico_City')::date AS semana,
         s.precio_acordado
    FROM public.sale_confirmations s
   WHERE s.status = 'completed'
     AND s.completed_at IS NOT NULL
     AND s.seller_id IN (SELECT id FROM externas)
     AND s.buyer_id  IN (SELECT id FROM externas)
)
SELECT
  w.semana,
  (SELECT count(*) FROM externas e
    WHERE date_trunc('week', e.created_at AT TIME ZONE 'America/Mexico_City')::date = w.semana)::integer,
  (SELECT count(*) FROM externas e
    WHERE (e.created_at AT TIME ZONE 'America/Mexico_City')::date < w.semana + 7)::integer,
  (SELECT count(*) FROM public.products_services ps
    WHERE ps.estatus <> 'borrador'
      AND ps.creador_id IN (SELECT id FROM externas)
      AND date_trunc('week', ps.created_at AT TIME ZONE 'America/Mexico_City')::date = w.semana)::integer,
  (SELECT count(*) FROM primera_publicacion pp WHERE pp.semana = w.semana)::integer,
  (SELECT count(DISTINCT ae.user_id) FROM acciones_externas ae
    WHERE ae.semana = w.semana AND ae.rol = 'vendedor')::integer,
  (SELECT count(DISTINCT ae.user_id) FROM acciones_externas ae
    WHERE ae.semana = w.semana AND ae.rol = 'comprador')::integer,
  (SELECT count(DISTINCT ae.user_id) FROM acciones_externas ae
    WHERE ae.semana = w.semana)::integer,
  (SELECT count(DISTINCT ad.user_id) FROM public.actividad_diaria ad
    WHERE ad.user_id IN (SELECT id FROM externas)
      AND ad.dia >= w.semana AND ad.dia < w.semana + 7)::integer,
  (SELECT count(*) FROM chats_externos ce WHERE ce.semana_inicio = w.semana)::integer,
  (SELECT count(*) FROM chats_externos ce
    WHERE ce.primero_comprador IS NOT NULL AND ce.primero_vendedor IS NOT NULL
      AND date_trunc('week', GREATEST(ce.primero_comprador, ce.primero_vendedor) AT TIME ZONE 'America/Mexico_City')::date = w.semana)::integer,
  (SELECT count(*) FROM public.purchase_requests r
    WHERE r.buyer_id IN (SELECT id FROM externas)
      AND date_trunc('week', r.created_at AT TIME ZONE 'America/Mexico_City')::date = w.semana)::integer,
  (SELECT count(*) FROM ventas_externas v WHERE v.semana = w.semana)::integer,
  (SELECT COALESCE(sum(v.precio_acordado), 0) FROM ventas_externas v WHERE v.semana = w.semana),
  (SELECT count(*) FROM public.reviews rv
    WHERE rv.reviewer_id IN (SELECT id FROM externas)
      AND rv.reviewed_id IN (SELECT id FROM externas)
      AND date_trunc('week', rv.created_at AT TIME ZONE 'America/Mexico_City')::date = w.semana)::integer
FROM semanas w
ORDER BY w.semana;
$function$;

CREATE OR REPLACE FUNCTION public.metricas_resumen_externas()
 RETURNS TABLE (
   cuentas_externas            integer,
   vendedores_con_publicacion  integer,
   publicaciones_visibles      integer,
   ventas_entre_independientes integer,
   gmv_mxn                     numeric,
   chats_calificados           integer,
   solicitudes_abiertas        integer,
   miembros_de_comunidades     integer,
   usuarios_con_visita_7d      integer,
   usuarios_con_visita_30d     integer
 )
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
WITH
externas AS (
  SELECT pr.id, pr.is_hidden
    FROM public.profiles pr
   WHERE NOT EXISTS (SELECT 1 FROM public.cuentas_internas ci WHERE ci.user_id = pr.id)
),
visibles AS (
  SELECT ps.id, ps.creador_id
    FROM public.products_services ps
    JOIN externas e ON e.id = ps.creador_id AND NOT e.is_hidden
   WHERE ps.estatus = 'disponible' AND NOT ps.is_hidden
),
ventas AS (
  SELECT s.precio_acordado
    FROM public.sale_confirmations s
   WHERE s.status = 'completed'
     AND s.seller_id IN (SELECT id FROM externas)
     AND s.buyer_id  IN (SELECT id FROM externas)
),
hoy AS (
  SELECT (now() AT TIME ZONE 'America/Mexico_City')::date AS dia
)
SELECT
  (SELECT count(*) FROM externas)::integer,
  (SELECT count(DISTINCT v.creador_id) FROM visibles v)::integer,
  (SELECT count(*) FROM visibles)::integer,
  (SELECT count(*) FROM ventas)::integer,
  (SELECT COALESCE(sum(precio_acordado), 0) FROM ventas),
  (SELECT count(*) FROM public.chats c
    WHERE c.comprador_id IN (SELECT id FROM externas)
      AND c.vendedor_id  IN (SELECT id FROM externas)
      AND EXISTS (SELECT 1 FROM public.messages m
                   WHERE m.chat_id = c.id AND m.autor_id = c.comprador_id AND m.message_type = 'user_text')
      AND EXISTS (SELECT 1 FROM public.messages m
                   WHERE m.chat_id = c.id AND m.autor_id = c.vendedor_id AND m.message_type = 'user_text'))::integer,
  (SELECT count(*) FROM public.purchase_requests r
    WHERE r.status = 'open' AND r.expires_at > now()
      AND r.buyer_id IN (SELECT id FROM externas))::integer,
  (SELECT count(DISTINCT m.user_id) FROM public.community_members m
    WHERE m.left_at IS NULL AND m.user_id IN (SELECT id FROM externas))::integer,
  (SELECT count(DISTINCT ad.user_id) FROM public.actividad_diaria ad, hoy
    WHERE ad.dia > hoy.dia - 7 AND ad.user_id IN (SELECT id FROM externas))::integer,
  (SELECT count(DISTINCT ad.user_id) FROM public.actividad_diaria ad, hoy
    WHERE ad.dia > hoy.dia - 30 AND ad.user_id IN (SELECT id FROM externas))::integer;
$function$;

REVOKE ALL ON FUNCTION public.metricas_semanales_externas(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.metricas_resumen_externas() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.metricas_semanales_externas(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.metricas_resumen_externas() TO service_role;

COMMENT ON FUNCTION public.metricas_semanales_externas(integer) IS
  'Serie semanal (hora de CDMX) solo con cuentas externas. Definiciones en 20261102120400_metricas_externas.sql.';
COMMENT ON FUNCTION public.metricas_resumen_externas() IS
  'Foto actual solo con cuentas externas. Definiciones en 20261102120400_metricas_externas.sql.';

DO $verify$
BEGIN
  IF has_function_privilege('anon', 'public.metricas_semanales_externas(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.metricas_semanales_externas(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.metricas_resumen_externas()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.metricas_resumen_externas()', 'EXECUTE') THEN
    RAISE EXCEPTION 'las metricas quedaron expuestas a anon/authenticated';
  END IF;
  IF (SELECT count(*) FROM public.metricas_semanales_externas(4)) <> 4 THEN
    RAISE EXCEPTION 'metricas_semanales_externas(4) no devuelve 4 semanas';
  END IF;
END
$verify$;
