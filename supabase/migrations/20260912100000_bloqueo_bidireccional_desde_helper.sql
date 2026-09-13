-- R-01: bloquear a alguien no te escondia de esa persona.
--
-- Las cuatro policies block_aware_* (profiles, reviews, products_services y
-- messages) escriben el bloqueo bidireccional como un NOT EXISTS sobre
-- user_blocks DENTRO de la policy. Pero user_blocks tiene RLS con una sola
-- policy, users_manage_own_blocks USING (auth.uid() = blocker_id): la
-- subconsulta corre bajo la RLS de quien pregunta y solo ve las filas donde
-- ese usuario es quien bloquea. La rama "me bloquearon" busca filas con
-- blocker_id ajeno, que RLS ya escondio, y el NOT EXISTS da true por falta de
-- PERMISO, no por falta de bloqueo. Resultado: si A bloquea a B, B sigue
-- viendo a A. Reproducido contra produccion el 6-sep-2026 (reporte de
-- Alejandro, R-01) y otra vez el 12-sep-2026 antes de aplicar esto.
--
-- ARREGLO. La lectura de user_blocks tiene que saltarse la RLS, o sea un
-- SECURITY DEFINER. Y se hace con UNA llamada por consulta, no una por fila:
-- vicino_guard.bloqueados_conmigo() devuelve el arreglo de ids bloqueados en
-- cualquiera de los dos sentidos con quien llama, y la policy lo consume como
--
--     NOT (columna = ANY ((select vicino_guard.bloqueados_conmigo())::uuid[]))
--
-- La subconsulta no depende de la fila, asi que el planificador la resuelve
-- como InitPlan una sola vez por consulta (el mismo truco que
-- `(select auth.uid())` en 20260602000001). Con un `hay_bloqueo_con(columna)`
-- por fila, cada lectura del feed habria costado una llamada DEFINER por cada
-- fila candidata -- y una funcion DEFINER nunca se inlinea.
--
-- El ::uuid[] NO es cosmetico. Sin el cast, `x = ANY ((select f()))` se parsea
-- como la forma de SUBCONSULTA de ANY (compara x con cada FILA del resultado,
-- que es un uuid[]) y muere con "operator does not exist: uuid = uuid[]".
-- Con el cast es una expresion escalar y ANY toma la forma de ARREGLO.
-- Comprobado el 12-sep-2026 en el proyecto de pruebas antes de aplicar.
--
-- POR QUE EN vicino_guard Y NO EN public. PostgREST expone public y
-- graphql_public. Una funcion en public con EXECUTE para authenticated es un
-- endpoint REST, y esta devolveria la lista de quienes te bloquearon. En
-- vicino_guard (creado en 20260826110000, sin USAGE para anon/authenticated
-- hasta hoy) la policy la puede llamar -- se concede USAGE del esquema y
-- EXECUTE de esta funcion, nada mas -- pero por REST no existe. Los demas
-- objetos de vicino_guard siguen sin ningun privilegio para esos roles: USAGE
-- sobre el esquema no abre nada por si solo.
--
-- anon tambien recibe EXECUTE, y no es un descuido: las policies de profiles,
-- products_services y reviews aplican a anon (no llevan TO), y el ejecutor
-- puede evaluar el InitPlan aunque la rama `auth.uid() IS NOT NULL` no se
-- cumpla -- Postgres reordena las clausulas de un AND por costo. Sin EXECUTE,
-- un anon leyendo el feed moriria con 42501. Para anon la funcion devuelve
-- '{}' y la policy queda como estaba.
--
-- Lo que NO cambia: las policies conservan exactamente sus otras ramas
-- (propio, admin/moderador, anon con no-oculto, autenticado con no-oculto).
-- Solo se sustituye la subconsulta rota, y feed_nearby_requests /
-- search_nearby_products_v4 -- que ya son SECURITY DEFINER y por eso SI veian
-- los dos sentidos -- no se tocan.
--
-- ---------------------------------------------------------------------------

create schema if not exists vicino_guard;
revoke create on schema vicino_guard from public, anon, authenticated;

create or replace function vicino_guard.bloqueados_conmigo()
returns uuid[]
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select array_agg(
              case when ub.blocker_id = (select auth.uid()) then ub.blocked_id
                   else ub.blocker_id end)
       from public.user_blocks ub
      where ub.blocker_id = (select auth.uid())
         or ub.blocked_id = (select auth.uid())),
    '{}'::uuid[]
  );
$function$;

comment on function vicino_guard.bloqueados_conmigo() is
  'Ids con los que quien llama tiene un bloqueo en CUALQUIER sentido (yo bloquee, o me bloquearon). SECURITY DEFINER porque user_blocks tiene RLS USING (auth.uid() = blocker_id) y la direccion contraria se filtra por falta de permiso. Vive en vicino_guard, que PostgREST no expone, para que no sea un endpoint que liste a quienes te bloquearon. Las policies la consumen como InitPlan: NOT (col = ANY ((select vicino_guard.bloqueados_conmigo()))). Para anon devuelve {}.';

revoke all on function vicino_guard.bloqueados_conmigo() from public;
grant usage on schema vicino_guard to anon, authenticated;
grant execute on function vicino_guard.bloqueados_conmigo() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Las cuatro policies. Mismo cuerpo que el vivo (20260602000001), con la
-- subconsulta sobre user_blocks sustituida por el helper.
-- ---------------------------------------------------------------------------

alter policy "block_aware_profiles_select" on public.profiles
  using (
    (select auth.uid()) = id
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
    or public.has_role((select auth.uid()), 'moderator'::public.app_role)
    or ((select auth.uid()) is null and is_hidden = false)
    or (
      (select auth.uid()) is not null
      and is_hidden = false
      and not (id = any ((select vicino_guard.bloqueados_conmigo())::uuid[]))
    )
  );

alter policy "block_aware_reviews_select" on public.reviews
  using (
    (select auth.uid()) = reviewer_id
    or (select auth.uid()) = reviewed_id
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
    or public.has_role((select auth.uid()), 'moderator'::public.app_role)
    or ((select auth.uid()) is null and is_hidden = false and visible = true)
    or (
      (select auth.uid()) is not null
      and is_hidden = false
      and visible = true
      and not (reviewer_id = any ((select vicino_guard.bloqueados_conmigo())::uuid[]))
    )
  );

alter policy "block_aware_products_select" on public.products_services
  using (
    (select auth.uid()) = creador_id
    or public.has_role((select auth.uid()), 'admin'::public.app_role)
    or public.has_role((select auth.uid()), 'moderator'::public.app_role)
    or (
      (select auth.uid()) is null
      and estatus = 'disponible'::public.listing_status
      and is_hidden = false
    )
    or (
      (select auth.uid()) is not null
      and estatus = 'disponible'::public.listing_status
      and is_hidden = false
      and not (creador_id = any ((select vicino_guard.bloqueados_conmigo())::uuid[]))
    )
  );

alter policy "block_aware_messages_select" on public.messages
  using (
    public.has_role((select auth.uid()), 'admin'::public.app_role)
    or public.has_role((select auth.uid()), 'moderator'::public.app_role)
    or (
      exists (
        select 1 from public.chats
         where chats.id = messages.chat_id
           and (chats.comprador_id = (select auth.uid())
                or chats.vendedor_id = (select auth.uid()))
      )
      and is_hidden = false
      and not (autor_id = any ((select vicino_guard.bloqueados_conmigo())::uuid[]))
    )
  );

-- ---------------------------------------------------------------------------
-- VERIFY (ejercido, no leido). Todo dentro de BEGIN ... ROLLBACK.
--
-- 1. Reproducir R-01 con dos perfiles reales A y B (ninguno admin, ninguno
--    oculto). Antes de esta migracion, el ultimo SELECT daba 1.
--
--   BEGIN;
--   INSERT INTO public.user_blocks (blocker_id, blocked_id) VALUES ('<A>', '<B>');
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<B>","role":"authenticated"}';
--   SELECT count(*) AS b_ve_a_a FROM public.profiles WHERE id = '<A>';   -- 0
--   SELECT count(*) AS b_ve_productos_de_a
--     FROM public.products_services WHERE creador_id = '<A>';            -- 0
--   ROLLBACK;
--
-- 2. El otro sentido sigue funcionando (A no ve a B):
--
--   ... mismo INSERT, claims con sub = <A> ...
--   SELECT count(*) FROM public.profiles WHERE id = '<B>';               -- 0
--
-- 3. Sin bloqueo, todo visible; anon no cambia:
--
--   BEGIN; SET LOCAL ROLE anon;
--   SELECT count(*) > 0 FROM public.profiles WHERE is_hidden = false;   -- true
--   ROLLBACK;
--
-- 4. El helper no existe por REST y no es un oraculo:
--
--   SELECT has_schema_privilege('authenticated', 'vicino_guard', 'USAGE');      -- true
--   SELECT has_function_privilege('authenticated',
--     'vicino_guard.bloqueados_conmigo()', 'EXECUTE');                          -- true
--   SELECT has_table_privilege('authenticated',
--     'vicino_guard.spatial_ref_sys_backup', 'SELECT');                         -- false
--   -- y GET /rest/v1/rpc/bloqueados_conmigo responde 404: no esta en public.
--
-- 5. Es un InitPlan, no una llamada por fila:
--
--   SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '...';
--   EXPLAIN SELECT id FROM public.products_services WHERE estatus = 'disponible';
--   -- debe aparecer "InitPlan 1 (returns $0)" con bloqueados_conmigo, una vez.
-- ---------------------------------------------------------------------------
