// MediaAsset interface mirroring the schema in
// supabase/migrations/20260320000006_media_assets.sql, tightened with
// ownership-aware RLS and backfilled from products_services.galeria_imagenes
// in supabase/migrations/20260528000001_media_assets_rls_tighten_and_backfill.sql
// (Sesion 5a). Write path wired in Sesion 5b. Render switch (read path)
// deferred to MP#07 #7-5c behind a feature flag.

export type MediaOwnerType =
  | "producto"
  | "servicio"
  | "profile"
  | "review"
  | "chat";

export type MediaType = "image" | "video" | "audio";

export interface MediaAsset {
  id: string;
  owner_type: MediaOwnerType;
  owner_id: string;
  type: MediaType;
  url_original: string;
  url_optimized: string | null;
  url_thumbnail: string | null;
  width: number | null;
  height: number | null;
  size_kb: number | null;
  duration_sec: number | null;
  order_index: number;
  created_at: string;
  updated_at: string;
}

// Shape used at insert time: omits server-defaulted fields (id, timestamps)
// and the nullable enrichment columns (optimized, thumbnail, dimensions, sizes,
// duration) that the write path does not populate today. Useful as the
// argument type for media_assets INSERT calls in server actions.
export type MediaAssetInsert = Pick<
  MediaAsset,
  "owner_type" | "owner_id" | "type" | "url_original" | "order_index"
>;
