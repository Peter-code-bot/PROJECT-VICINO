-- Un vendedor podia aprobarse su propia verificacion de identidad.
--
-- La policy "Users can update own verification" tenia USING (auth.uid() =
-- user_id) y NINGUN with_check, y `status` era escribible por authenticated.
-- Comprobado contra produccion en una transaccion revertida:
--
--   BEGIN;
--   SET LOCAL ROLE authenticated;
--   SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--   UPDATE public.seller_verification
--      SET status='approved', reviewed_at=now(), reviewer_note='me apruebo yo solo'
--    WHERE user_id='<uuid>';
--   -- devolvio status=approved
--   ROLLBACK;
--
-- QUE TAN GRAVE ES, con precision:
--   NO da la insignia de verificado. profiles.is_verified solo lo escribe
--   approve_verification_atomic, que es SECURITY DEFINER y exige admin.
--   SI da acceso al feed segmentado por universidad: apps/web/app/(marketplace)/
--   page.tsx:164-186 arma ese feed con seller_verification donde status =
--   'approved' y document_type = 'Credencial Universitaria'. Cualquiera podia
--   auto-aprobarse declarando la universidad que quisiera y entrar a ese feed.
--   Ademas ensuciaba reviewed_at y reviewer_note, que son rastro de moderacion.
--
-- EL ARREGLO: un WITH CHECK que acota el resultado del UPDATE del usuario a
-- status 'pending'. Se usa ALTER POLICY, no DROP + CREATE: cambia la definicion
-- sin destruir nada y es reversible con otro ALTER.
--
-- Por que esto no rompe los dos caminos legitimos:
--   - Subir documentos: verification-upload.tsx escribe status 'pending'
--     explicitamente. Sigue pasando. Y un vendedor rechazado que vuelve a subir
--     documentos regresa a 'pending', que es justo lo que debe ocurrir.
--   - Admin: la policy "Admin can manage verifications" es FOR ALL y las
--     policies permissive se combinan con OR, asi que un admin sigue pudiendo
--     poner 'approved' o 'rejected'.
--   - Veredicto de la IA: verify-document.ts pasa a escribir con el cliente
--     admin (service_role), que no pasa por RLS. Ese cambio va en el mismo
--     commit y es inseparable de este: sin el, la IA dejaria de poder aprobar.

ALTER POLICY "Users can update own verification"
  ON public.seller_verification
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK (
    (SELECT auth.uid()) = user_id
    AND (status IS NULL OR status = 'pending'::verification_status)
  );

-- ---------------------------------------------------------------------------
-- Higiene: anon no tiene nada que hacer escribiendo en una tabla de documentos
-- de identidad.
--
-- La ACL decia anon=arwdDxtm/postgres: INSERT, UPDATE, DELETE y TRUNCATE
-- incluidos. Hoy la RLS lo frena — todas las policies exigen auth.uid(), que
-- para anon es NULL — asi que esto no cierra ningun agujero abierto: quita un
-- privilegio que nadie usa y que solo puede hacer daño el dia que alguien
-- agregue una policy permissive sin pensar en anon.
--
-- Se conserva SELECT por prudencia: la RLS ya lo filtra y no quiero descubrir
-- desde aqui que alguna superficie publica lo lee.
-- ---------------------------------------------------------------------------

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE public.seller_verification FROM anon;

-- VERIFY:
--   1. Auto-aprobarse ya no funciona (transaccion revertida):
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--        UPDATE public.seller_verification SET status='approved' WHERE user_id='<uuid>';
--      ROLLBACK;
--      -- esperado: new row violates row-level security policy
--
--   2. Volver a 'pending' SI funciona (es como se resubmite tras un rechazo):
--      ... SET status='pending', ine_front_url='...' ...   -- esperado: OK
--
--   3. anon ya no escribe:
--      SELECT has_table_privilege('anon','public.seller_verification','UPDATE');
--      -- esperado: false
