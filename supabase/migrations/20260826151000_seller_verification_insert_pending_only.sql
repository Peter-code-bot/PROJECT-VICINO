-- Cierra la otra mitad del mismo agujero: el INSERT.
--
-- 20260826150000 acoto el UPDATE del usuario a status 'pending', y funciona:
-- un vendedor normal que intenta ponerse 'approved' recibe
-- "new row violates row-level security policy".
--
-- Pero la policy de INSERT, "Users can submit verification", solo comprobaba
-- WITH CHECK (auth.uid() = user_id), sin decir nada de status. Verificado
-- contra produccion en transaccion revertida: un usuario sin rol pudo hacer
--
--   INSERT INTO seller_verification (user_id, ine_front_url, status,
--                                    document_type, university_name)
--   VALUES ('<su propio uuid>','doc.jpg','approved',
--           'Credencial Universitaria','BUAP');
--
-- y la fila nacio aprobada. Cerrar solo el UPDATE no servia de nada: bastaba
-- con crear una fila nueva ya aprobada, y la app lee la mas reciente.
--
-- Mismo criterio y misma forma que la migracion anterior: el usuario puede
-- declarar sus documentos, nunca el veredicto. status queda en 'pending' o
-- nulo, y en ese caso el DEFAULT de la columna ('pending') se encarga.
--
-- No rompe el alta: verification-upload.tsx escribe status 'pending' explicito.

ALTER POLICY "Users can submit verification"
  ON public.seller_verification
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (status IS NULL OR status = 'pending'::verification_status)
  );

-- VERIFY (transaccion revertida, con un uuid SIN rol admin ni moderator):
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--     INSERT INTO public.seller_verification (user_id, ine_front_url, status)
--     VALUES ('<uuid>','doc.jpg','approved');
--   ROLLBACK;
--   -- esperado: new row violates row-level security policy
--
--   Y con status 'pending' o sin especificarlo, debe funcionar.
