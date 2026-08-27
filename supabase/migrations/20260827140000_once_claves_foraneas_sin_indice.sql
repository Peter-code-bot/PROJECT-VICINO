-- Once claves foraneas sin indice de cobertura
--
-- Postgres no indexa el lado que APUNTA de una clave foranea, solo el lado
-- apuntado. Asi que cada vez que se borra una fila de la tabla padre, el motor
-- tiene que recorrer la tabla hija entera para comprobar que no queda ninguna
-- referencia. Con once claves asi, borrar un perfil son once recorridos
-- secuenciales.
--
-- Hoy no duele: messages tiene 6 filas, audit_log 6, chats 3, y
-- disputes/reports/sale_confirmations estan a cero. El borrado real tarda
-- milisegundos. El problema es la forma de la curva, no el numero de hoy: el
-- coste crece LINEALMENTE con el tamano de cada tabla hija, y quien lo paga es
-- delete_user_data, que cascadea por casi todas ellas. Un usuario que se da de
-- baja cuando el marketplace tenga cien mil mensajes se encontraria con un
-- timeout, y el borrado de cuenta es precisamente lo que no puede fallar: es
-- una obligacion de la LFPDPPP, no una comodidad.
--
-- Se crea el indice ahora, con las tablas vacias, porque es cuando es gratis.
--
-- SOBRE CONCURRENTLY, que aqui NO se usa a proposito:
-- CREATE INDEX toma un lock que bloquea escrituras mientras construye. En una
-- tabla grande eso es inaceptable en produccion y la respuesta correcta es
-- CREATE INDEX CONCURRENTLY. Pero CONCURRENTLY no puede correr dentro de una
-- transaccion, y este archivo se aplica dentro de BEGIN...COMMIT junto con su
-- entrada en el ledger -- que es la propiedad que impide que quede produccion
-- cambiada y el ledger diciendo que no. Con la tabla mas grande a 6 filas, el
-- lock dura menos de lo que tarda en leerse esta frase. Si alguna de estas
-- tablas crece antes de que esto se aplique, hay que sacar ese indice a su
-- propia migracion sin transaccion.

CREATE INDEX IF NOT EXISTS idx_audit_log_actor_id
  ON public.audit_log (actor_id);

CREATE INDEX IF NOT EXISTS idx_categories_parent_id
  ON public.categories (parent_id);

CREATE INDEX IF NOT EXISTS idx_chats_ultimo_producto_id
  ON public.chats (ultimo_producto_id);

CREATE INDEX IF NOT EXISTS idx_disputes_admin_id
  ON public.disputes (admin_id);

CREATE INDEX IF NOT EXISTS idx_disputes_reported_id
  ON public.disputes (reported_id);

CREATE INDEX IF NOT EXISTS idx_disputes_reporter_id
  ON public.disputes (reporter_id);

CREATE INDEX IF NOT EXISTS idx_messages_publicacion_id
  ON public.messages (publicacion_id);

CREATE INDEX IF NOT EXISTS idx_reports_reviewed_by
  ON public.reports (reviewed_by);

CREATE INDEX IF NOT EXISTS idx_request_responses_linked_product_id
  ON public.request_responses (linked_product_id);

CREATE INDEX IF NOT EXISTS idx_sale_confirmations_cancelled_by
  ON public.sale_confirmations (cancelled_by);

CREATE INDEX IF NOT EXISTS idx_sale_confirmations_initiated_by
  ON public.sale_confirmations (initiated_by);

-- ---------------------------------------------------------------------------
-- Comprobar que sirvio de algo
--
-- No se comprueba que existan once indices con esos nombres -- eso solo dice
-- que las sentencias de arriba corrieron. Se comprueba la propiedad que
-- interesa: que ya no quede NINGUNA clave foranea de una sola columna sin un
-- indice que la cubra. Si manana alguien anade otra sin indice, esta consulta
-- es la que hay que volver a correr.
-- ---------------------------------------------------------------------------
DO $comprobacion$
DECLARE
  huerfanas text;
BEGIN
  SELECT string_agg(format('%s.%s', c.conrelid::regclass, a.attname), ', ')
    INTO huerfanas
  FROM pg_constraint c
  JOIN unnest(c.conkey) WITH ORDINALITY k(attnum, ord) ON true
  JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE c.contype = 'f'
    AND n.nspname = 'public'
    AND array_length(c.conkey, 1) = 1
    AND NOT EXISTS (
      SELECT 1 FROM pg_index i
       WHERE i.indrelid = c.conrelid
         AND i.indkey[0] = k.attnum
    );

  IF huerfanas IS NOT NULL THEN
    RAISE EXCEPTION 'siguen sin indice de cobertura: %', huerfanas;
  END IF;
END
$comprobacion$;
