-- Ocho cosas que el cliente ve o escribe y no deberia
--
-- Ninguna es critica por si sola. Todas estan comprobadas contra produccion
-- dentro de un ROLLBACK, y varias son latentes: hoy no duelen porque la tabla
-- esta vacia o porque nadie ha mirado. Latente no es lo mismo que falso.
--
-- 1. seller_rankings -- LA POLICY SE LLAMA "publicly readable" Y NO LO ES
--    Su nombre es "Rankings are publicly readable" y su lista de roles dice
--    {authenticated}. Comprobado: anon lee 0 filas. Hoy no se nota porque la
--    tabla esta vacia; el dia que haya rankings, /rankings se vaciara EN
--    SILENCIO para todo visitante sin sesion, que es justo el visitante al que
--    esa pagina intenta convencer.
--
-- 2. v_active_reports_count -- LA VISTA ANULA LA RLS DE reports
--    Sin security_invoker, una vista corre con los privilegios de su dueno
--    (postgres), asi que la RLS de la tabla base no se evalua. anon tiene
--    SELECT sobre ella. Resultado: la RLS de reports oculta la fila, y la
--    vista la ensena igual. Se podria enumerar que publicaciones y que
--    usuarios estan denunciados.
--
-- 3. product_variants y service_availability -- USING (true)
--    El padre products_services se oculta bien cuando esta moderado o pausado,
--    pero estas dos hijas no miran al padre: anon lee el SKU, el stock, el
--    precio override y los horarios de publicaciones ocultas. Ninguna de las
--    dos se consulta desde el cliente hoy (cero referencias en apps/web), asi
--    que apretarlas no rompe nada.
--
-- 4. purchase_requests -- LA UBICACION EXACTA DEL COMPRADOR, AL AIRE
--    anon lee ubicacion_geo, que es el punto PostGIS SIN difuminar de quien
--    publica un pedido de compra, junto al titulo y la descripcion. En
--    profiles esas coordenadas SI estan protegidas por grant de columna; aqui
--    no. Es riesgo fisico, no solo privacidad: se sabe que quiere comprar
--    alguien y donde esta exactamente.
--    Nadie lee esa columna desde el cliente (el feed va por
--    feed_nearby_requests, que es SECURITY DEFINER y puede difuminar).
--    De paso: anon tenia INSERT, UPDATE y DELETE de tabla sobre esta tabla.
--
-- 5. products_services -- CONTADORES INFLABLES AL CREAR
--    authenticated puede escribir ventas_count, vistas_count, favoritos_count
--    e is_hidden en el INSERT. Un vendedor nace con 99999 ventas y prueba
--    social falsa, y ventas_count alimenta /rankings.
--    Se arregla con un trigger BEFORE INSERT y no revocando columnas: el
--    INSERT de esta tabla es de nivel tabla, asi que revocarlo obligaria a
--    enumerar sus treinta y tantas columnas y bastaria olvidar una para
--    romper el alta de publicaciones. El trigger no puede equivocarse en esa
--    direccion: solo pisa las cuatro columnas que nombra.
--
-- 6. appointments.status ES NULLABLE -- y en SQL NULL no es un valor
--    Tres barandales fallan a la vez por el mismo motivo:
--      - el indice parcial dice WHERE status <> 'cancelled'; NULL <> 'cancelled'
--        da NULL, o sea que la fila no entra al indice y el hueco NO queda
--        ocupado: dos citas identicas caben en el mismo horario
--      - el CHECK dice status = ANY(...); con NULL da NULL, y un CHECK solo
--        rechaza cuando da FALSE, asi que NULL pasa
--      - un participante puede volver inmortal una cita poniendole status=NULL
--    Hoy hay 1 cita y 0 nulas, asi que el NOT NULL entra sin backfill.
--
-- 7. bookings -- EL MISMO SECUESTRO QUE chats, Y SIN TRIGGER GUARDIAN
--    Policy de UPDATE sin WITH CHECK y UPDATE de tabla: el comprador reasigna
--    vendedor_id a un tercero y deja la reserva en 'completado'. appointments
--    tiene appointments_guard_update; bookings no tiene nada. Nadie escribe en
--    bookings desde el cliente (cero referencias en apps/web).
--
-- 8. Dos SECURITY DEFINER sin search_path fijo
--    cleanup_old_deletion_logs y notify_push. Ninguna es explotable hoy -- ni
--    anon ni authenticated tienen CREATE sobre public, asi que no pueden
--    plantar una funcion que secuestre la resolucion de nombres -- pero un
--    SECURITY DEFINER sin search_path es una escalada esperando a que alguien
--    conceda CREATE por descuido.

-- ---------------------------------------------------------------------------
-- 1. seller_rankings: que el nombre de la policy diga la verdad
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Rankings are publicly readable" ON public.seller_rankings;
CREATE POLICY "Rankings are publicly readable"
  ON public.seller_rankings
  FOR SELECT
  TO public
  USING (true);

-- ---------------------------------------------------------------------------
-- 2. v_active_reports_count: que la vista respete la RLS de quien consulta
-- ---------------------------------------------------------------------------
ALTER VIEW public.v_active_reports_count SET (security_invoker = true);

-- ---------------------------------------------------------------------------
-- 3. Las hijas miran al padre
-- ---------------------------------------------------------------------------
DROP POLICY IF EXISTS "Anyone can view variants" ON public.product_variants;
CREATE POLICY "Variants follow their listing"
  ON public.product_variants
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.products_services p
       WHERE p.id = product_variants.producto_id
         AND (
           (p.is_hidden = false AND p.estatus = 'disponible'::listing_status)
           OR p.creador_id = (SELECT auth.uid())
         )
    )
  );

DROP POLICY IF EXISTS "Anyone can view availability" ON public.service_availability;
CREATE POLICY "Availability follows its listing"
  ON public.service_availability
  FOR SELECT
  TO public
  USING (
    EXISTS (
      SELECT 1 FROM public.products_services p
       WHERE p.id = service_availability.servicio_id
         AND (
           (p.is_hidden = false AND p.estatus = 'disponible'::listing_status)
           OR p.creador_id = (SELECT auth.uid())
         )
    )
  );

-- ---------------------------------------------------------------------------
-- 4. purchase_requests: la ubicacion exacta deja de ser publica
--
--    Se revoca el SELECT de tabla y se conceden las columnas una a una, que es
--    el unico orden que funciona: un permiso de tabla no se puede quitar por
--    columnas.
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.purchase_requests FROM anon;
REVOKE SELECT ON public.purchase_requests FROM anon, authenticated;
GRANT SELECT (
  id, buyer_id, title, description, budget_estimated, image_url,
  status, expires_at, created_at, updated_at
) ON public.purchase_requests TO anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. products_services: los contadores los lleva el servidor
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.contadores_nacen_en_cero()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Prueba social y moderacion no las decide quien publica.
  NEW.ventas_count := 0;
  NEW.vistas_count := 0;
  NEW.favoritos_count := 0;
  NEW.is_hidden := false;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS contadores_nacen_en_cero ON public.products_services;
CREATE TRIGGER contadores_nacen_en_cero
  BEFORE INSERT ON public.products_services
  FOR EACH ROW EXECUTE FUNCTION public.contadores_nacen_en_cero();

-- ---------------------------------------------------------------------------
-- 6. appointments.status deja de admitir el desconocido
-- ---------------------------------------------------------------------------
UPDATE public.appointments SET status = 'confirmed' WHERE status IS NULL;
ALTER TABLE public.appointments ALTER COLUMN status SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 7. bookings: el mismo tratamiento que chats
-- ---------------------------------------------------------------------------
REVOKE INSERT, UPDATE, DELETE ON public.bookings FROM anon;
REVOKE UPDATE ON public.bookings FROM authenticated;
GRANT UPDATE (fecha, hora_inicio, hora_fin, duracion, estatus, notas, updated_at)
  ON public.bookings TO authenticated;

-- ---------------------------------------------------------------------------
-- 8. search_path fijo en las dos SECURITY DEFINER que no lo tenian
-- ---------------------------------------------------------------------------
ALTER FUNCTION public.cleanup_old_deletion_logs() SET search_path TO 'public';
ALTER FUNCTION public.notify_push() SET search_path TO 'public';

-- ---------------------------------------------------------------------------
-- Comprobar que sirvio de algo
-- ---------------------------------------------------------------------------
DO $comprobacion$
BEGIN
  -- 1
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p
     WHERE p.polrelid = 'public.seller_rankings'::regclass
       AND p.polcmd = 'r'
       AND 0 = ANY(p.polroles)          -- 0 = PUBLIC
  ) THEN
    RAISE EXCEPTION 'seller_rankings sigue sin ser legible publicamente';
  END IF;

  -- 2
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c
     WHERE c.oid = 'public.v_active_reports_count'::regclass
       AND c.reloptions::text LIKE '%security_invoker=true%'
  ) THEN
    RAISE EXCEPTION 'la vista v_active_reports_count sigue brincando la RLS';
  END IF;

  -- 3
  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid IN ('public.product_variants'::regclass,
                        'public.service_availability'::regclass)
       AND polcmd = 'r'
       AND pg_get_expr(polqual, polrelid) = 'true'
  ) THEN
    RAISE EXCEPTION 'alguna hija sigue con USING (true)';
  END IF;

  -- 4
  IF has_column_privilege('anon', 'public.purchase_requests', 'ubicacion_geo', 'SELECT') THEN
    RAISE EXCEPTION 'anon sigue leyendo la ubicacion exacta de los pedidos de compra';
  END IF;
  IF NOT has_column_privilege('anon', 'public.purchase_requests', 'title', 'SELECT') THEN
    RAISE EXCEPTION 'se revoco de mas: el feed de pedidos dejaria de leerse';
  END IF;

  -- 5
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgrelid = 'public.products_services'::regclass
       AND tgname = 'contadores_nacen_en_cero'
       AND NOT tgisinternal
  ) THEN
    RAISE EXCEPTION 'el trigger de contadores no quedo enganchado';
  END IF;

  -- 6
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'appointments'
       AND column_name = 'status' AND is_nullable = 'YES'
  ) THEN
    RAISE EXCEPTION 'appointments.status sigue admitiendo NULL';
  END IF;

  -- 7
  IF has_column_privilege('authenticated', 'public.bookings', 'vendedor_id', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated sigue pudiendo cambiar el vendedor de una reserva';
  END IF;
  IF NOT has_column_privilege('authenticated', 'public.bookings', 'estatus', 'UPDATE') THEN
    RAISE EXCEPTION 'se revoco de mas: no se podria cambiar el estado de una reserva';
  END IF;

  -- 8
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname IN ('cleanup_old_deletion_logs', 'notify_push')
       AND p.prosecdef
       AND p.proconfig IS NULL
  ) THEN
    RAISE EXCEPTION 'alguna SECURITY DEFINER sigue sin search_path fijo';
  END IF;
END
$comprobacion$;
