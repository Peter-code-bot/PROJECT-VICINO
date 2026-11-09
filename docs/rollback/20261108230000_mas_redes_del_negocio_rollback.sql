-- Reversion de 20261108230000_mas_redes_del_negocio.sql
-- Una sola transaccion (BEGIN..COMMIT).
--
-- ANTES de correr esto, revertir el merge del codigo: la ficha, el perfil y
-- Editar perfil piden las columnas nuevas en su SELECT y, sin ellas, la consulta
-- entera falla.
--
-- Borra los enlaces nuevos de todos los negocios. Para guardarlos antes:
--   CREATE TABLE respaldo_redes_negocio AS
--     SELECT id, facebook_ruta, facebook_messenger, tiktok_usuario, youtube_ruta, x_usuario,
--            linkedin_ruta, threads_usuario, pinterest_usuario, telegram_usuario
--       FROM public.profiles
--      WHERE facebook_ruta IS NOT NULL OR facebook_messenger OR tiktok_usuario IS NOT NULL
--         OR youtube_ruta IS NOT NULL OR x_usuario IS NOT NULL OR linkedin_ruta IS NOT NULL
--         OR threads_usuario IS NOT NULL OR pinterest_usuario IS NOT NULL OR telegram_usuario IS NOT NULL;
--
-- Los clics de los canales nuevos tambien se borran: el CHECK original no los admite.

BEGIN;
SET LOCAL lock_timeout = '5s';

DROP FUNCTION IF EXISTS public.guardar_enlaces_negocio(JSONB);
DROP FUNCTION IF EXISTS public.clics_enlaces_negocio_por_canal(INTEGER);

DELETE FROM public.clics_enlaces_negocio
 WHERE canal NOT IN ('instagram', 'whatsapp', 'google_maps', 'google_resenas');

ALTER TABLE public.clics_enlaces_negocio DROP CONSTRAINT IF EXISTS clics_enlaces_negocio_canal_valido;
ALTER TABLE public.clics_enlaces_negocio ADD CONSTRAINT clics_enlaces_negocio_canal_check
  CHECK (canal IN ('instagram', 'whatsapp', 'google_maps', 'google_resenas'));

-- La definicion de 20261108120000, copiada tal cual.
CREATE OR REPLACE FUNCTION public.registrar_clic_enlace_negocio(
  p_vendedor_id UUID,
  p_canal       TEXT
)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_uid   UUID := auth.uid();
  v_tiene BOOLEAN;
  v_ultimo_minuto INTEGER;
  v_ultima_hora   INTEGER;
BEGIN
  IF p_vendedor_id IS NULL
     OR p_canal IS NULL
     OR p_canal NOT IN ('instagram', 'whatsapp', 'google_maps', 'google_resenas') THEN
    RAISE EXCEPTION 'Canal invalido.' USING ERRCODE = '22023';
  END IF;

  -- El dueno probando sus enlaces no es trafico.
  IF v_uid IS NOT NULL AND v_uid = p_vendedor_id THEN
    RETURN FALSE;
  END IF;

  SELECT CASE p_canal
           WHEN 'instagram'   THEN instagram_usuario  IS NOT NULL
           WHEN 'whatsapp'    THEN whatsapp_numero    IS NOT NULL
           WHEN 'google_maps' THEN google_maps_url    IS NOT NULL
           ELSE                    google_resenas_url IS NOT NULL
         END
    INTO v_tiene
    FROM public.profiles
   WHERE id = p_vendedor_id
     AND es_vendedor IS TRUE
     AND is_hidden = FALSE;

  IF NOT COALESCE(v_tiene, FALSE) THEN
    RETURN FALSE;
  END IF;

  -- Serializa los clics de un mismo negocio dentro de la transaccion: sin
  -- esto, N llamadas concurrentes cuentan antes de que ninguna inserte y el
  -- tope se pasa en N. Un lock por negocio, liberado al terminar, cuesta nada.
  PERFORM pg_advisory_xact_lock(hashtext('clics_enlaces_negocio:' || p_vendedor_id::text));

  -- Tope por negocio (indice vendedor_id, created_at).
  SELECT count(*) INTO v_ultimo_minuto
    FROM public.clics_enlaces_negocio
   WHERE vendedor_id = p_vendedor_id
     AND created_at > now() - interval '1 minute';

  IF v_ultimo_minuto >= 20 THEN
    RETURN FALSE;
  END IF;

  -- Tope global (indice created_at).
  SELECT count(*) INTO v_ultima_hora
    FROM public.clics_enlaces_negocio
   WHERE created_at > now() - interval '1 hour';

  IF v_ultima_hora >= 5000 THEN
    RETURN FALSE;
  END IF;

  INSERT INTO public.clics_enlaces_negocio (vendedor_id, canal, con_sesion)
  VALUES (p_vendedor_id, p_canal, v_uid IS NOT NULL);

  RETURN TRUE;
END;
$$;

REVOKE ALL ON FUNCTION public.registrar_clic_enlace_negocio(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.registrar_clic_enlace_negocio(UUID, TEXT) TO anon, authenticated;

ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_facebook_ruta_formato,
  DROP CONSTRAINT IF EXISTS profiles_facebook_messenger_con_usuario,
  DROP CONSTRAINT IF EXISTS profiles_tiktok_usuario_formato,
  DROP CONSTRAINT IF EXISTS profiles_youtube_ruta_formato,
  DROP CONSTRAINT IF EXISTS profiles_x_usuario_formato,
  DROP CONSTRAINT IF EXISTS profiles_linkedin_ruta_formato,
  DROP CONSTRAINT IF EXISTS profiles_threads_usuario_formato,
  DROP CONSTRAINT IF EXISTS profiles_pinterest_usuario_formato,
  DROP CONSTRAINT IF EXISTS profiles_telegram_usuario_formato;

ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS facebook_ruta,
  DROP COLUMN IF EXISTS facebook_messenger,
  DROP COLUMN IF EXISTS tiktok_usuario,
  DROP COLUMN IF EXISTS youtube_ruta,
  DROP COLUMN IF EXISTS x_usuario,
  DROP COLUMN IF EXISTS linkedin_ruta,
  DROP COLUMN IF EXISTS threads_usuario,
  DROP COLUMN IF EXISTS pinterest_usuario,
  DROP COLUMN IF EXISTS telegram_usuario;

NOTIFY pgrst, 'reload schema';
COMMIT;

-- La fila del ledger se quita aparte, a mano:
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261108230000';
