-- Las publicaciones hechas desde la app no entraban nunca en los Rankings.
--
-- S08 (hipotesis H2, confirmada el 27-sep-2026 en solo lectura contra prod):
-- recompute_seller_rankings_for_category cuenta ventas y resenas filtrando por
-- `ps.categoria_id = p_category_id`, pero la app (vender/actions.ts) escribe
-- solo el slug en `categoria` y el pivote product_categories; `categoria_id`
-- queda en NULL y ningun trigger lo rellena. Las 35 publicaciones que si lo
-- tienen vienen de seeds que lo ponian a mano; las publicadas desde la app lo
-- tienen en NULL. Hoy no hay dano visible porque esas no tienen ventas
-- completadas, pero cada venta real futura de algo publicado en la app quedaria
-- fuera del ranking sin que nadie lo notara.
--
-- Arreglo en la base, para que valga para cualquier cliente (web, app, seeds):
-- un trigger BEFORE INSERT/UPDATE que deriva `categoria_id` SIEMPRE del slug de
-- `categoria`, que es la categoria que ve el usuario. Nunca se respeta un id
-- que mande el cliente: la revision adversarial del 27-sep mostro que, si se
-- respetaba, un vendedor podia hacer PATCH solo de categoria_id y mover sus
-- ventas al ranking de otra categoria sin cambiar lo que ven los compradores.
-- Si el slug no existe: en UPDATE se conserva el id anterior; en INSERT, NULL.
-- Ademas se revoca el UPDATE de la columna a authenticated (la app no la
-- escribe; el INSERT de tabla sigue y ahi manda el trigger). Mas un backfill.
--
-- El backfill mueve updated_at de esas filas (products_updated_at). No toca el
-- ranking ni el pivote. Idempotente.

-- SECURITY DEFINER a proposito: como invocador, la RLS de categories («Anyone
-- can view active categories») haria que el id dependiera de quien edita y de si
-- la categoria esta activa. Solo lee categories por slug, con search_path fijo.
CREATE OR REPLACE FUNCTION public.derivar_categoria_id_del_slug()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $function$
DECLARE
  v_id uuid;
BEGIN
  SELECT c.id INTO v_id FROM public.categories c WHERE c.slug = NEW.categoria;
  IF v_id IS NOT NULL THEN
    NEW.categoria_id := v_id;
  ELSIF TG_OP = 'UPDATE' THEN
    NEW.categoria_id := OLD.categoria_id;   -- lo que mande el cliente no cuenta
  ELSE
    NEW.categoria_id := NULL;               -- INSERT con un slug desconocido
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS derivar_categoria_id_del_slug_trg ON public.products_services;
CREATE TRIGGER derivar_categoria_id_del_slug_trg
  BEFORE INSERT OR UPDATE OF categoria, categoria_id ON public.products_services
  FOR EACH ROW EXECUTE FUNCTION public.derivar_categoria_id_del_slug();

REVOKE ALL ON FUNCTION public.derivar_categoria_id_del_slug() FROM PUBLIC, anon, authenticated;

-- Defensa en profundidad: la app nunca escribe categoria_id.
REVOKE UPDATE (categoria_id) ON public.products_services FROM authenticated, anon;

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
             WHERE ps.categoria_id IS DISTINCT FROM c.id AND ps.categoria_id IS NULL) THEN
    RAISE EXCEPTION 'quedan publicaciones con slug valido y categoria_id NULL';
  END IF;
  IF has_column_privilege('authenticated', 'public.products_services', 'categoria_id', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated sigue pudiendo hacer UPDATE de categoria_id';
  END IF;
END
$verify$;
