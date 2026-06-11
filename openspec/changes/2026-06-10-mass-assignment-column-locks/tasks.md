# Tasks -- CH-3: mass-assignment column locks + sale RPCs (#5/#6/#7)

> FASE C (Studio) was done first (Pedro applied + verified). FASE A/B record + mirror.

## FASE A -- OpenSpec
- [x] proposal.md, design.md, tasks.md, specs/mass-assignment/spec.md, studio-script.sql

## FASE B -- mirror migrations + app edits + commit
- [x] 20260610000004_ch3_stats_triggers_security_definer.sql (5 ALTER FUNCTION; idempotent)
- [x] 20260610000005_ch3_column_locks_and_view_rpc.sql (#5/#7 REVOKE/GRANT + increment_product_view)
- [x] 20260610000006_ch3_sale_confirmation_rpcs.sql (#6 confirm_sale/cancel_sale + REVOKE)
- [x] 20260610000008_ch3e_moderation_rpcs.sql (#7 collateral: moderate_set_content_hidden + moderate_review)
- [x] app: chat/actions.ts confirmSale -> confirm_sale; cancelSale -> cancel_sale (returns chat_id)
- [x] app: [categoria]/[slug]/page.tsx vistas_count UPDATE -> increment_product_view
- [x] app: admin/moderation/actions.ts hideReview/approveReview -> moderate_review;
      resolveReport(hideTarget)/suspendUser/unsuspendUser/unhideListing -> moderate_set_content_hidden;
      errors surfaced (fixed resolveReport swallowing 42501 as success)
- [x] errors propagated to UI (error.message || "Error desconocido"); "ya modificada" preserved
- [x] pnpm build green
- [x] residual-write grep: only foto/fcm_token (profiles), allowlist (products), respuesta
      (reviews), INSERT (sale_confirmations) remain; NO stats/flags/is_hidden
- [x] CODEX adversarial review; HIGH -> STOP

## FASE C -- Studio (DONE)
- [x] CH-3a profiles REVOKE/GRANT; CH-3b products REVOKE/allowlist + increment_product_view;
      CH-3c reviews REVOKE/GRANT; CH-3a-fix 5 stat triggers -> DEFINER; CH-3d sale RPCs + REVOKE
- [x] CH-3e moderation RPCs (moderate_set_content_hidden, moderate_review) + REVOKE anon
- [ ] P-CH3e-REAPPLY (Pedro): the LIVE RPCs allow admin OR moderator; CODEX found a moderator can
      suspend users / moderate reviews via direct RPC. RE-APPLY the narrowed guard from the mirror
      (moderate_review admin-only; moderate_set_content_hidden admin-only for profile/user targets).
- [ ] P-reconcile: `pg_get_functiondef` for confirm_sale/cancel_sale/increment_product_view vs mirror;
      confirm the 5 stat triggers have prosecdef=true
- [ ] P-smoke: direct PATCH of is_verified/vistas_count/sale flags -> 42501; legit flows still work;
      sale completion + rating recompute still fire

## Closing
- [ ] shipped with the P0/CH-2 PR (same branch). Merge + archive after sign-off.

## Out of scope
- #9 products INSERT es_vendedor gate (CH-4); #2 PII column SELECT (separate); #14 has_role (LAST).
