import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { productMapZone } from "@/lib/geo/product-map-zone";
import { productMapSnapshot } from "@/lib/geo/product-map-snapshot";
import { enforce, getClientIp, readHeavyRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  const id = z.string().uuid().safeParse((await params).id);
  if (!id.success) return new Response(null, { status: 404, headers });
  try {
    const limit = await enforce(readHeavyRateLimit, `product-map:${getClientIp(request.headers)}`);
    if (!limit.ok) return new Response(null, { status: 429, headers });
    const supabase = await createClient();
    // RLS enforces status, visibility, blocks and creator access.
    const { data: visible, error } = await supabase.from("products_services")
      .select("id, updated_at").eq("id", id.data).neq("estatus", "eliminado").maybeSingle();
    if (error || !visible) return new Response(null, { status: 404, headers });
    // Privileged geometry read only after authorization; pin its version to reject a concurrent edit.
    const query = createAdminClient().from("products_services").select("ubicacion_geo")
      .eq("id", visible.id).neq("estatus", "eliminado");
    const { data: location } = await (visible.updated_at
      ? query.eq("updated_at", visible.updated_at) : query.is("updated_at", null)).maybeSingle();
    const zone = productMapZone(location?.ubicacion_geo);
    if (!zone) return new Response(null, { status: 404, headers });
    const bytes = await productMapSnapshot(zone, new URL(request.url).searchParams.get("theme") === "dark");
    return new Response(bytes, { headers: { ...headers, "Content-Type": "image/png" } });
  } catch {
    // Never log signed URLs, credentials or private geometry.
    return new Response(null, { status: 503, headers });
  }
}
