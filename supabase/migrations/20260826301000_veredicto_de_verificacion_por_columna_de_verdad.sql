-- La migracion anterior (20260826300000) NO HIZO NADA. Esta si.
--
-- Aquella revocaba por COLUMNA los cuatro campos del veredicto. Comprobado
-- despues de aplicarla: seguian todos ahi. El motivo es el mismo que ya se pago
-- esta manana con profiles (item 133): un REVOKE por columna es un NO-OP
-- SILENCIOSO cuando el privilegio esta concedido a nivel de TABLA, porque el
-- privilegio de tabla cubre todas las columnas y no hay nada por columna que
-- quitar.
--
-- Se deja aquella migracion en el historial en vez de borrarla: describe un
-- intento real y la leccion vale mas escrita que escondida.
--
-- authenticated tiene hoy, a nivel de TABLA: SELECT, INSERT, UPDATE, DELETE,
-- TRUNCATE, REFERENCES y TRIGGER sobre seller_verification.
--
-- Lo que se cierra:
--
--   ai_confidence_score, ai_analysis_raw, reviewed_at, reviewer_note
--     Son el VEREDICTO y su evidencia. Comprobado explotandolo bajo rol real
--     con una cuenta SIN admin, en transaccion revertida: podia poner
--     ai_confidence_score = 99 en su propio tramite. No cambia el estado —eso
--     ya lo bloquea la policy, y tambien se comprobo— pero fabrica la
--     evidencia con la que el moderador decide. Un tramite pendiente que dice
--     "la IA le dio 99" y trae nota de revision con fecha se lee como ya
--     revisado. Eso es peor que forzar el estado, porque no deja huella.
--
--   DELETE
--     Ningun camino del producto borra filas de esta tabla: quitar un documento
--     hace UPDATE poniendo la URL a NULL (verification-upload.tsx). Un
--     privilegio que nadie usa solo puede hacer dano el dia que alguien anada
--     una policy sin pensar en quien tiene el GRANT.
--
--   TRUNCATE
--     Este es el importante. TRUNCATE NO ESTA SUJETO A ROW LEVEL SECURITY: no
--     filtra filas, las borra todas. Hoy no es alcanzable porque PostgREST no
--     expone TRUNCATE y ninguna funcion lo llama, pero es el mismo patron que
--     spatial_ref_sys, y ese sigue abierto justamente porque se descubrio
--     tarde.
--
-- Comprobado antes de revocar que no se rompe ningun camino legitimo:
--   - El veredicto de la IA lo escribe verify-document.ts con
--     createAdminClient(), o sea service_role.
--   - Los admins escriben por la policy "Admin can manage verifications".
--   - El solicitante escribe exactamente estas siete columnas, leidas de
--     verification-upload.tsx lineas 206-222 y 281-285: user_id, status,
--     document_type, university_name, submitted_at, ine_front_url,
--     ine_back_url, selfie_url.

REVOKE INSERT, UPDATE, DELETE, TRUNCATE
  ON TABLE public.seller_verification FROM authenticated;

GRANT INSERT (
  user_id, status, document_type, university_name, submitted_at,
  ine_front_url, ine_back_url, selfie_url
) ON public.seller_verification TO authenticated;

GRANT UPDATE (
  status, document_type, university_name, submitted_at,
  ine_front_url, ine_back_url, selfie_url
) ON public.seller_verification TO authenticated;

-- user_id NO esta en el GRANT de UPDATE a proposito: es de quien es el tramite.
-- La policy ya exige auth.uid() = user_id, pero un privilegio que no hace falta
-- es un privilegio que sobra.

-- VERIFY:
--   SELECT privilege_type FROM information_schema.table_privileges
--    WHERE table_name='seller_verification' AND grantee='authenticated';
--   -- esperado: SELECT, REFERENCES, TRIGGER. NO INSERT/UPDATE/DELETE/TRUNCATE.
--
--   SELECT privilege_type, count(*) FROM information_schema.column_privileges
--    WHERE table_name='seller_verification' AND grantee='authenticated'
--      AND privilege_type IN ('INSERT','UPDATE') GROUP BY 1;
--   -- esperado: INSERT 8, UPDATE 7
