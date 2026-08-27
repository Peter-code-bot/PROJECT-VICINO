-- El cliente aporta la prueba; el servidor dicta el veredicto
--
-- Cuatro agujeros distintos, un mismo error de forma: el navegador tiene
-- permiso de escritura sobre las columnas que DECIDEN, no solo sobre las que
-- aportan datos. Los cuatro se ejercieron contra produccion dentro de un
-- ROLLBACK antes de escribir esto; ninguno es teorico.
--
-- SOBRE LA FORMA DE ESTA MIGRACION, que importa tanto como el fondo.
-- El primer intento hacia REVOKE ... (columna) ... FROM authenticated y no
-- surtio efecto ninguno. El motivo: en Postgres un permiso concedido sobre la
-- TABLA no se puede quitar por columnas. El ACL lo decia:
--
--   chats: {anon=arwdxtm/postgres, authenticated=arwdxtm/postgres}
--                  ^^^^ la w es UPDATE sobre la tabla entera
--
-- Asi que el patron correcto suena al reves de lo que uno espera: primero se
-- revoca el permiso de tabla, y despues se concede columna por columna lo que
-- el cliente si debe poder escribir. Es la segunda vez hoy que un REVOKE
-- aparentemente razonable no revoca nada -- la otra fue un REVOKE ... FROM
-- anon que dejaba en pie el de PUBLIC -- y por eso todas las migraciones de
-- hoy terminan comprobando su propio trabajo. El bloque final de abajo hizo
-- fallar el primer intento y deshizo la transaccion entera, en vez de dejar
-- una linea en el ledger diciendo que el problema estaba resuelto.
--
-- 1. chats -- SECUESTRO DE CONVERSACION
--    La policy "Participants can update own chats" tiene USING pero no
--    WITH CHECK, y Postgres entonces usa el USING tambien como comprobacion
--    de la fila nueva. El USING solo pregunta "eres uno de los dos
--    participantes", asi que el comprador puede cambiar al OTRO participante
--    y seguir cumpliendolo.
--    Probado: el comprador puso a un tercero como vendedor_id. El tercero
--    hereda todo el historial de mensajes, porque la policy de messages se
--    apoya en la pertenencia al chat, y el vendedor real pierde su propia
--    conversacion. No se arregla con WITH CHECK, porque una policy no puede
--    mirar OLD.
--
-- 2. trust_level_verification -- AUTOVERIFICACION
--    Misma policy sin WITH CHECK, y UPDATE de tabla sobre current_level y
--    sobre las seis banderas de verificado. Cualquiera se pone 'elite' con
--    trust_points en cero. La tabla estaba pensada para que solo la escriba
--    approve_verification_atomic, que si comprueba rol admin.
--
-- 3. sale_confirmations -- REPUTACION FABRICADA
--    INSERT de tabla, o sea que el cliente escribe status, buyer_confirmed,
--    seller_confirmed y completed_at. Con eso un desconocido se nombra
--    comprador, nombra victima a cualquier vendedor, escribe la fila con
--    status completed de un tirazo y encima deja una resena de una estrella,
--    porque la policy de reviews solo pide que exista una venta completada.
--    Los guardianes que ya existen son BEFORE UPDATE: no corren en un INSERT.
--    El invariante "status completed solo lo fija la confirmacion mutua" YA
--    estaba declarado en este proyecto; la ruta del INSERT lo saltaba entero.
--
-- 4. appointments -- LA POLICY FLOJA GANA
--    Dos policies PERMISSIVE de INSERT se combinan con OR, asi que basta
--    satisfacer la mas laxa. "Buyers can book appointments" comprueba que el
--    producto sea del vendedor declarado, que acepte citas, que este
--    disponible y que no este oculto; "Authenticated users can create" solo
--    pide auth.uid() = buyer_id. Resultado: se agendan citas sobre productos
--    borrados, ocultos o que desactivaron las citas a proposito.
--    La floja es del repo (20260412000001); la dura se creo desde el panel y
--    nunca se versiono.
--
-- Y de paso: anon tenia INSERT, UPDATE y DELETE de tabla sobre chats y sobre
-- trust_level_verification. Hoy no los ejerce porque no hay ninguna policy
-- que le de paso, pero eso es depender de que nadie escriba nunca una policy
-- descuidada. No hay motivo para que anon conserve escritura ahi.

-- ---------------------------------------------------------------------------
-- 1. chats
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.chats FROM anon;
REVOKE UPDATE ON public.chats FROM authenticated;
GRANT UPDATE (
  ultimo_producto_id,
  no_leidos_comprador,
  no_leidos_vendedor,
  oculto_para_comprador,
  oculto_para_vendedor,
  deleted_at_comprador,
  deleted_at_vendedor,
  updated_at
) ON public.chats TO authenticated;

-- ---------------------------------------------------------------------------
-- 2. trust_level_verification
--    El cliente sube PRUEBAS (urls de documentos, telefono). El veredicto lo
--    escribe approve_verification_atomic, que comprueba rol.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.trust_level_verification FROM anon;
REVOKE UPDATE ON public.trust_level_verification FROM authenticated;
GRANT UPDATE (
  phone_number,
  selfie_url,
  id_front_url,
  id_back_url,
  address_proof_url,
  updated_at
) ON public.trust_level_verification TO authenticated;

-- ---------------------------------------------------------------------------
-- 3. sale_confirmations
--    Las diez columnas de abajo son exactamente las que inserta
--    createSaleConfirmation en apps/web/app/(marketplace)/chat/actions.ts.
--    status, los dos *_confirmed y completed_at pasan a depender del DEFAULT
--    y de los triggers, que es de donde nunca debieron salir.
-- ---------------------------------------------------------------------------
REVOKE INSERT ON public.sale_confirmations FROM anon, authenticated;
GRANT INSERT (
  product_id,
  buyer_id,
  seller_id,
  chat_id,
  precio_acordado,
  cantidad,
  metodo_pago,
  notas,
  tipo_entrega,
  initiated_by
) ON public.sale_confirmations TO authenticated;

-- ---------------------------------------------------------------------------
-- 4. appointments
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authenticated users can create" ON public.appointments;

-- ---------------------------------------------------------------------------
-- 5. Comprobar que sirvio de algo
--
-- Cada comprobacion viene en pareja: una dice que lo peligroso quedo cerrado,
-- la otra que lo legitimo sigue abierto. Revocar de mas rompe la aplicacion
-- en silencio, que es la otra mitad del mismo fallo.
-- ---------------------------------------------------------------------------
DO $comprobacion$
DECLARE
  faltante text;
BEGIN
  -- chats
  IF has_column_privilege('authenticated', 'public.chats', 'vendedor_id', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.chats', 'comprador_id', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated sigue pudiendo cambiar los participantes de un chat';
  END IF;
  IF has_table_privilege('anon', 'public.chats', 'UPDATE') THEN
    RAISE EXCEPTION 'anon sigue con UPDATE sobre chats';
  END IF;
  SELECT c.col INTO faltante
  FROM (VALUES ('oculto_para_comprador'), ('oculto_para_vendedor'),
               ('deleted_at_comprador'), ('deleted_at_vendedor')) AS c(col)
  WHERE NOT has_column_privilege('authenticated', 'public.chats', c.col, 'UPDATE')
  LIMIT 1;
  IF faltante IS NOT NULL THEN
    RAISE EXCEPTION 'se revoco de mas en chats: falta UPDATE sobre %', faltante;
  END IF;

  -- trust_level_verification
  IF has_column_privilege('authenticated', 'public.trust_level_verification', 'current_level', 'UPDATE')
     OR has_column_privilege('authenticated', 'public.trust_level_verification', 'id_verified', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated sigue pudiendo dictar su propio veredicto de verificacion';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.trust_level_verification', 'selfie_url', 'UPDATE') THEN
    RAISE EXCEPTION 'se revoco de mas: subir la prueba de verificacion dejaria de funcionar';
  END IF;

  -- sale_confirmations
  IF has_column_privilege('authenticated', 'public.sale_confirmations', 'status', 'INSERT')
     OR has_column_privilege('authenticated', 'public.sale_confirmations', 'buyer_confirmed', 'INSERT')
     OR has_column_privilege('authenticated', 'public.sale_confirmations', 'completed_at', 'INSERT') THEN
    RAISE EXCEPTION 'authenticated sigue pudiendo fabricar una venta completada en el INSERT';
  END IF;
  SELECT c.col INTO faltante
  FROM (VALUES ('product_id'), ('buyer_id'), ('seller_id'), ('chat_id'),
               ('precio_acordado'), ('cantidad'), ('metodo_pago'), ('notas'),
               ('tipo_entrega'), ('initiated_by')) AS c(col)
  WHERE NOT has_column_privilege('authenticated', 'public.sale_confirmations', c.col, 'INSERT')
  LIMIT 1;
  IF faltante IS NOT NULL THEN
    RAISE EXCEPTION 'se revoco de mas: createSaleConfirmation dejaria de funcionar, falta %', faltante;
  END IF;

  -- appointments
  IF (SELECT count(*) FROM pg_policy
       WHERE polrelid = 'public.appointments'::regclass AND polcmd = 'a') <> 1 THEN
    RAISE EXCEPTION 'appointments deberia quedar con UNA sola policy de INSERT';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid = 'public.appointments'::regclass
       AND polcmd = 'a'
       AND polname = 'Buyers can book appointments'
  ) THEN
    RAISE EXCEPTION 'se borro la policy equivocada en appointments';
  END IF;
END
$comprobacion$;
