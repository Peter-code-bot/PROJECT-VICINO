-- STAGING ONLY, despues de aplicar 20261015164501.
-- Prueba reversible sin usuarios, perfiles, chats ni mensajes persistentes.
-- Usa una tabla TEMP con las columnas reales y la funcion guard real.
-- No prueba el envio/Realtime ni sustituye cuentas/dispositivos de prueba:
-- los efectos de messages y S04 se ejercen en test-mcs-chat-security.ts.
BEGIN;

DO $catalog$
DECLARE v_signature text;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE oid IN
       ('public.chats'::regclass,'public.messages'::regclass,'public.sale_confirmations'::regclass)
       AND NOT relrowsecurity) THEN
    RAISE EXCEPTION 'RLS debe permanecer activo';
  END IF;
  IF has_function_privilege('anon','public.mark_messages_as_read(uuid,uuid)','EXECUTE')
     OR NOT has_function_privilege('authenticated','public.mark_messages_as_read(uuid,uuid)','EXECUTE') THEN
    RAISE EXCEPTION 'ACL incorrecto del recibo de lectura';
  END IF;
  FOREACH v_signature IN ARRAY ARRAY['public.increment_unread_count()',
    'public.unhide_chat_on_new_message()','public.guard_chat_personal_state_update()'] LOOP
    IF has_function_privilege('anon',v_signature,'EXECUTE')
       OR has_function_privilege('authenticated',v_signature,'EXECUTE') THEN
      RAISE EXCEPTION 'Funcion interna expuesta: %',v_signature;
    END IF;
  END LOOP;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='public.chats'::regclass
       AND tgname='aa_guard_chat_personal_state_update' AND tgenabled='O') THEN
    RAISE EXCEPTION 'Falta el guard activo en chats';
  END IF;
END;
$catalog$;

-- LIKE no copia foreign keys: estos UUID son actores sinteticos sin filas auth.
CREATE TEMP TABLE mcs_guard_probe (LIKE public.chats INCLUDING DEFAULTS INCLUDING CONSTRAINTS) ON COMMIT DROP;
INSERT INTO mcs_guard_probe(id,comprador_id,vendedor_id,no_leidos_comprador,no_leidos_vendedor)
  VALUES ('10000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000001',
          '00000000-0000-4000-8000-000000000002',5,7);
CREATE TRIGGER mcs_guard_probe BEFORE UPDATE ON mcs_guard_probe
  FOR EACH ROW EXECUTE FUNCTION public.guard_chat_personal_state_update();
GRANT SELECT,UPDATE ON mcs_guard_probe TO authenticated;
ALTER TABLE mcs_guard_probe ENABLE ROW LEVEL SECURITY;
CREATE POLICY mcs_probe_select ON mcs_guard_probe FOR SELECT TO authenticated
  USING(auth.uid() IN (comprador_id,vendedor_id));
CREATE POLICY mcs_probe_update ON mcs_guard_probe FOR UPDATE TO authenticated
  USING(auth.uid() IN (comprador_id,vendedor_id))
  WITH CHECK(auth.uid() IN (comprador_id,vendedor_id));

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000001","role":"authenticated"}',true);
DO $buyer$
DECLARE v_rejected boolean := false; v_count integer;
BEGIN
  UPDATE mcs_guard_probe SET oculto_para_comprador=true,no_leidos_comprador=0,deleted_at_comprador=now();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'El comprador no pudo escribir su estado'; END IF;
  BEGIN
    UPDATE mcs_guard_probe SET oculto_para_vendedor=true,no_leidos_vendedor=0,deleted_at_vendedor=now();
  EXCEPTION WHEN insufficient_privilege THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'El comprador pudo cambiar el estado ajeno'; END IF;
END;
$buyer$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000002',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000002","role":"authenticated"}',true);
DO $seller$
DECLARE v_rejected boolean := false; v_count integer;
BEGIN
  UPDATE mcs_guard_probe SET oculto_para_vendedor=true,no_leidos_vendedor=0,deleted_at_vendedor=now();
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>1 THEN RAISE EXCEPTION 'El vendedor no pudo escribir su estado'; END IF;
  BEGIN
    UPDATE mcs_guard_probe SET oculto_para_comprador=false,no_leidos_comprador=9,deleted_at_comprador=NULL;
  EXCEPTION WHEN insufficient_privilege THEN v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'El vendedor pudo cambiar el estado ajeno'; END IF;
  -- NULL garantiza que esta consulta no toca ningun chat real.
  v_rejected:=false;
  BEGIN
    PERFORM public.mark_messages_as_read(NULL,'00000000-0000-4000-8000-000000000001');
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'chat not found' THEN RAISE; END IF;
    v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'El recibo acepto un chat NULL'; END IF;
END;
$seller$;

SELECT set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000003',true);
SELECT set_config('request.jwt.claims','{"sub":"00000000-0000-4000-8000-000000000003","role":"authenticated"}',true);
DO $outsider$
DECLARE v_count integer;
BEGIN
  UPDATE mcs_guard_probe SET oculto_para_comprador=false;
  GET DIAGNOSTICS v_count=ROW_COUNT;
  IF v_count<>0 THEN RAISE EXCEPTION 'Un tercero pudo actualizar la prueba'; END IF;
END;
$outsider$;

SELECT set_config('request.jwt.claim.sub','',true);
SELECT set_config('request.jwt.claims','{"role":"authenticated"}',true);
DO $sessionless$
DECLARE v_rejected boolean:=false;
BEGIN
  BEGIN
    PERFORM public.mark_messages_as_read(NULL,NULL);
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM<>'unauthenticated' THEN RAISE; END IF;
    v_rejected:=true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'El recibo acepto un actor NULL'; END IF;
END;
$sessionless$;
RESET ROLE;
SELECT 'PASS MCS: ACL/RLS presentes; guard real en TEMP A/B/C; RPC sin sesion/chat rechazado. Sin escritura persistente.' AS resultado;
ROLLBACK;
