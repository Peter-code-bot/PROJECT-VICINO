-- Cuentas internas: una marca explicita en la base, y las cuentas sinteticas
-- fuera de toda superficie publica.
--
-- Por que (revision del 1-nov-2026, solo lectura en produccion): la base no
-- tenia ninguna forma de decir "esta cuenta es nuestra", asi que cualquier
-- conteo mezclaba usuarios reales con cuentas internas y habia que excluir
-- correos a mano cada vez. Lo que se encontro:
--   * 30 cuentas sinteticas creadas el 26-sep para las capturas de tienda: 27
--     con @mock-appstore.vicino.mx (UUID con patron, a1111111-1111-4111-...) y
--     3 con @demo.vicino.mx. Sus publicaciones seguian 'disponible' y se veian
--     junto a las reales, con reputacion sembrada (cientos de puntos y decenas
--     de "ventas" sin una sola venta detras).
--   * 5 comunidades eran de cuentas sinteticas, y casi todas las membresias y
--     todas las solicitudes de compra eran sinteticas o del equipo (las
--     solicitudes ya vencieron, por eso hoy no se ven).
--
-- Que hace:
--   1. public.cuentas_internas, una fila por cuenta, con su tipo:
--        sintetica  datos inventados para capturas o demos. SE OCULTAN.
--        equipo     personas del equipo. Siguen visibles; fuera de metricas.
--        prueba     QA, diagnostico y la cuenta de revision de Google Play, que
--                   tiene que seguir funcionando. Visibles; fuera de metricas.
--      RLS sin policies y sin privilegios para anon/authenticated: la leen
--      postgres, service_role y las funciones SECURITY DEFINER. Que una cuenta
--      sea interna no es dato publico.
--   2. profiles.is_hidden = true en las sinteticas. No es un mecanismo nuevo:
--      es la bandera de moderacion que ya respetan la RLS de profiles y de
--      products_services (ficha y tienda), el feed y la busqueda
--      (search_nearby_products_v4), el mapa (search_map_publications_v3),
--      "vendedores cerca" (count_nearby_vendors), las solicitudes
--      (feed_nearby_requests_v2, nearby_request_categories,
--      home_guest_requests_preview), las vistas previas y los muros de
--      comunidades, las resenas (leer_resenas_local) y el podio
--      (get_ranking_hiperlocal). vicino_guard.cuenta_suspendida() ademas les
--      impide publicar: en produccion ya no hacen falta, las capturas salen
--      del staging.
--   3. communities.is_hidden = true en las comunidades cuyo dueno es sintetico
--      y que no tienen ningun miembro externo. El directorio
--      (descubrir_comunidades), el detalle y comunidades_publicas_ids miran la
--      bandera de la COMUNIDAD, no la del dueno.
--   4. purchase_requests: la policy de lectura deja de servir por id
--      (/solicitudes/[id]) una solicitud abierta de un comprador oculto o
--      bloqueado. Los feeds ya lo filtraban; la lectura directa no. Mismo
--      patron que products_services: EXISTS positivo sobre profiles, que con la
--      RLS de profiles da falso para un perfil oculto o bloqueado. (Un NOT
--      EXISTS ... is_hidden daria siempre verdadero: el perfil oculto ni se ve.)
--
-- Las cuentas personales del equipo van por UUID y no por correo: el repo es
-- publico y esos correos no estan en el. Para marcar otra cuenta:
--   INSERT INTO public.cuentas_internas (user_id, tipo, motivo)
--   VALUES ('<uuid>', 'equipo', '<de quien es y por que>');
-- Una cuenta sintetica nueva, ademas, se oculta con
--   UPDATE public.profiles SET is_hidden = true WHERE id = '<uuid>';
--
-- No borra nada. Reversion: docs/rollback/20261102120000_cuentas_internas_rollback.sql
-- Idempotente.

-- El cambio de policy toma un candado sobre purchase_requests hasta el commit:
-- si no lo consigue en 5 s, la migracion entera aborta en vez de hacer fila.
SET LOCAL lock_timeout = '5s';

CREATE TABLE IF NOT EXISTS public.cuentas_internas (
  user_id    uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  tipo       text NOT NULL CHECK (tipo IN ('sintetica', 'equipo', 'prueba')),
  motivo     text NOT NULL CHECK (btrim(motivo) <> ''),
  marcada_en timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.cuentas_internas IS
  'Cuentas que no son usuarios reales (sinteticas, del equipo o de prueba). Toda metrica para terceros las excluye; las sinteticas ademas van con profiles.is_hidden. Ver 20261102120000_cuentas_internas.sql.';

ALTER TABLE public.cuentas_internas ENABLE ROW LEVEL SECURITY;
-- Supabase da por defecto ALL sobre toda tabla nueva de public a anon y
-- authenticated. Sin policies la RLS ya lo cierra, pero el privilegio no se
-- deja: es la segunda llave.
REVOKE ALL ON public.cuentas_internas FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.cuentas_internas TO service_role;

INSERT INTO public.cuentas_internas (user_id, tipo, motivo)
SELECT DISTINCT ON (s.user_id) s.user_id, s.tipo, s.motivo
  FROM (
    SELECT u.id AS user_id, 'sintetica' AS tipo,
           'Vendedor inventado para las capturas de tienda (26-sep-2026)' AS motivo, 1 AS prioridad
      FROM auth.users u WHERE u.email ILIKE '%@mock-appstore.vicino.mx'
    UNION ALL
    SELECT u.id, 'sintetica', 'Comprador inventado para las capturas de tienda (26-sep-2026)', 1
      FROM auth.users u WHERE u.email ILIKE '%@demo.vicino.mx'
    UNION ALL
    SELECT u.id, 'prueba', 'Diagnostico del registro (test_diag_*@example.com)', 2
      FROM auth.users u WHERE u.email ILIKE 'test\_diag\_%@example.com'
    UNION ALL
    SELECT u.id, 'prueba', 'QA del equipo', 2
      FROM auth.users u WHERE u.email ILIKE 'vicino.qa%'
    UNION ALL
    SELECT u.id, 'prueba', 'Revision de la ficha de Google Play', 2
      FROM auth.users u WHERE lower(u.email) = 'reviewconsolevicino@gmail.com'
    UNION ALL
    SELECT u.id, 'equipo', 'Administracion de VICINO', 3
      FROM auth.users u WHERE lower(u.email) = 'admin@vicinomarket.com'
    UNION ALL
    SELECT u.id, 'equipo', v.motivo, 3
      FROM auth.users u
      JOIN (VALUES
        ('7db68a49-2aa9-443a-a99c-3b654a43ec95'::uuid, 'Javier, cuenta principal'),
        ('24ab61a7-4460-4980-a7c5-c7d4f7c93731'::uuid, 'Javier, segunda cuenta (pruebas de compra)'),
        ('f0e59346-d67b-428b-a2fa-d625deb20986'::uuid, 'Pedro, cuenta personal'),
        ('6289585b-9887-4898-b353-00c9691ddc5a'::uuid, 'Pedro, cuenta de la organizacion')
      ) AS v(id, motivo) ON v.id = u.id
  ) s
 ORDER BY s.user_id, s.prioridad
ON CONFLICT (user_id) DO NOTHING;

-- 2. Las sinteticas, ocultas.
UPDATE public.profiles p
   SET is_hidden = true
  FROM public.cuentas_internas ci
 WHERE ci.user_id = p.id
   AND ci.tipo = 'sintetica'
   AND NOT p.is_hidden;

-- 3. Sus comunidades, si nadie de fuera esta dentro.
UPDATE public.communities c
   SET is_hidden = true
 WHERE NOT c.is_hidden
   AND EXISTS (SELECT 1 FROM public.cuentas_internas ci
                WHERE ci.user_id = c.owner_id AND ci.tipo = 'sintetica')
   AND NOT EXISTS (SELECT 1 FROM public.community_members m
                    WHERE m.community_id = c.id
                      AND m.left_at IS NULL
                      AND NOT EXISTS (SELECT 1 FROM public.cuentas_internas ci
                                       WHERE ci.user_id = m.user_id));

-- 4. Lectura directa de solicitudes.
DROP POLICY IF EXISTS purchase_requests_select ON public.purchase_requests;
CREATE POLICY purchase_requests_select ON public.purchase_requests
  FOR SELECT
  USING (
    buyer_id = (SELECT auth.uid())
    OR (
      status = 'open'::public.request_status
      AND EXISTS (SELECT 1 FROM public.profiles pr
                   WHERE pr.id = purchase_requests.buyer_id
                     AND pr.is_hidden = false)
    )
  );

DO $verify$
DECLARE
  v_n integer;
BEGIN
  IF NOT (SELECT relrowsecurity FROM pg_class WHERE oid = 'public.cuentas_internas'::regclass) THEN
    RAISE EXCEPTION 'cuentas_internas quedo sin RLS';
  END IF;
  IF has_table_privilege('anon', 'public.cuentas_internas', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cuentas_internas', 'SELECT')
     OR has_table_privilege('authenticated', 'public.cuentas_internas', 'INSERT')
     OR has_table_privilege('authenticated', 'public.cuentas_internas', 'UPDATE') THEN
    RAISE EXCEPTION 'cuentas_internas quedo expuesta a anon/authenticated';
  END IF;

  SELECT count(*) INTO v_n
    FROM public.profiles p JOIN public.cuentas_internas ci ON ci.user_id = p.id
   WHERE ci.tipo = 'sintetica' AND NOT p.is_hidden;
  IF v_n > 0 THEN
    RAISE EXCEPTION '% cuentas sinteticas siguen visibles', v_n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'purchase_requests'
                    AND policyname = 'purchase_requests_select'
                    AND cmd = 'SELECT' AND qual ILIKE '%is_hidden%') THEN
    RAISE EXCEPTION 'la lectura de purchase_requests no filtra compradores ocultos';
  END IF;
END
$verify$;

-- VERIFY (a mano, solo lectura):
--   SELECT tipo, count(*) FROM public.cuentas_internas GROUP BY 1;
--   -- produccion 2-nov: sintetica 30, equipo 5, prueba 5
--   SELECT count(*) FROM public.products_services ps
--     JOIN public.profiles p ON p.id = ps.creador_id
--     JOIN public.cuentas_internas ci ON ci.user_id = ps.creador_id AND ci.tipo = 'sintetica'
--    WHERE ps.estatus = 'disponible' AND NOT ps.is_hidden AND NOT p.is_hidden;
--   -- antes 27; despues 0
--   SELECT nombre FROM public.communities WHERE NOT is_hidden;
--   -- ya no sale ninguna de cuenta sintetica (Vecinos Tabasco 2000 la oculta 20261102120200)
