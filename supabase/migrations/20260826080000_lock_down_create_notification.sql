-- SEGURIDAD: cualquier visitante anonimo podia mandarle una notificacion a
-- cualquier usuario, con el texto que quisiera.
--
-- public.create_notification(uuid, text, text, text, jsonb) es SECURITY DEFINER,
-- no valida absolutamente nada, y tenia EXECUTE para PUBLIC y para anon. Es decir:
-- un extraño sin sesion podia insertar en notifications saltandose la RLS por
-- completo y elegir el destinatario, el titulo y el mensaje.
--
-- El vector obvio es phishing dentro del propio producto: una notificacion que
-- diga "Tu cuenta fue suspendida, entra aqui" llega con la misma apariencia que
-- una legitima, porque ES legitima desde el punto de vista de la base. Tambien
-- sirve para spam masivo y para llenar la tabla.
--
-- Por que revocar no rompe nada (comprobado antes de escribir esto):
--   - Ninguna linea de apps/web, packages ni supabase/functions la llama. La
--     unica mencion en el repo esta en types/database.types.ts, que es generado.
--   - Sus cuatro llamadores reales son funciones de trigger, todas SECURITY
--     DEFINER y propiedad de postgres: notify_new_review, notify_sale_completed,
--     notify_sale_confirmation_created y update_trust_level_from_points. Dentro
--     de una funcion SECURITY DEFINER el permiso se comprueba contra el DUEÑO,
--     no contra quien la invoco, asi que siguen pudiendo llamarla.
--
-- Se conserva EXECUTE para service_role: las Edge Functions escriben con esa
-- llave y no pasan por RLS de todos modos.

REVOKE EXECUTE ON FUNCTION public.create_notification(uuid, text, text, text, jsonb)
  FROM PUBLIC, anon, authenticated;

-- ---------------------------------------------------------------------------
-- El panel de admin si necesita notificar a otra persona: cuando se aprueba o se
-- rechaza una verificacion de identidad, el vendedor tiene que enterarse. Hoy
-- eso esta ROTO en produccion — notifications no tiene NINGUNA policy de INSERT,
-- solo SELECT y UPDATE del propio usuario, asi que el insert directo del panel
-- muere con 42501 y el error se descartaba.
--
-- En vez de abrir una policy de INSERT (que habria que escribir de forma que no
-- deje a un usuario cualquiera notificar a otro), se expone una funcion acotada
-- con la misma forma que moderate_set_content_hidden: valida el rol y no acepta
-- nada mas.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.notify_user_as_staff(
  p_user_id uuid,
  p_tipo    text,
  p_titulo  text,
  p_mensaje text,
  p_data    jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_actor uuid := (SELECT auth.uid());
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'forbidden: requiere sesion';
  END IF;

  IF NOT (public.has_role(v_actor, 'admin'::app_role)
       OR public.has_role(v_actor, 'moderator'::app_role)) THEN
    RAISE EXCEPTION 'forbidden: requiere admin o moderator';
  END IF;

  -- Existir de verdad importa: sin esto, un id equivocado inserta una fila
  -- huerfana que nadie va a leer nunca y que nadie va a echar de menos.
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'usuario no encontrado: %', p_user_id;
  END IF;

  INSERT INTO public.notifications (user_id, tipo, titulo, mensaje, data, leida, created_at)
  VALUES (p_user_id, p_tipo, p_titulo, p_mensaje, COALESCE(p_data, '{}'::jsonb), false, NOW());
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.notify_user_as_staff(uuid, text, text, text, jsonb) FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.notify_user_as_staff(uuid, text, text, text, jsonb) TO authenticated;

COMMENT ON FUNCTION public.notify_user_as_staff(uuid, text, text, text, jsonb) IS
  'Notifica a otra persona desde el panel de admin. Valida admin o moderator. Usar esto, nunca un INSERT directo a notifications: esa tabla no tiene policy de INSERT.';

-- VERIFY:
--   1. anon ya no puede:
--      SELECT has_function_privilege('anon',
--        'public.create_notification(uuid,text,text,text,jsonb)', 'EXECUTE');
--      -- esperado: false
--
--   2. Los triggers siguen funcionando (transaccion revertida):
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<uuid-real>","role":"authenticated"}';
--        -- provocar un INSERT que dispare notify_new_review o similar
--      ROLLBACK;
--
--   3. Un usuario normal NO puede usar la funcion del panel:
--      BEGIN;
--        SET LOCAL ROLE authenticated;
--        SET LOCAL request.jwt.claims = '{"sub":"<uuid-no-admin>","role":"authenticated"}';
--        SELECT public.notify_user_as_staff('<uuid>','test','t','m');
--      ROLLBACK;
--      -- esperado: forbidden: requiere admin o moderator
