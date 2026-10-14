"use server";

import { createPurchaseRequestSchema } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { isKnownRequestRejection, type RequestCreationResult } from "@/lib/solicitudes/request-creation";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function createPurchaseRequest(input: unknown): Promise<RequestCreationResult> {
  const parsed = createPurchaseRequestSchema.safeParse(input);
  if (!parsed.success) return { status: "rejected", message: parsed.error.issues.at(0)?.message ?? "Revisa tu solicitud" };
  try {
    const supabase = await createClient();
    const { data: { user }, error: authError } = await supabase.auth.getUser();
    if (authError || !user) return { status: "rejected", message: "Inicia sesión para publicar" };
    const rate = await enforce(writeRateLimit, `write:${user.id}`);
    if (!rate.ok) return { status: "rejected", message: rate.error };
    const request = parsed.data;
    if (request.request_image_url) {
      const image = new URL(request.request_image_url);
      const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).origin;
      if (image.origin !== origin || !image.pathname.startsWith(`/storage/v1/object/public/product-media/${user.id}/solicitudes-${request.operation_id}.`)) {
        return { status: "rejected", message: "La imagen de referencia no es válida" };
      }
    }
    const { data, error } = await supabase.rpc("create_purchase_request_v2", {
      operation_id: request.operation_id, request_title: request.request_title,
      request_lat: request.request_lat, request_lng: request.request_lng, category_slugs: request.category_slugs,
      request_description: request.request_description || undefined, request_budget: request.request_budget ?? undefined,
      request_image_url: request.request_image_url ?? undefined, expiry_hours: request.expiry_hours,
    });
    if (error && isKnownRequestRejection(error.code)) {
      return { status: "rejected", message: error.code === "22023"
        ? "Revisa las categorías y elige una ubicación dentro de la zona donde VICINO opera."
        : error.code === "42501" ? "Tu cuenta no puede publicar esta solicitud."
        : "No se pudo publicar la solicitud. Revisa los datos e intenta de nuevo." };
    }
    if (error || data !== request.operation_id) return { status: "uncertain", message: "No pudimos confirmar la publicación. Reintenta para comprobar la misma solicitud." };
    return { status: "success", id: data };
  } catch {
    return { status: "uncertain", message: "No pudimos confirmar la publicación. Reintenta para comprobar la misma solicitud." };
  }
}
