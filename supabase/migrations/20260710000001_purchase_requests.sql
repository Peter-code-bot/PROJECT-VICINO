-- Migración: Solicitudes (Marketplace Inverso) — MP#10
-- Corregida 2026-07-14 (auditoría): C1 profiles.foto (avatar_url no existe),
-- C2 CHECK constraints, C3 policy de ofertas exige expires_at > NOW(),
-- C4 trigger límite 3 categorías. Aplicación: Camino 2 (Studio), ver SQL-5A.
-- Propósito: Crear tablas para purchase_requests, purchase_request_categories
--            y request_responses con RLS, índices PostGIS y RPC de feed.
--
-- Arquitectura:
--   - purchase_requests: Solicitudes de compradores con geolocalización
--   - purchase_request_categories: Pivote M:N (misma lógica que product_categories)
--   - request_responses: Ofertas de vendedores con restricción UNIQUE por solicitud
--   - feed_nearby_requests: RPC geoespacial (replica feed_nearby_products)

-- =========================================================================
-- 1. ENUM para estado de solicitudes
-- =========================================================================
DO $$ BEGIN
  CREATE TYPE request_status AS ENUM ('open', 'closed', 'expired');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- =========================================================================
-- 2. TABLE purchase_requests
-- =========================================================================
CREATE TABLE IF NOT EXISTS purchase_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  buyer_id        UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  title           VARCHAR(100) NOT NULL,
  description     TEXT,
  budget_estimated NUMERIC,
  image_url       TEXT,
  ubicacion_geo   geography(POINT, 4326),
  status          request_status NOT NULL DEFAULT 'open',
  expires_at      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW(),
  CHECK (char_length(title) >= 3),
  CHECK (budget_estimated IS NULL OR budget_estimated >= 0),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_geo
  ON purchase_requests USING GIST(ubicacion_geo);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_status_created
  ON purchase_requests(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_requests_buyer
  ON purchase_requests(buyer_id);

-- =========================================================================
-- 3. TABLE purchase_request_categories (pivote M:N, replica product_categories)
-- =========================================================================
CREATE TABLE IF NOT EXISTS purchase_request_categories (
  request_id    UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  categoria_id  UUID NOT NULL REFERENCES categories(id) ON DELETE RESTRICT,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (request_id, categoria_id)
);

CREATE INDEX IF NOT EXISTS idx_prc_categoria
  ON purchase_request_categories(categoria_id);

-- Límite DB-side: máximo 3 categorías por solicitud (la UI también lo limita).
-- Best-effort bajo concurrencia (READ COMMITTED sin lock): dos tx simultáneas
-- podrían superar el cap. Aceptado: el insert del pivote ocurre una sola vez al
-- crear la solicitud desde un solo cliente; esto es defensa en profundidad.
CREATE OR REPLACE FUNCTION enforce_max_request_categories()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF (SELECT COUNT(*) FROM public.purchase_request_categories
      WHERE request_id = NEW.request_id) >= 3 THEN
    RAISE EXCEPTION 'max 3 categories per request' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_max_request_categories ON purchase_request_categories;
CREATE TRIGGER trg_max_request_categories
  BEFORE INSERT ON purchase_request_categories
  FOR EACH ROW EXECUTE FUNCTION enforce_max_request_categories();

-- =========================================================================
-- 4. TABLE request_responses (ofertas de vendedores)
-- =========================================================================
CREATE TABLE IF NOT EXISTS request_responses (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id        UUID NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  seller_id         UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  message_offer     TEXT NOT NULL,
  price_offer       NUMERIC,
  linked_product_id UUID REFERENCES products_services(id) ON DELETE SET NULL,
  created_at        TIMESTAMPTZ DEFAULT NOW(),
  CHECK (price_offer IS NULL OR price_offer >= 0),
  CHECK (char_length(message_offer) BETWEEN 1 AND 1000),
  UNIQUE (request_id, seller_id)
);

CREATE INDEX IF NOT EXISTS idx_request_responses_request
  ON request_responses(request_id);

CREATE INDEX IF NOT EXISTS idx_request_responses_seller
  ON request_responses(seller_id);

-- =========================================================================
-- 5. RLS — purchase_requests
-- =========================================================================
ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;

-- SELECT: todos los autenticados pueden ver solicitudes abiertas;
-- el dueño puede ver las suyas en cualquier estado.
CREATE POLICY "purchase_requests_select" ON purchase_requests
  FOR SELECT USING (
    status = 'open' OR buyer_id = auth.uid()
  );

-- INSERT: solo autenticados, y solo como su propio buyer_id.
CREATE POLICY "purchase_requests_insert" ON purchase_requests
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL AND buyer_id = auth.uid()
  );

-- UPDATE: solo el dueño puede actualizar (ej. cerrar la solicitud).
CREATE POLICY "purchase_requests_update" ON purchase_requests
  FOR UPDATE USING (buyer_id = auth.uid())
  WITH CHECK (buyer_id = auth.uid());

-- DELETE: solo el dueño.
CREATE POLICY "purchase_requests_delete" ON purchase_requests
  FOR DELETE USING (buyer_id = auth.uid());

-- =========================================================================
-- 6. RLS — purchase_request_categories
-- =========================================================================
ALTER TABLE purchase_request_categories ENABLE ROW LEVEL SECURITY;

-- SELECT: visible si la solicitud padre es visible.
CREATE POLICY "prc_select" ON purchase_request_categories
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = purchase_request_categories.request_id
        AND (pr.status = 'open' OR pr.buyer_id = auth.uid())
    )
  );

-- INSERT: solo el dueño de la solicitud.
CREATE POLICY "prc_insert" ON purchase_request_categories
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = purchase_request_categories.request_id
        AND pr.buyer_id = auth.uid()
    )
  );

-- DELETE: solo el dueño de la solicitud.
CREATE POLICY "prc_delete" ON purchase_request_categories
  FOR DELETE USING (
    auth.uid() IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = purchase_request_categories.request_id
        AND pr.buyer_id = auth.uid()
    )
  );

-- =========================================================================
-- 7. RLS — request_responses
-- =========================================================================
ALTER TABLE request_responses ENABLE ROW LEVEL SECURITY;

-- SELECT: todos los autenticados pueden ver ofertas de solicitudes abiertas
-- (transparencia pública). El dueño de la solicitud ve las suyas siempre.
CREATE POLICY "request_responses_select" ON request_responses
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = request_responses.request_id
        AND (pr.status = 'open' OR pr.buyer_id = auth.uid())
    )
    OR seller_id = auth.uid()
  );

-- INSERT: autenticado, como su propio seller_id, y la solicitud debe estar abierta (sin auto-ofertas).
CREATE POLICY "request_responses_insert" ON request_responses
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND seller_id = auth.uid()
    AND EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = request_responses.request_id
        AND pr.status = 'open'
        AND pr.expires_at > NOW()
        AND pr.buyer_id != auth.uid()
    )
  );

-- UPDATE: solo el vendedor puede editar su propia oferta.
CREATE POLICY "request_responses_update" ON request_responses
  FOR UPDATE USING (seller_id = auth.uid())
  WITH CHECK (seller_id = auth.uid());

-- DELETE: solo el vendedor puede borrar su propia oferta.
CREATE POLICY "request_responses_delete" ON request_responses
  FOR DELETE USING (seller_id = auth.uid());

-- =========================================================================
-- 8. RPC — feed_nearby_requests (replica feed_nearby_products)
-- =========================================================================
CREATE OR REPLACE FUNCTION feed_nearby_requests(
  user_lat      FLOAT,
  user_lng      FLOAT,
  radius_meters INT          DEFAULT 25000,
  cursor_time   TIMESTAMPTZ  DEFAULT NULL,
  result_limit  INT          DEFAULT 50,
  cat_slug      TEXT         DEFAULT NULL
)
RETURNS TABLE (
  id               UUID,
  buyer_id         UUID,
  title            VARCHAR(100),
  description      TEXT,
  budget_estimated NUMERIC,
  image_url        TEXT,
  status           request_status,
  expires_at       TIMESTAMPTZ,
  created_at       TIMESTAMPTZ,
  distance_meters  INT,
  buyer_profile    JSONB,
  categories       JSONB,
  response_count   BIGINT
) AS $$
  WITH snapped AS (
    SELECT
      ROUND(user_lat::numeric, 3)::FLOAT AS s_lat,
      ROUND(user_lng::numeric, 3)::FLOAT AS s_lng,
      LEAST(GREATEST((CEIL(radius_meters::FLOAT / 100) * 100 + 100)::INT, 1000), 50000) AS s_radius
  )
  SELECT
    pr.id,
    pr.buyer_id,
    pr.title,
    pr.description,
    pr.budget_estimated,
    pr.image_url,
    pr.status,
    pr.expires_at,
    pr.created_at,
    (CEIL(ST_Distance(pr.ubicacion_geo, ST_MakePoint(s.s_lng, s.s_lat)::geography)))::INT AS distance_meters,
    -- Buyer profile embed
    jsonb_build_object(
      'nombre',      bp.nombre,
      'avatar_url',  bp.foto
    ) AS buyer_profile,
    -- Categories embed
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'slug',   c.slug,
          'nombre', c.nombre
        )
      )
      FROM purchase_request_categories prc
      JOIN categories c ON c.id = prc.categoria_id
      WHERE prc.request_id = pr.id),
      '[]'::jsonb
    ) AS categories,
    -- Response count
    (SELECT COUNT(*) FROM request_responses rr WHERE rr.request_id = pr.id) AS response_count
  FROM purchase_requests pr
  CROSS JOIN snapped s
  JOIN profiles bp ON bp.id = pr.buyer_id
  WHERE
    pr.status = 'open'
    AND pr.expires_at > NOW()
    AND pr.ubicacion_geo IS NOT NULL
    AND ST_DWithin(
          pr.ubicacion_geo,
          ST_MakePoint(s.s_lng, s.s_lat)::geography,
          s.s_radius
        )
    AND (cursor_time IS NULL OR pr.created_at < cursor_time)
    AND (cat_slug IS NULL OR EXISTS (
      SELECT 1 FROM purchase_request_categories prc2
      JOIN categories c2 ON c2.id = prc2.categoria_id
      WHERE prc2.request_id = pr.id AND c2.slug = cat_slug
    ))
  ORDER BY pr.created_at DESC
  LIMIT LEAST(GREATEST(result_limit, 1), 100);
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION feed_nearby_requests(FLOAT, FLOAT, INT, TIMESTAMPTZ, INT, TEXT)
  TO anon, authenticated;

-- =========================================================================
-- 9. Auto-expire cron (marca solicitudes expiradas)
-- =========================================================================
-- Si pg_cron está disponible, registrar un job para marcar como expiradas.
-- Si no, se puede manejar en la RPC con la cláusula pr.expires_at > NOW().
DO $do$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.schedule(
      'expire-purchase-requests',
      '*/15 * * * *',
      $$UPDATE purchase_requests SET status = 'expired' WHERE status = 'open' AND expires_at <= NOW()$$
    );
  END IF;
END $do$;
