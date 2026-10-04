-- S02 is live (PR52, 6c3750d). End the temporary guest-map compatibility grant.
-- Keep Home's product/static previews public through their existing RPCs.
-- Signatures, definitions, authenticated/service_role ACL and RLS are unchanged.
REVOKE EXECUTE ON FUNCTION public.search_map_publications_v1(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.search_map_publications_v2(jsonb) FROM PUBLIC, anon;
