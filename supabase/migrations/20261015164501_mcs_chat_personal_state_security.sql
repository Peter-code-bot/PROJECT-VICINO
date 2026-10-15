-- F00 S01/S02: recibos ligados a auth.uid() y estado personal del chat.
-- No cambia las firmas historicas, los grants de chats ni el contrato S04.
BEGIN;

CREATE OR REPLACE FUNCTION public.mark_messages_as_read(p_chat_id uuid, p_user_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, pg_temp AS $fn$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_comprador uuid;
  v_vendedor uuid;
BEGIN
  -- p_user_id se conserva por compatibilidad; nunca autoriza el recibo.
  -- Los errores conservan los mensajes y SQLSTATE P0001 del RPC live.
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated';
  END IF;
  SELECT comprador_id, vendedor_id INTO v_comprador, v_vendedor
    FROM public.chats WHERE id = p_chat_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'chat not found';
  END IF;
  IF v_actor = v_comprador THEN
    UPDATE public.messages SET leido_por_comprador = true
      WHERE chat_id = p_chat_id AND leido_por_comprador = false;
    UPDATE public.chats SET no_leidos_comprador = 0 WHERE id = p_chat_id;
  ELSIF v_actor = v_vendedor THEN
    UPDATE public.messages SET leido_por_vendedor = true
      WHERE chat_id = p_chat_id AND leido_por_vendedor = false;
    UPDATE public.chats SET no_leidos_vendedor = 0 WHERE id = p_chat_id;
  ELSE
    RAISE EXCEPTION 'forbidden: no eres participante de este chat';
  END IF;
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.mark_messages_as_read(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_messages_as_read(uuid, uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.guard_chat_personal_state_update()
RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
SET search_path = public, pg_temp AS $fn$
DECLARE v_actor uuid;
BEGIN
  -- SECURITY INVOKER es imprescindible: dentro de un RPC/trigger DEFINER,
  -- current_user es su propietario real; el claim JWT sigue siendo el cliente.
  -- Solo roles SQL con privilegios de backend pueden actualizar ambos lados.
  -- No usar auth.role(), session_user, pg_trigger_depth() ni un GUC como bypass.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles
             WHERE rolname = current_user AND (rolsuper OR rolbypassrls)) THEN
    RETURN NEW;
  END IF;
  v_actor := (SELECT auth.uid());
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'unauthenticated' USING ERRCODE = '42501';
  END IF;
  IF v_actor = OLD.comprador_id THEN
    IF NEW.no_leidos_vendedor IS DISTINCT FROM OLD.no_leidos_vendedor
       OR NEW.oculto_para_vendedor IS DISTINCT FROM OLD.oculto_para_vendedor
       OR NEW.deleted_at_vendedor IS DISTINCT FROM OLD.deleted_at_vendedor THEN
      RAISE EXCEPTION 'chats: solo puedes cambiar tu estado personal' USING ERRCODE = '42501';
    END IF;
  ELSIF v_actor = OLD.vendedor_id THEN
    IF NEW.no_leidos_comprador IS DISTINCT FROM OLD.no_leidos_comprador
       OR NEW.oculto_para_comprador IS DISTINCT FROM OLD.oculto_para_comprador
       OR NEW.deleted_at_comprador IS DISTINCT FROM OLD.deleted_at_comprador THEN
      RAISE EXCEPTION 'chats: solo puedes cambiar tu estado personal' USING ERRCODE = '42501';
    END IF;
  ELSE
    RAISE EXCEPTION 'forbidden: no participante' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS aa_guard_chat_personal_state_update ON public.chats;
CREATE TRIGGER aa_guard_chat_personal_state_update
  BEFORE UPDATE ON public.chats FOR EACH ROW
  EXECUTE FUNCTION public.guard_chat_personal_state_update();

-- Estos efectos deben escribir el estado del destinatario, aunque el mensaje
-- entre con la sesion del autor. Sus cuerpos y la RLS de INSERT se conservan.
ALTER FUNCTION public.increment_unread_count() SECURITY DEFINER;
ALTER FUNCTION public.increment_unread_count() SET search_path = public, pg_temp;
ALTER FUNCTION public.unhide_chat_on_new_message() SECURITY DEFINER;
ALTER FUNCTION public.unhide_chat_on_new_message() SET search_path = public, pg_temp;

-- Son funciones internas de trigger, nunca RPC. PostgreSQL comprueba EXECUTE
-- al crear el trigger, no en cada disparo: revocarlo no rompe mensajes.
REVOKE EXECUTE ON FUNCTION public.increment_unread_count() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.unhide_chat_on_new_message() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.guard_chat_personal_state_update() FROM PUBLIC, anon, authenticated;

DO $verify$
BEGIN
  IF has_function_privilege('anon', 'public.mark_messages_as_read(uuid,uuid)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.mark_messages_as_read(uuid,uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'Los permisos del recibo de lectura no son los esperados';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
             JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
             JOIN pg_catalog.pg_roles r ON r.oid = p.proowner
             WHERE n.nspname = 'public'
               AND p.proname IN ('increment_unread_count', 'unhide_chat_on_new_message', 'mark_messages_as_read')
               AND (NOT p.prosecdef OR NOT (r.rolsuper OR r.rolbypassrls))) THEN
    RAISE EXCEPTION 'Los efectos internos del chat requieren un propietario SQL privilegiado';
  END IF;
END;
$verify$;
COMMIT;
