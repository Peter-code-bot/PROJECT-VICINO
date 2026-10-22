"use server";

import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { VIDEO_INPUT_MAX_BYTES } from "./product-media-policy";
import type { VideoProcessingDatabase } from "./video-processing-db";

const idSchema = z.string().uuid();
class VideoRequestError extends Error {}
const uploadSchema = z.object({
  key: idSchema, size: z.number().int().positive().max(VIDEO_INPUT_MAX_BYTES),
  mime: z.enum(["video/mp4", "video/webm", "video/quicktime"]),
}).strict();

async function context() {
  if (process.env.MEDIA_VIDEO_PROCESSING_ENABLED !== "true") throw new VideoRequestError("La optimización de video aún no está disponible en esta versión de la app.");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new VideoRequestError("Tu sesión expiró. Vuelve a iniciar sesión.");
  // The client is the authenticated SSR client, with an isolated schema type
  // matching this feature's migration. No service key enters a user request.
  const db = client as unknown as SupabaseClient<VideoProcessingDatabase>;
  return { client, db, user };
}

export async function beginProductVideoProcessing(input: unknown) {
  try {
    const value = uploadSchema.parse(input);
    const { db, user } = await context();
    const rate = await enforce(writeRateLimit, `media-video:${user.id}`);
    if (!rate.ok) return { error: rate.error };
    const { data, error } = await db.rpc("reserve_product_video_job", { p_key: value.key, p_size: value.size, p_mime: value.mime });
    if (error || !data || data.user_id !== user.id) return { error: "No se pudo preparar la subida. Revisa tu cuota e inténtalo de nuevo." };
    return { job: { id: data.id, path: data.input_path, status: data.status } };
  } catch (error) {
    return { error: error instanceof z.ZodError ? "El archivo de video no es válido." : error instanceof VideoRequestError ? error.message : "No se pudo preparar el video." };
  }
}

export async function queueProductVideoProcessing(id: unknown) {
  try {
    const parsed = idSchema.parse(id);
    const { db } = await context();
    const { error } = await db.rpc("mark_product_video_uploaded", { p_job_id: parsed });
    return error ? { error: "No pudimos confirmar la subida del video." } : { ok: true };
  } catch { return { error: "No pudimos confirmar la subida del video." }; }
}

export async function getProductVideoProcessing(id: unknown) {
  try {
    const parsed = idSchema.parse(id);
    const { db, user } = await context();
    const { data, error } = await db.from("media_processing_jobs")
      .select("id,status,output_path,output_size,duration,error_code").eq("id", parsed).eq("user_id", user.id).single();
    if (error || !data) return { error: "No pudimos consultar el video. Inténtalo de nuevo." };
    const outputPath = `${user.id}/processed/${parsed}.mp4`;
    if (data.status === "ready" && data.output_path !== outputPath) return { error: "El resultado del video no es válido." };
    return { job: { ...data, url: data.status === "ready" ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-media/${outputPath}` : null } };
  } catch { return { error: "No pudimos consultar el video." }; }
}

export async function cancelProductVideoProcessing(id: unknown) {
  try {
    const parsed = idSchema.parse(id);
    const { db } = await context();
    const { error } = await db.rpc("cancel_product_video_job", { p_job_id: parsed });
    return { ok: !error };
  } catch { return { ok: false }; }
}
