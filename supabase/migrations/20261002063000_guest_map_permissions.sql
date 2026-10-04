-- Guest Home reads search_nearby_products_v4 and the static preview.
-- Interactive map reads require a session, including direct PostgREST calls.
REVOKE ALL ON FUNCTION public.search_map_publications_v1(jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.search_map_publications_v2(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_map_publications_v1(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.search_map_publications_v2(jsonb) TO authenticated, service_role;

-- Rollback after restoring the previous application:
-- GRANT EXECUTE ON FUNCTION public.search_map_publications_v1(jsonb) TO anon;
-- GRANT EXECUTE ON FUNCTION public.search_map_publications_v2(jsonb) TO anon;
