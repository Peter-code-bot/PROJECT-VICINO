-- Aplicado a mano en el editor de Supabase el 3-sep-2026.
-- Ledger de migraciones SIN reconciliar: este archivo es la constancia de lo
-- que YA corre en la base, no algo pendiente de aplicar. No lo apliques.

begin;

drop function if exists public.activar_modo_vendedor(text, text);

create or replace function public.activar_modo_vendedor(
  p_categoria_negocio      text default null,
  p_seller_type            text default 'casual',
  p_nombre_negocio         text default null,
  p_descripcion_negocio    text default null,
  p_metodos_pago_aceptados text default null,
  p_foto                   text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
DECLARE
  v_uid UUID := auth.uid();
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Necesitas iniciar sesion.' USING ERRCODE = '42501';
  END IF;

  IF p_seller_type IS NULL OR p_seller_type NOT IN ('casual', 'business') THEN
    RAISE EXCEPTION 'Tipo de vendedor invalido.' USING ERRCODE = '22023';
  END IF;

  IF p_categoria_negocio IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM categories WHERE slug = p_categoria_negocio AND activo) THEN
    RAISE EXCEPTION 'Esa categoria no existe.' USING ERRCODE = '22023';
  END IF;

  -- COALESCE en todo lo nuevo: omitir un dato significa "no lo toques",
  -- nunca "borralo". Los campos de negocio solo se escriben si el tipo es
  -- business, para que un casual no arrastre datos de tienda.
  UPDATE profiles
     SET es_vendedor            = TRUE,
         seller_type            = p_seller_type,
         categoria_negocio      = COALESCE(p_categoria_negocio, categoria_negocio),
         nombre_negocio         = CASE WHEN p_seller_type = 'business'
                                       THEN COALESCE(p_nombre_negocio, nombre_negocio)
                                       ELSE nombre_negocio END,
         descripcion_negocio    = CASE WHEN p_seller_type = 'business'
                                       THEN COALESCE(p_descripcion_negocio, descripcion_negocio)
                                       ELSE descripcion_negocio END,
         metodos_pago_aceptados = CASE WHEN p_seller_type = 'business'
                                       THEN COALESCE(p_metodos_pago_aceptados, metodos_pago_aceptados)
                                       ELSE metodos_pago_aceptados END,
         foto                   = COALESCE(p_foto, foto),
         alta_vendedor_paso     = 'publicacion'
   WHERE id = v_uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No se encontro tu perfil.' USING ERRCODE = 'P0002';
  END IF;

  RETURN jsonb_build_object('es_vendedor', TRUE, 'paso', 'publicacion');
END;
$function$;

grant execute on function public.activar_modo_vendedor(text, text, text, text, text, text)
  to authenticated;

commit;