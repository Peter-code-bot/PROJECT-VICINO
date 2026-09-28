-- Quien resena ya no puede escribir columnas que no le tocan en el INSERT.
--
-- Hallazgo S08 (revision del 27-sep-2026, confirmado en solo lectura en prod):
-- authenticated tenia INSERT de TABLA sobre public.reviews, y la policy
-- «Participants can create reviews on completed sales» comprueba quien resena,
-- la venta y a quien, pero no el resto de columnas. Un comprador con una venta
-- completada podia insertar:
--   - respuesta / respuesta_fecha: el vendedor veia «Tu respuesta: ...» que
--     nunca escribio, y su formulario para responder desaparecia;
--   - created_at: la resena contaba en otro mes del ranking (rating_stats
--     filtra por r.created_at);
--   - product_id de OTRO producto: Mis Resenas y la ficha la enlazaban mal.
-- (is_hidden lo reescribe trg_reviews_sync_visibility, asi que ese no.)
--
-- Arreglo:
--   1) INSERT solo de las columnas que escribe la app
--      (app/(account)/historial/review/review-form.tsx).
--   2) La policy exige ademas que product_id sea el de la venta. La app ya lo
--      manda asi: la pagina de resena lo toma de sale_confirmations.product_id
--      (commit del 27-sep).
-- El UPDATE de respuesta/respuesta_fecha (responder como vendedor) no cambia.
--
-- Reversion: docs/rollback/20260927160000_resenas_sin_columnas_forjables_rollback.sql
-- Idempotente.

REVOKE INSERT ON public.reviews FROM authenticated, anon;
GRANT INSERT (sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, comentario, fotos)
  ON public.reviews TO authenticated;

ALTER POLICY "Participants can create reviews on completed sales" ON public.reviews
  WITH CHECK (
    ((SELECT auth.uid()) = reviewer_id)
    AND EXISTS (
      SELECT 1 FROM public.sale_confirmations sc
       WHERE sc.id = reviews.sale_confirmation_id
         AND sc.status = 'completed'::public.sale_status
         AND sc.product_id = reviews.product_id
         AND (
           (reviews.review_type = 'buyer_to_seller'::public.review_type
              AND sc.buyer_id = (SELECT auth.uid()) AND sc.seller_id = reviews.reviewed_id)
           OR
           (reviews.review_type = 'seller_to_buyer'::public.review_type
              AND sc.seller_id = (SELECT auth.uid()) AND sc.buyer_id = reviews.reviewed_id)
         )
    )
    AND NOT (SELECT vicino_guard.cuenta_suspendida())
  );

DO $verify$
BEGIN
  IF has_column_privilege('authenticated', 'public.reviews', 'respuesta', 'INSERT')
     OR has_column_privilege('authenticated', 'public.reviews', 'respuesta_fecha', 'INSERT')
     OR has_column_privilege('authenticated', 'public.reviews', 'created_at', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated sigue pudiendo insertar respuesta/respuesta_fecha/created_at';
  END IF;
  IF NOT (has_column_privilege('authenticated', 'public.reviews', 'product_id', 'INSERT')
          AND has_column_privilege('authenticated', 'public.reviews', 'rating', 'INSERT')
          AND has_column_privilege('authenticated', 'public.reviews', 'fotos', 'INSERT')) THEN
    RAISE EXCEPTION 'se revoco de mas: el formulario de resena dejaria de funcionar';
  END IF;
  -- Responder como vendedor sigue siendo un UPDATE permitido.
  IF NOT has_column_privilege('authenticated', 'public.reviews', 'respuesta', 'UPDATE') THEN
    RAISE EXCEPTION 'se perdio el UPDATE de respuesta';
  END IF;
  IF position('product_id' in (SELECT pg_get_expr(polwithcheck, polrelid) FROM pg_policy
                               WHERE polrelid = 'public.reviews'::regclass
                                 AND polname = 'Participants can create reviews on completed sales')) = 0 THEN
    RAISE EXCEPTION 'la policy de INSERT no comprueba product_id';
  END IF;
END
$verify$;
