-- Las publicaciones hechas desde la app no entraban nunca en los Rankings.
--
-- S08 (hipotesis H2, confirmada el 27-sep-2026 en solo lectura contra prod):
-- recompute_seller_rankings_for_category cuenta ventas y resenas filtrando por
-- `ps.categoria_id = p_category_id`, pero la app (vender/actions.ts) escribe
-- solo el slug en `categoria` y el pivote product_categories; `categoria_id`
-- queda en NULL y ningun trigger lo rellena. Las 35 publicaciones que si lo
-- tienen vienen de seeds que lo ponian a mano; las 8 publicadas desde la app
-- (13 a 20 de agosto) lo tienen en NULL. Hoy no hay dano visible porque esas 8
-- no tienen ventas completadas, pero cada venta real futura de algo publicado
-- en la app quedaria fuera del ranking sin que nadie lo notara.
--
-- Arreglo en la base, para que valga para cualquier cliente (web, app, seeds):
-- un trigger BEFORE INSERT/UPDATE que deriva `categoria_id` del slug de
-- `categoria`, que es la categoria principal que ve el usuario. Si el slug no
-- existe se conserva el valor que viniera (no se borra un id explicito). Mas un
-- backfill de las filas en NULL cuyo slug si existe.
--
-- No toca el ranking ni el pivote. Idempotente.

CREATE OR REPLACE FUNCTION public.derivar_categoria_id_del_slug()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
BEGIN
  IF NEW.categoria IS NOT NULL
     AND (TG_OP = 'INSERT'
          OR NEW.categoria IS DISTINCT FROM OLD.categoria
          OR NEW.categoria_id IS NULL)
  THEN
    SELECT c.id INTO v_id FROM public.categories c WHERE c.slug = NEW.categoria;
    IF v_id IS NOT NULL THEN
      NEW.categoria_id := v_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS derivar_categoria_id_del_slug_trg ON public.products_services;
CREATE TRIGGER derivar_categoria_id_del_slug_trg
  BEFORE INSERT OR UPDATE OF categoria, categoria_id ON public.products_services
  FOR EACH ROW EXECUTE FUNCTION public.derivar_categoria_id_del_slug();

REVOKE ALL ON FUNCTION public.derivar_categoria_id_del_slug() FROM PUBLIC, anon, authenticated;

-- Backfill: solo filas en NULL cuyo slug existe. El UPDATE de categoria_id
-- dispara el trigger, que llega al mismo valor.
UPDATE public.products_services ps
   SET categoria_id = c.id
  FROM public.categories c
 WHERE c.slug = ps.categoria
   AND ps.categoria_id IS NULL;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = 'public.products_services'::regclass
                 AND tgname = 'derivar_categoria_id_del_slug_trg' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'falta derivar_categoria_id_del_slug_trg';
  END IF;
  IF EXISTS (SELECT 1 FROM public.products_services ps
             JOIN public.categories c ON c.slug = ps.categoria
             WHERE ps.categoria_id IS NULL) THEN
    RAISE EXCEPTION 'quedan publicaciones con slug valido y categoria_id NULL';
  END IF;
END
$verify$;
