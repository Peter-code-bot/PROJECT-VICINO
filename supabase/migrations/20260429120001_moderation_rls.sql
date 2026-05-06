-- =============================================================================
-- VICINO Moderation: RLS para reports + user_blocks + bloqueo bidireccional
-- Fase 2 / 4 — RLS y reemplazo de policies SELECT permisivas
-- =============================================================================
--
-- IMPORTANTE — PostgreSQL OR'ea múltiples policies SELECT en la misma tabla.
-- Si dejamos las policies "Anyone can view ..." existentes y agregamos una
-- nueva "block_aware_..._select", el bloqueador SEGUIRÍA viendo al bloqueado
-- porque la policy permisiva matchea. Por eso aquí hacemos DROP + CREATE
-- atómico de las policies SELECT en profiles, reviews, products_services y
-- messages, fusionando la lógica original con el filtro de bloqueos.
-- =============================================================================

-- 1. RLS en reports -----------------------------------------------------------

ALTER TABLE public.reports ENABLE ROW LEVEL SECURITY;

-- Cualquier autenticado puede crear su propio reporte
CREATE POLICY "users_can_create_reports"
  ON public.reports FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = reporter_id);

-- Cada usuario ve solo sus propios reportes
CREATE POLICY "users_see_own_reports"
  ON public.reports FOR SELECT
  TO authenticated
  USING (auth.uid() = reporter_id);

-- Admins y moderadores ven todos los reportes
CREATE POLICY "admins_see_all_reports"
  ON public.reports FOR SELECT
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'moderator'::app_role)
  );

-- Solo admins/moderadores pueden actualizar (resolver / desestimar)
CREATE POLICY "admins_update_reports"
  ON public.reports FOR UPDATE
  TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'moderator'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'moderator'::app_role)
  );

-- 2. RLS en user_blocks -------------------------------------------------------

ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;

-- Un usuario administra solo sus propios bloqueos
CREATE POLICY "users_manage_own_blocks"
  ON public.user_blocks FOR ALL
  TO authenticated
  USING (auth.uid() = blocker_id)
  WITH CHECK (auth.uid() = blocker_id);

-- 3. Bloqueo bidireccional en SELECT de las 4 tablas de UGC -------------------
--
-- "Bidireccional" = si A bloquea a B, ni A ve a B ni B ve a A. Implementado
-- vía RLS para que el filtro sea transparente al frontend (no se necesita
-- WHERE NOT IN en cada query).

-- 3.1 Profiles ---------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can view profiles" ON public.profiles;

CREATE POLICY "block_aware_profiles_select"
  ON public.profiles FOR SELECT
  USING (
    -- siempre puedes ver tu propio perfil
    auth.uid() = id
    -- admins/moderadores ven todos
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'moderator'::app_role)
    -- el público anónimo (auth.uid() IS NULL) ve perfiles no ocultos
    OR (
      auth.uid() IS NULL
      AND is_hidden = FALSE
    )
    -- usuarios autenticados: perfiles no ocultos y sin bloqueo bidireccional
    OR (
      auth.uid() IS NOT NULL
      AND is_hidden = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
         WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = profiles.id)
            OR (ub.blocker_id = profiles.id AND ub.blocked_id = auth.uid())
      )
    )
  );

-- 3.2 Reviews ----------------------------------------------------------------

DROP POLICY IF EXISTS "Anyone can view visible reviews" ON public.reviews;

CREATE POLICY "block_aware_reviews_select"
  ON public.reviews FOR SELECT
  USING (
    -- el autor de la reseña siempre la ve (incluso si está oculta)
    auth.uid() = reviewer_id
    -- el reviewed también la ve (para responder)
    OR auth.uid() = reviewed_id
    -- admins/moderadores ven todo
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'moderator'::app_role)
    -- público anónimo: solo reviews no ocultas
    OR (
      auth.uid() IS NULL
      AND is_hidden = FALSE
      AND visible = TRUE
    )
    -- autenticado: review no oculta y sin bloqueo bidireccional con el reviewer
    OR (
      auth.uid() IS NOT NULL
      AND is_hidden = FALSE
      AND visible = TRUE
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
         WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = reviews.reviewer_id)
            OR (ub.blocker_id = reviews.reviewer_id AND ub.blocked_id = auth.uid())
      )
    )
  );

-- 3.3 Products / Services -----------------------------------------------------

DROP POLICY IF EXISTS "Anyone can view available products" ON public.products_services;

CREATE POLICY "block_aware_products_select"
  ON public.products_services FOR SELECT
  USING (
    -- creador siempre ve su propio producto (cualquier estatus)
    auth.uid() = creador_id
    -- admins/moderadores ven todo
    OR has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'moderator'::app_role)
    -- público anónimo: solo disponibles y no-ocultos
    OR (
      auth.uid() IS NULL
      AND estatus = 'disponible'
      AND is_hidden = FALSE
    )
    -- autenticado: disponible, no-oculto, sin bloqueo bidireccional con el creador
    OR (
      auth.uid() IS NOT NULL
      AND estatus = 'disponible'
      AND is_hidden = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
         WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = products_services.creador_id)
            OR (ub.blocker_id = products_services.creador_id AND ub.blocked_id = auth.uid())
      )
    )
  );

-- 3.4 Messages ----------------------------------------------------------------
-- La policy original ya restringe a participantes del chat. Le agregamos:
--   - filtrado de mensajes ocultos (is_hidden = FALSE)
--   - filtrado bidireccional por user_blocks contra el autor del mensaje

DROP POLICY IF EXISTS "Participants can view messages" ON public.messages;

CREATE POLICY "block_aware_messages_select"
  ON public.messages FOR SELECT
  USING (
    -- admins/moderadores ven todo
    has_role(auth.uid(), 'admin'::app_role)
    OR has_role(auth.uid(), 'moderator'::app_role)
    OR (
      EXISTS (
        SELECT 1 FROM public.chats
         WHERE chats.id = messages.chat_id
           AND (chats.comprador_id = auth.uid() OR chats.vendedor_id = auth.uid())
      )
      AND is_hidden = FALSE
      AND NOT EXISTS (
        SELECT 1 FROM public.user_blocks ub
         WHERE (ub.blocker_id = auth.uid() AND ub.blocked_id = messages.autor_id)
            OR (ub.blocker_id = messages.autor_id AND ub.blocked_id = auth.uid())
      )
    )
  );

-- =============================================================================
-- Notas:
--  • Las policies INSERT/UPDATE/DELETE existentes en profiles/reviews/products/
--    messages se mantienen intactas. Solo reemplazamos las SELECT.
--  • La policy "Admin can manage reviews" en reviews ya cubre admin SELECT vía
--    FOR ALL — pero la dejamos como defensa-en-profundidad. La nueva
--    block_aware_reviews_select agrega has_role(admin/moderator) explícitamente
--    para que también moderadores tengan SELECT (la legacy era solo admin).
-- =============================================================================
