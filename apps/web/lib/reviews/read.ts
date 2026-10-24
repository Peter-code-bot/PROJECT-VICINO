import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { readSellerReviewsSchema, sellerReviewsSnapshotSchema } from "./contracts";

/** One database snapshot supplies the visible list, full aggregate and own editable review. */
export async function readSellerReviews(client: SupabaseClient<Database>, sellerId: string, offset = 0) {
  const input = readSellerReviewsSchema.parse({ sellerId, offset });
  const { data, error } = await client.rpc("leer_resenas_local", {
    p_reviewed_id: input.sellerId, p_offset: input.offset, p_limit: 20,
  });
  if (error) throw error;
  return sellerReviewsSnapshotSchema.parse(data);
}
