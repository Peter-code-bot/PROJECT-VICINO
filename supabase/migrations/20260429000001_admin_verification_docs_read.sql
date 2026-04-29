-- Allow admins and moderators to read verification documents (INE/selfie).
-- Without this policy, the original "Owner read verification docs" policy
-- prevents admin from generating signed URLs for review, which broke the
-- entire verification approval flow.

CREATE POLICY "Admin read verification docs"
  ON storage.objects FOR SELECT
  USING (
    bucket_id = 'verification-documents'
    AND EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_id = auth.uid()
      AND role IN ('admin', 'moderator')
    )
  );
