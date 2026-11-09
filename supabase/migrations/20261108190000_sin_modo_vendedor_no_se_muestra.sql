-- Sin Modo Vendedor, una publicacion pausada no se vuelve a mostrar.
--
-- Por que (8-nov-2026, sondas en produccion dentro de BEGIN..ROLLBACK, con la
-- cuenta de prueba de la fase 1 de enlaces): desactivar Modo Vendedor pausa
-- las publicaciones disponibles (update_profile_and_pause_products) y la
-- policy de INSERT ya exige es_vendedor para publicar. La de UPDATE, en
-- cambio, solo pedia ser el dueno y no estar suspendido, y authenticated
-- tiene UPDATE sobre estatus. Resultado: con el modo apagado, la cuenta ponia
-- una pausada otra vez en 'disponible' (desde el menu de la ficha, que llama a
-- toggleProductStatus, o directo por PostgREST) y anon la veia en publico. El
-- aviso de desactivacion promete lo contrario.
--
-- Que hace: el WITH CHECK de "Sellers can update own products" exige ademas
-- que la fila resultante no quede 'disponible' salvo que el dueno tenga
-- es_vendedor = true. Es el mismo EXISTS sobre profiles que usa la policy de
-- INSERT. El USING no cambia: con el modo apagado la cuenta sigue pudiendo
-- editar, pausar o eliminar sus publicaciones; lo unico que ya no puede es
-- dejarlas visibles.
--
-- Comprobado antes de escribirla: 0 publicaciones 'disponible' de cuentas sin
-- Modo Vendedor, asi que ningun dueno se queda con una fila que ya no podria
-- editar sin pausarla.
--
-- Las funciones SECURITY DEFINER (la pausa al desactivar, la moderacion) no
-- pasan por la RLS y no cambian. La app da el mensaje claro antes de llegar
-- aqui (toggleProductStatus); esta es la llave que no depende del cliente.
--
-- Reversion: docs/rollback/20261108190000_sin_modo_vendedor_no_se_muestra_rollback.sql
-- Idempotente: ALTER POLICY deja la misma expresion cada vez.

-- Cambiar la policy toma un candado sobre products_services hasta el commit:
-- si no lo consigue en 5 s, la migracion aborta en vez de hacer fila.
SET LOCAL lock_timeout = '5s';

ALTER POLICY "Sellers can update own products" ON public.products_services
  WITH CHECK (
    ((SELECT auth.uid()) = creador_id)
    AND (NOT (SELECT vicino_guard.cuenta_suspendida()))
    AND (
      estatus IS DISTINCT FROM 'disponible'::public.listing_status
      OR EXISTS (
        SELECT 1
          FROM public.profiles
         WHERE profiles.id = (SELECT auth.uid())
           AND profiles.es_vendedor = true
      )
    )
  );

-- VERIFY (despues de aplicar):
--
--   SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
--    WHERE polrelid = 'public.products_services'::regclass
--      AND polname = 'Sellers can update own products';
--   -- esperado: la expresion menciona es_vendedor y 'disponible'
--
--   SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
--    WHERE polrelid = 'public.products_services'::regclass
--      AND polname = 'Sellers can update own products';
--   -- esperado: sin cambios, (( SELECT auth.uid() AS uid) = creador_id)
--
--   Bajo rol real, con una cuenta de prueba que tenga una publicacion
--   disponible (BEGIN; SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';):
--     SELECT public.update_profile_and_pause_products('<uuid>', '<nombre>', NULL, NULL, NULL, false, 'casual', NULL, NULL, NULL);
--     -- esperado: products_paused >= 1
--     UPDATE public.products_services SET estatus = 'disponible'
--      WHERE creador_id = '<uuid>' AND estatus = 'pausado';
--     -- esperado: 42501 new row violates row-level security policy
--   ROLLBACK;
--   Con el modo encendido, el mismo UPDATE sobre una pausada propia: 1 fila.
