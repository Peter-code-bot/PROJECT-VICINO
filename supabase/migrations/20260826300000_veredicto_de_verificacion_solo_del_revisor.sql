-- El solicitante puede escribir el veredicto de su propia verificacion.
--
-- No el estado —eso ya esta cerrado desde esta manana y comprobado: un usuario
-- sin rol admin que intenta pasar su tramite a 'approved' recibe 42501 por la
-- policy. Lo que sigue abierto son los campos que sostienen ESE veredicto:
--
--   ai_confidence_score   la confianza que reporto el modelo
--   ai_analysis_raw       la respuesta cruda del modelo
--   reviewed_at           cuando se reviso
--   reviewer_note         la nota de quien reviso
--
-- authenticated tiene INSERT y UPDATE sobre las cuatro. Comprobado
-- explotandolo bajo rol real, con una cuenta SIN admin, en transaccion
-- revertida: pudo poner ai_confidence_score = 99 en su propio tramite.
--
-- Por que importa aunque no cambie el estado: eso es lo que ve el moderador
-- para decidir. Un tramite pendiente que dice "la IA le dio 99" y trae una
-- nota de revision con fecha se lee como ya revisado y casi aprobado. No
-- fuerza la aprobacion; fabrica la evidencia con la que se aprueba, que a
-- efectos practicos es peor porque no deja huella de manipulacion.
--
-- Comprobado antes de revocar que el camino legitimo no se rompe: el veredicto
-- de la IA lo escribe apps/web/app/actions/verify-document.ts con
-- createAdminClient(), o sea service_role, desde el cambio de hoy. Y los
-- admins escriben por la policy "Admin can manage verifications" con su propio
-- GRANT. Ninguno de los dos depende de estos privilegios de authenticated.
--
-- Lo que el solicitante SI necesita seguir escribiendo queda intacto: sus tres
-- URL de documento, el tipo, la universidad, el estado (limitado a 'pending'
-- por la policy) y las marcas de tiempo propias del alta.

REVOKE INSERT (ai_confidence_score, ai_analysis_raw, reviewed_at, reviewer_note)
  ON public.seller_verification FROM authenticated;

REVOKE UPDATE (ai_confidence_score, ai_analysis_raw, reviewed_at, reviewer_note)
  ON public.seller_verification FROM authenticated;

-- anon no deberia tener nada aqui, pero se revoca por si acaso: hoy ya se vio
-- que ALTER DEFAULT PRIVILEGES de Supabase concede a anon de forma explicita, y
-- que un REVOKE ... FROM PUBLIC no se lo quita.
REVOKE ALL ON TABLE public.seller_verification FROM anon;

-- VERIFY:
--   SELECT privilege_type, string_agg(column_name, ', ' ORDER BY column_name)
--     FROM information_schema.column_privileges
--    WHERE table_name='seller_verification' AND grantee='authenticated'
--      AND privilege_type IN ('INSERT','UPDATE')
--    GROUP BY 1;
--   -- NO deben aparecer ai_confidence_score, ai_analysis_raw, reviewed_at
--   --  ni reviewer_note. SI deben seguir: document_type, ine_back_url,
--   --  ine_front_url, selfie_url, status, university_name, user_id y las
--   --  marcas de tiempo.
