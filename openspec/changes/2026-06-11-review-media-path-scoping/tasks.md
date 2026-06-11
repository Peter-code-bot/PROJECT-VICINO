# Tasks -- #12: review-media path-scoping

## FASE A -- app (DONE, commit 8d06342)
- [x] review-form.tsx uploadMedia path -> `${user.id}/${saleConfirmationId}/${ts}-${i}.${ext}`
- [x] user.id fetched once via supabase.auth.getUser() before the loop (guard if !user)
- [x] getPublicUrl reuses the new path -> preview correct
- [x] repo sweep: review-media touched ONLY in review-form.tsx; no other upload/read on old path
- [x] pnpm build green

## FASE B -- OpenSpec + mirror (this change)
- [x] proposal.md, design.md, tasks.md, specs/storage/spec.md, studio-script.sql
- [x] 20260611000002_review_media_path_scoping.sql (DROP loose INSERT + CREATE owner INSERT/DELETE)
- [x] CODEX review; HIGH -> STOP

## FASE C -- Studio (DONE, PASO 2)
- [x] DROP "Authenticated upload review media"; CREATE "Owner upload review media"
      (INSERT, WITH CHECK foldername[1]=auth.uid()::text)
- [x] CREATE "Owner delete review media" (DELETE, USING foldername[1]=auth.uid()::text)
- [x] "Public read review media" (SELECT public) left intact
- [ ] P-reconcile: pg_policies for storage.objects review-media == exactly {Owner upload, Owner
      delete, Public read}; assert "Authenticated upload review media" is ABSENT (PERMISSIVE OR risk)
- [ ] P-smoke (SET LOCAL ROLE authenticated; BEGIN/ROLLBACK):
      - INSERT name='<other-uuid>/x.jpg' -> rejected (42501)
      - INSERT name='<self-uuid>/x.jpg' bucket review-media -> ok
      - DELETE of an object under another uuid prefix -> rejected
      - end-to-end: submit a review with a photo -> uploads + previews

## Out of scope
- Backfill/re-path of existing review-media objects (old URLs still served by public SELECT).
- Bucket/app mime mismatch (form offers video 50MB; bucket allows image/* only) -- pre-existing
  follow-up, unrelated to authz.
