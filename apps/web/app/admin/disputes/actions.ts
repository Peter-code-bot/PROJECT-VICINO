"use server";

import { requireAdmin } from "@/lib/auth/require-admin";
import { resolveDisputeSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function resolveDispute(disputeId: string, resolution: string) {
  const { supabase, user } = await requireAdmin();

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = resolveDisputeSchema.safeParse({
    dispute_id: disputeId,
    resolution,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: isAdmin } = await supabase.rpc("has_role", {
    _user_id: user.id,
    _role: "admin",
  });
  return isAdmin ? user : null;
}

export async function resolveDispute(disputeId: string, resolution: string) {
  const parsed = resolveDisputeSchema.safeParse({ disputeId, resolution });
  if (!parsed.success) return { error: "Datos inválidos" };

  const admin = await requireAdmin();
  if (!admin) return { error: "No autorizado" };

  const supabase = await createClient();
  const { error } = await supabase
    .from("disputes")
    .update({
      status: parsed.data.resolution,
      resolucion: parsed.data.resolution,
      admin_id: user.id,
      resolved_at: new Date().toISOString(),
    })
    .eq("id", parsed.data.dispute_id);

  if (error) return { error: error.message };

  await supabase.from("audit_log").insert({
    actor_id: admin.id,
    action: "resolve_dispute",
    target_type: "dispute",
    target_id: parsed.data.disputeId,
    metadata: { resolution },
  });

  return { success: true };
}
