-- Tighten "Owner delete product media" -- hallazgo colateral auditoría 2026-07-14.
--
-- Problema: la policy DELETE de product-media (20260320000017) solo exige
-- auth.uid() IS NOT NULL: cualquier usuario autenticado puede borrar CUALQUIER
-- objeto del bucket (fotos de productos ajenos y fotos de solicitudes).
-- verification-documents ya usa el patrón correcto folder-owner.
--
-- Fix: restringir DELETE al dueño de la carpeta ({user_id}/... es la convención
-- de subida en product-form y create-request-drawer). INSERT también se acota a
-- la carpeta propia para impedir escrituras en carpetas ajenas.
--
-- Delivery: Camino 2 (Pedro corre el WRITE en Studio, bloque C6 de SQL-5A, con
-- READ verify de paths no conformes antes de aplicar). Repo-of-record, NO via
-- `supabase db push`.
--
-- OJO drift: las policies permisivas se combinan con OR. El READ verify de SQL-5A
-- lista TODAS las policies de product-media; si la DB viva tiene policies
-- INSERT/DELETE con nombres distintos a los de 20260320000017 (creadas via
-- Studio), hay que DROPearlas por su nombre real o esta restriccion no aplica.

DROP POLICY IF EXISTS "Owner delete product media" ON storage.objects;
CREATE POLICY "Owner delete product media"
  ON storage.objects FOR DELETE
  USING (
    bucket_id = 'product-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );

DROP POLICY IF EXISTS "Authenticated upload product media" ON storage.objects;
CREATE POLICY "Authenticated upload product media"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'product-media'
    AND auth.uid()::text = (storage.foldername(name))[1]
  );
