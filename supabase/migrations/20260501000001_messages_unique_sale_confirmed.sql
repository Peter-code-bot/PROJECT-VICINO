-- Fix: prevent duplicate "venta confirmada" messages on rapid Confirm clicks.
-- Adds tracking columns + cleanup of historical duplicates + unique partial index.
-- Refs: VICINO mega prompt #03 — Fase 1
-- Reported by: Pedro (1-May-2026)

-- ─────────────────────────────────────────────────────────────────────────
-- 1) Tracking columns on messages
--    sale_confirmation_id: optional link to the confirmation that generated this message
--    message_type: discriminator ('user_text' | 'sale_confirmed' | future types)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE messages
  ADD COLUMN IF NOT EXISTS sale_confirmation_id UUID
    REFERENCES sale_confirmations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS message_type TEXT NOT NULL DEFAULT 'user_text';

-- ─────────────────────────────────────────────────────────────────────────
-- 2) Cleanup of historical duplicate "venta confirmada" messages.
--    Strategy: for each (chat_id, texto) pair, keep the OLDEST message and
--    delete subsequent identical-text duplicates that appeared within 5 minutes.
--    The 5-minute window protects legitimate later sales of the same product
--    (which typically happen hours/days apart, not within a single 5-min span).
-- ─────────────────────────────────────────────────────────────────────────
DELETE FROM messages m1
WHERE m1.texto LIKE '✅ ¡Venta confirmada%'
  AND EXISTS (
    SELECT 1
    FROM messages m2
    WHERE m2.chat_id = m1.chat_id
      AND m2.texto = m1.texto
      AND m2.created_at < m1.created_at
      AND m2.created_at > m1.created_at - INTERVAL '5 minutes'
  );

-- ─────────────────────────────────────────────────────────────────────────
-- 3) Unique partial index — defense in depth at the DB layer.
--    Only ONE message of message_type='sale_confirmed' per sale_confirmation_id.
--    The index is partial: it only kicks in when both columns are set (new
--    code path going forward). Historical messages have sale_confirmation_id
--    NULL and are ignored by this index.
-- ─────────────────────────────────────────────────────────────────────────
CREATE UNIQUE INDEX IF NOT EXISTS messages_unique_sale_confirmed
  ON messages (sale_confirmation_id)
  WHERE message_type = 'sale_confirmed' AND sale_confirmation_id IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────
-- ROLLBACK (manual, run in reverse order if revert is needed):
--
--   DROP INDEX IF EXISTS messages_unique_sale_confirmed;
--   ALTER TABLE messages DROP COLUMN IF EXISTS message_type;
--   ALTER TABLE messages DROP COLUMN IF EXISTS sale_confirmation_id;
--
-- ⚠️  Note: the duplicates removed by step 2 are NOT recoverable via rollback.
--    To restore them, use a Supabase backup (PITR is enabled by default on
--    the production project oxxdkwywprkfghhbnoto).
-- ─────────────────────────────────────────────────────────────────────────
