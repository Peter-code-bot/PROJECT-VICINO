-- DATA-SAFE feature rollback. Run only after reverting the feature client.
-- Retain nullable columns, snapshots, local reviews and immutable/rating triggers:
-- existing local rows cannot satisfy old NOT NULL constraints, and live trigger bodies
-- still refer to origen. Never drop these columns or fabricate sale/product IDs.
-- Existing sale completion/cancellation and historic reads continue to work.
-- Disabling the new API is reversible by regranting exactly these privileges.
BEGIN;
REVOKE ALL ON FUNCTION public.publicar_resena_local(uuid,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.responder_intencion_compra(uuid,text,numeric,integer,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_chat_operations(uuid,jsonb,integer,uuid[]) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.leer_resenas_local(uuid,integer,integer) FROM PUBLIC,anon,authenticated;
COMMIT;
