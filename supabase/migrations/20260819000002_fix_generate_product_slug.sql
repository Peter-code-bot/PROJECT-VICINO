-- Migración: generate_product_slug (espejo de Q10 aplicado en producción)
-- Propósito: el trigger generaba slugs con las mayúsculas comidas.
--
-- EL BUG: la versión anterior tenía el REGEXP_REPLACE DENTRO del LOWER, o sea
-- LOWER(REGEXP_REPLACE(TRANSLATE(NEW.titulo, ...), '[^a-z0-9\s-]', '', 'g')).
-- Así el regexp corría sobre el título ORIGINAL, con su capitalización intacta,
-- y su clase de caracteres permitidos [^a-z0-9\s-] no incluye A-Z: cada
-- mayúscula caía como carácter no permitido y se borraba. El LOWER de afuera
-- llegaba tarde, cuando ya no quedaba nada que pasar a minúsculas.
--
--   "Aros de Sandía"  ->  ros-de-andia      (se comió la A y la S)
--
-- EL FIX: LOWER va adentro, antes del regexp, para que cuando la clase corra ya
-- no existan mayúsculas que borrar. Se agrega además el guard de base_slug
-- vacío: un título sin ningún carácter latino (emoji, cirílico) dejaba la base
-- en blanco y el slug salía empezando por guion.
--
-- Los 13 listings que ya existían con el slug roto se corrigieron por backfill
-- manual en la misma sesión, no hay nada que reparar aquí.
--
-- ALCANCE DEL TRIGGER: set_product_slug es BEFORE INSERT únicamente. Editar el
-- título de una publicación NO regenera su slug — el slug queda invariante de
-- por vida para no romper enlaces compartidos ni SEO (ver "Limitaciones
-- conocidas" en CLAUDE.md).
--
-- Ya aplicado a mano en producción (Q10). Esta migración existe solo para
-- reproducibilidad en una base limpia; es un CREATE OR REPLACE idempotente.

CREATE OR REPLACE FUNCTION public.generate_product_slug()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  base_slug TEXT;
  suffix TEXT;
BEGIN
  IF NEW.slug IS NULL OR NEW.slug = '' THEN
    -- LOWER va ADENTRO, antes del regexp. Al revés, la clase [^a-z0-9\s-]
    -- borra todas las mayusculas del titulo. Ese era el bug.
    base_slug := REGEXP_REPLACE(
      TRANSLATE(LOWER(NEW.titulo), 'áéíóúüñ', 'aeiouun'),
      '[^a-z0-9\s-]', '', 'g'
    );
    base_slug := REGEXP_REPLACE(base_slug, '\s+', '-', 'g');
    base_slug := REGEXP_REPLACE(base_slug, '-+', '-', 'g');
    base_slug := TRIM(BOTH '-' FROM base_slug);
    -- Titulo sin caracteres latinos (emoji, cirilico) dejaria base vacia
    -- y el slug empezaria con guion.
    IF base_slug = '' THEN base_slug := 'listing'; END IF;
    suffix := SUBSTR(gen_random_uuid()::TEXT, 1, 6);
    NEW.slug := base_slug || '-' || suffix;
  END IF;
  RETURN NEW;
END;
$function$;
