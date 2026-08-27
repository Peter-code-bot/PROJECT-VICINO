-- Lo que se le revoca a PUBLIC, no a los inquilinos
--
-- El 20 de marzo, 20260320000019_account_deletion.sql cerro su archivo asi:
--
--   GRANT EXECUTE ON FUNCTION public.delete_user_data(UUID) TO service_role;
--   REVOKE EXECUTE ON FUNCTION public.delete_user_data(UUID) FROM anon, authenticated;
--
-- Se aplico. Esta en el ledger. Y no cerro absolutamente nada.
--
-- El motivo es que en Postgres una funcion nace con EXECUTE concedido a
-- PUBLIC, y PUBLIC no es un rol al que se le pueda revocar por separado: es
-- todo el mundo, incluidos anon y authenticated. Revocarles a ellos quita un
-- permiso propio que nunca tuvieron, mientras el de PUBLIC sigue en pie. El
-- ACL de la funcion lo dice sin ambiguedad:
--
--   {=X/postgres, postgres=X/postgres, service_role=X/postgres}
--     ^^^^^^^^^^ esto es PUBLIC, y este es el que habia que quitar
--
-- Consecuencia, comprobada ejerciendola contra produccion dentro de un
-- ROLLBACK: con SET LOCAL ROLE anon, delete_user_data borro el perfil, los
-- productos, los chats, los mensajes y las imagenes de la cuenta objetivo y
-- devolvio {"success": true}. La anon key es publica por diseno (viaja en el
-- bundle del navegador) y los uuid de perfil se leen del propio marketplace,
-- asi que cualquiera con un navegador podia destruir la cuenta de cualquiera.
--
-- La guardia de dentro tampoco ayudaba, porque fallaba ABIERTA:
--   IF auth.uid() IS NOT NULL AND auth.uid() != target_user_id THEN RAISE
-- Para un anonimo auth.uid() es NULL, la condicion es falsa, y la ejecucion
-- seguia derecha a los DELETE. Se arregla aqui tambien: dos capas, porque la
-- de permisos ya demostro una vez que se puede aplicar y no surtir efecto.
--
-- Se aprovecha para las otras tres de la misma familia, encontradas mirando
-- que mas alcanza anon:
--
--   cleanup_old_deletion_logs()   sin guardia ninguna. Borra el registro de
--                                 auditoria de bajas de cuenta. Un anonimo
--                                 podia vaciar la evidencia de las bajas.
--   recompute_seller_rankings()   sin guardia. Recalculo caro y repetible a
--   recompute_seller_rankings_for_category()
--                                 voluntad; solo la llama la Edge Function
--                                 recompute-rankings, con service_role.
--   resolve_dispute_admin()       si tiene guardia por auth.uid(), pero no
--                                 hay razon para que anon llegue siquiera a
--                                 tocarla. La llama el panel de admin con la
--                                 sesion del usuario, asi que authenticated
--                                 se conserva.
--
-- Y esta migracion COMPRUEBA SU PROPIO TRABAJO al final. La de marzo se dio
-- por buena sin mirar si habia servido, y por eso el agujero vivio cinco
-- meses con una linea en el ledger diciendo que estaba cerrado.

-- ---------------------------------------------------------------------------
-- 1. La guardia deja de fallar abierta
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.delete_user_data(target_user_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  deleted_summary JSONB := '{}'::JSONB;
  cnt INTEGER;
BEGIN
  -- Only allow if caller is service_role or the user themselves.
  --
  -- La linea de abajo se conserva tal cual estaba: un usuario CON sesion no
  -- puede borrar a otro. Lo que faltaba era la otra mitad.
  IF auth.uid() IS NOT NULL AND auth.uid() != target_user_id THEN
    RAISE EXCEPTION 'Unauthorized: cannot delete another user''s data'
      USING ERRCODE = '42501';
  END IF;

  -- LA MITAD QUE FALTABA. auth.uid() es NULL para service_role, si, pero
  -- tambien lo es para anon. La condicion de arriba, por si sola, es falsa
  -- cuando auth.uid() es NULL, asi que un anonimo no entraba nunca al RAISE
  -- y seguia derecho a los DELETE. Comprobado ejerciendolo: con SET LOCAL
  -- ROLE anon la funcion borro el perfil entero (dentro de un ROLLBACK).
  --
  -- Ahora el permiso sin sesion se comprueba, no se deduce de un NULL.
  -- session_user es 'authenticator' cuando la llamada entra por PostgREST y
  -- 'postgres' cuando entra por SQL directo, asi que el mantenimiento manual
  -- sigue siendo posible sin dejar abierta la puerta de la API.
  IF auth.uid() IS NULL
     AND coalesce(current_setting('request.jwt.claims', true)::jsonb ->> 'role', '') <> 'service_role'
     AND session_user <> 'postgres' THEN
    RAISE EXCEPTION 'Unauthorized: sin sesion propia esta funcion solo la puede llamar service_role'
      USING ERRCODE = '42501';
  END IF;

  -- Messages authored by user
  DELETE FROM public.messages WHERE autor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('messages', cnt);

  -- Chats where user is buyer or seller
  DELETE FROM public.chats
    WHERE comprador_id = target_user_id OR vendedor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('chats', cnt);

  -- Favorites
  DELETE FROM public.favorites WHERE usuario_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('favorites', cnt);

  -- Reviews authored by user
  DELETE FROM public.reviews WHERE reviewer_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('reviews_authored', cnt);

  -- Reviews about user's products: delete (the product is being removed,
  -- so the review loses its subject). reviews.product_id is NO ACTION,
  -- so this MUST happen before deleting products_services.
  DELETE FROM public.reviews
    WHERE product_id IN (
      SELECT id FROM public.products_services WHERE creador_id = target_user_id
    );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('reviews_on_user_products', cnt);

  -- Remaining reviews where user was reviewed: anonymize (keeps community
  -- reputation context). reviewed_id becomes NULL via ON DELETE SET NULL,
  -- but we set it explicitly + stamp anonymized_at for clarity.
  UPDATE public.reviews
    SET reviewed_id = NULL,
        anonymized_at = NOW()
    WHERE reviewed_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('reviews_received_anonymized', cnt);

  -- Sale confirmations (English column names in this table)
  DELETE FROM public.sale_confirmations
    WHERE buyer_id = target_user_id OR seller_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('sale_confirmations', cnt);

  -- Coupons
  DELETE FROM public.coupons WHERE vendedor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('coupons', cnt);

  -- Disputes
  DELETE FROM public.disputes
    WHERE reporter_id = target_user_id OR reported_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('disputes', cnt);

  -- Notifications
  DELETE FROM public.notifications WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('notifications', cnt);

  -- Verifications (seller + trust)
  DELETE FROM public.seller_verification WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('seller_verifications', cnt);

  DELETE FROM public.trust_level_verification WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('trust_verifications', cnt);

  -- Bookings
  DELETE FROM public.bookings
    WHERE comprador_id = target_user_id OR vendedor_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('bookings', cnt);

  -- Service availability (via user's listings)
  DELETE FROM public.service_availability
    WHERE servicio_id IN (
      SELECT id FROM public.products_services WHERE creador_id = target_user_id
    );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('service_availability', cnt);

  -- Product variants (via user's products)
  DELETE FROM public.product_variants
    WHERE producto_id IN (
      SELECT id FROM public.products_services WHERE creador_id = target_user_id
    );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('product_variants', cnt);

  -- Media assets for user's products/services
  DELETE FROM public.media_assets
    WHERE owner_type IN ('producto', 'servicio')
      AND owner_id IN (
        SELECT id FROM public.products_services WHERE creador_id = target_user_id
      );
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('media_assets_products', cnt);

  -- Media assets for user's profile
  DELETE FROM public.media_assets
    WHERE owner_type = 'profile' AND owner_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('media_assets_profile', cnt);

  -- Products and services
  DELETE FROM public.products_services WHERE creador_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('products_services', cnt);

  -- Roles
  DELETE FROM public.user_roles WHERE user_id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('user_roles', cnt);

  -- Profile (last, before auth.users)
  DELETE FROM public.profiles WHERE id = target_user_id;
  GET DIAGNOSTICS cnt = ROW_COUNT;
  deleted_summary := deleted_summary || jsonb_build_object('profile', cnt);

  -- Audit log
  INSERT INTO public.account_deletion_log (
    deleted_user_id,
    deleted_at,
    summary
  ) VALUES (
    target_user_id,
    NOW(),
    deleted_summary
  );

  RETURN jsonb_build_object(
    'success', true,
    'user_id', target_user_id,
    'deleted_at', NOW(),
    'summary', deleted_summary
  );
END;
$function$
;
-- ---------------------------------------------------------------------------
-- 2. Quitarle el permiso a PUBLIC, que es quien lo tenia
-- ---------------------------------------------------------------------------

REVOKE EXECUTE ON FUNCTION public.delete_user_data(uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.delete_user_data(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.cleanup_old_deletion_logs() FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.cleanup_old_deletion_logs() TO service_role;

REVOKE EXECUTE ON FUNCTION public.recompute_seller_rankings(text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_seller_rankings(text) TO service_role;

REVOKE EXECUTE ON FUNCTION public.recompute_seller_rankings_for_category(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.recompute_seller_rankings_for_category(uuid, text) TO service_role;

-- Esta conserva authenticated a proposito: la llama apps/web/app/admin/disputes/actions.ts
-- con la sesion del usuario, y la funcion ya comprueba el rol por dentro.
REVOKE EXECUTE ON FUNCTION public.resolve_dispute_admin(uuid, dispute_status, text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.resolve_dispute_admin(uuid, dispute_status, text) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. Comprobar que sirvio de algo
--
-- Una migracion que se aplica sin surtir efecto es peor que no tenerla: deja
-- una linea en el ledger que dice que el problema esta resuelto. Si algo de
-- lo de arriba no cuajo, esto revienta y la transaccion entera se deshace.
-- ---------------------------------------------------------------------------

DO $comprobacion$
DECLARE
  abiertas text[];
BEGIN
  SELECT array_agg(f.firma ORDER BY f.firma) INTO abiertas
  FROM (
    VALUES
      ('public.delete_user_data(uuid)'),
      ('public.cleanup_old_deletion_logs()'),
      ('public.recompute_seller_rankings(text)'),
      ('public.recompute_seller_rankings_for_category(uuid, text)'),
      ('public.resolve_dispute_admin(uuid, dispute_status, text)')
  ) AS f(firma)
  WHERE has_function_privilege('anon', f.firma::regprocedure, 'EXECUTE');

  IF abiertas IS NOT NULL THEN
    RAISE EXCEPTION 'anon sigue pudiendo ejecutar: %', array_to_string(abiertas, ', ')
      USING ERRCODE = '42501';
  END IF;

  IF has_function_privilege('authenticated', 'public.delete_user_data(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated sigue pudiendo ejecutar delete_user_data'
      USING ERRCODE = '42501';
  END IF;

  IF NOT has_function_privilege('service_role', 'public.delete_user_data(uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'service_role perdio el EXECUTE de delete_user_data: la Edge Function delete-account dejaria de funcionar';
  END IF;

  IF NOT has_function_privilege('authenticated', 'public.resolve_dispute_admin(uuid, dispute_status, text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated perdio el EXECUTE de resolve_dispute_admin: el panel de disputas dejaria de funcionar';
  END IF;
END
$comprobacion$;
