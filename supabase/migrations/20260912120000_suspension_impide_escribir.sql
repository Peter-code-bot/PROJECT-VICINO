-- R-05: suspender a alguien lo escondia, no lo detenia.
--
-- profiles.is_hidden = true saca a la persona de los feeds (las policies
-- block_aware_* y las RPC nearby la filtran), pero ninguna policy de
-- escritura del proyecto miraba esa columna. Una cuenta suspendida desde el
-- panel seguia pudiendo publicar productos, abrir solicitudes, ofertar,
-- resenar, agendar citas, iniciar confirmaciones de venta y mandar mensajes.
-- La rama de comunidades cierra esto solo para sus propias tablas.
--
-- ARREGLO. Un helper SECURITY DEFINER, vicino_guard.cuenta_suspendida(), que
-- dice si QUIEN LLAMA esta oculto, consumido como InitPlan en el WITH CHECK
-- de las policies de INSERT y UPDATE de las superficies que producen
-- contenido o abren tratos. Va en WITH CHECK y no en USING a proposito: en
-- un UPDATE, poner la condicion en USING hace que el UPDATE afecte 0 filas
-- SIN error (y este proyecto ya aprendio que un 204 sin filas se lee como
-- exito); en WITH CHECK el motor responde 42501 y el fallo se oye.
--
-- POR QUE UN HELPER Y NO `profiles.is_hidden` DIRECTO EN LA POLICY. profiles
-- tiene grants POR COLUMNA (ver memoria del proyecto): la policy correria la
-- subconsulta como el rol que escribe, y aunque hoy is_hidden tiene GRANT
-- SELECT, cualquier cambio futuro de grants rompia TODOS los INSERT con un
-- 42501 que parece de la tabla destino. El DEFINER no depende de los grants
-- de profiles. Vive en vicino_guard por lo mismo que bloqueados_conmigo()
-- (20260912100000): no es un endpoint REST.
--
-- QUE NO SE TOCA. reports (una cuenta suspendida puede seguir reportando;
-- lo modera el panel), favorites y user_blocks (no producen contenido), y
-- las RPC SECURITY DEFINER existentes (update_profile_and_pause_products,
-- activar_modo_vendedor, get_or_create_chat), que escriben profiles o chats
-- y no publican nada visible. get_or_create_chat recibe su propia guardia en
-- 20260912130000.
--
-- Las expresiones de abajo son las vivas (pg_policies, 12-sep-2026) con la
-- clausula nueva al final. Se re-emiten completas porque ALTER POLICY ...
-- WITH CHECK sustituye la expresion entera.
-- ---------------------------------------------------------------------------

create schema if not exists vicino_guard;

create or replace function vicino_guard.cuenta_suspendida()
returns boolean
language sql
stable
security definer
set search_path to ''
as $function$
  select coalesce(
    (select p.is_hidden from public.profiles p where p.id = (select auth.uid())),
    false
  );
$function$;

comment on function vicino_guard.cuenta_suspendida() is
  'true si el perfil de quien llama esta oculto (suspendido desde el panel). SECURITY DEFINER para no depender de los grants por columna de profiles. Las policies de escritura la consumen como InitPlan en su WITH CHECK: NOT (select vicino_guard.cuenta_suspendida()). Para anon devuelve false.';

revoke all on function vicino_guard.cuenta_suspendida() from public;
grant usage on schema vicino_guard to anon, authenticated;
grant execute on function vicino_guard.cuenta_suspendida() to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 1. products_services
-- ---------------------------------------------------------------------------
alter policy "Sellers can create products" on public.products_services
  with check (
    (select auth.uid()) = creador_id
    and exists (
      select 1 from public.profiles
       where profiles.id = (select auth.uid()) and profiles.es_vendedor = true
    )
    and not (select vicino_guard.cuenta_suspendida())
  );

alter policy "Sellers can update own products" on public.products_services
  with check (
    (select auth.uid()) = creador_id
    and not (select vicino_guard.cuenta_suspendida())
  );

-- ---------------------------------------------------------------------------
-- 2. purchase_requests (policies TO public: anon evalua y el helper le da false)
-- ---------------------------------------------------------------------------
alter policy "purchase_requests_insert" on public.purchase_requests
  with check (
    auth.uid() is not null
    and buyer_id = auth.uid()
    and not (select vicino_guard.cuenta_suspendida())
  );

alter policy "purchase_requests_update" on public.purchase_requests
  with check (
    buyer_id = auth.uid()
    and not (select vicino_guard.cuenta_suspendida())
  );

-- ---------------------------------------------------------------------------
-- 3. request_responses
-- ---------------------------------------------------------------------------
alter policy "request_responses_insert" on public.request_responses
  with check (
    auth.uid() is not null
    and seller_id = auth.uid()
    and exists (
      select 1 from public.purchase_requests pr
       where pr.id = request_responses.request_id
         and pr.status = 'open'::public.request_status
         and pr.expires_at > now()
         and pr.buyer_id <> auth.uid()
    )
    and not (select vicino_guard.cuenta_suspendida())
  );

alter policy "request_responses_update" on public.request_responses
  with check (
    seller_id = auth.uid()
    and not (select vicino_guard.cuenta_suspendida())
  );

-- ---------------------------------------------------------------------------
-- 4. reviews
-- ---------------------------------------------------------------------------
alter policy "Participants can create reviews on completed sales" on public.reviews
  with check (
    (select auth.uid()) = reviewer_id
    and exists (
      select 1 from public.sale_confirmations sc
       where sc.id = reviews.sale_confirmation_id
         and sc.status = 'completed'::public.sale_status
         and (
           (reviews.review_type = 'buyer_to_seller'::public.review_type
              and sc.buyer_id = (select auth.uid())
              and sc.seller_id = reviews.reviewed_id)
           or
           (reviews.review_type = 'seller_to_buyer'::public.review_type
              and sc.seller_id = (select auth.uid())
              and sc.buyer_id = reviews.reviewed_id)
         )
    )
    and not (select vicino_guard.cuenta_suspendida())
  );

alter policy "Reviewed user can respond" on public.reviews
  with check (
    (select auth.uid()) = reviewed_id
    and not (select vicino_guard.cuenta_suspendida())
  );

-- ---------------------------------------------------------------------------
-- 5. messages
-- ---------------------------------------------------------------------------
alter policy "Participants can send messages" on public.messages
  with check (
    (select auth.uid()) = autor_id
    and exists (
      select 1 from public.chats
       where chats.id = messages.chat_id
         and (chats.comprador_id = (select auth.uid())
              or chats.vendedor_id = (select auth.uid()))
    )
    and not (select vicino_guard.cuenta_suspendida())
  );

-- ---------------------------------------------------------------------------
-- 6. appointments
-- ---------------------------------------------------------------------------
alter policy "Buyers can book appointments" on public.appointments
  with check (
    (select auth.uid()) = buyer_id
    and buyer_id <> seller_id
    and exists (
      select 1 from public.products_services p
       where p.id = appointments.product_id
         and p.creador_id = appointments.seller_id
         and p.allow_appointments = true
         and p.estatus = 'disponible'::public.listing_status
         and p.is_hidden = false
    )
    and not (select vicino_guard.cuenta_suspendida())
  );

-- ---------------------------------------------------------------------------
-- 7. sale_confirmations (solo INICIAR; confirmar o cancelar una en curso
--    sigue abierto para las dos partes, porque bloquearlo dejaria a la parte
--    no suspendida atrapada en un trato que no puede cerrar ni cancelar)
-- ---------------------------------------------------------------------------
alter policy "Participants can create confirmations" on public.sale_confirmations
  with check (
    (select auth.uid()) = initiated_by
    and ((select auth.uid()) = buyer_id or (select auth.uid()) = seller_id)
    and not (select vicino_guard.cuenta_suspendida())
  );

-- ---------------------------------------------------------------------------
-- VERIFY (dentro de BEGIN ... ROLLBACK). Se suspende un perfil real de
-- prueba SOLO dentro de la transaccion y se ejerce cada superficie con
-- SET LOCAL ROLE authenticated. Cada INSERT/UPDATE debe morir con 42501.
--
--   BEGIN;
--   UPDATE public.profiles SET is_hidden = true WHERE id = '<X>';
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<X>","role":"authenticated"}';
--   SELECT vicino_guard.cuenta_suspendida();                                   -- true
--   INSERT INTO public.purchase_requests (buyer_id, title, status, expires_at)
--   VALUES ('<X>', 'no deberia entrar', 'open', now() + interval '1 day');     -- 42501
--   ROLLBACK;
--
--   -- y la misma cuenta SIN suspender entra (la policy no rompio el camino bueno):
--   BEGIN; SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '...<X>...';
--   INSERT INTO public.purchase_requests (...) VALUES (...);                    -- 1 fila
--   ROLLBACK;
--
--   -- las once policies llevan la clausula:
--   SELECT count(*) FROM pg_policies
--    WHERE with_check ILIKE '%cuenta_suspendida%';                             -- 11
--
--   -- anon sigue sin poder escribir y sin morir por falta de EXECUTE:
--   BEGIN; SET LOCAL ROLE anon; SELECT vicino_guard.cuenta_suspendida(); ROLLBACK;  -- false
-- ---------------------------------------------------------------------------
