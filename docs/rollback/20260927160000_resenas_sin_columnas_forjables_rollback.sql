-- Reversion de 20260927160000_resenas_sin_columnas_forjables. Se corre a mano.
-- ADVERTENCIA: vuelve a permitir que quien resena inserte respuesta,
-- respuesta_fecha, created_at y un product_id ajeno. Es la definicion que tenia
-- produccion el 27-sep-2026 (policy de 20260912120000).

begin;

REVOKE INSERT (sale_confirmation_id, product_id, reviewer_id, reviewed_id, review_type, rating, comentario, fotos)
  ON public.reviews FROM authenticated;
GRANT INSERT ON public.reviews TO authenticated;

ALTER POLICY "Participants can create reviews on completed sales" ON public.reviews
  WITH CHECK (
    ((SELECT auth.uid()) = reviewer_id)
    AND EXISTS (
      SELECT 1 FROM public.sale_confirmations sc
       WHERE sc.id = reviews.sale_confirmation_id
         AND sc.status = 'completed'::public.sale_status
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

commit;
