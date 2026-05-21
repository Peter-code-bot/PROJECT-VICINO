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
    actor_id: user.id,
    action: "resolve_dispute",
    target_type: "dispute",
    target_id: parsed.data.dispute_id,
    metadata: { resolution: parsed.data.resolution },
  });

  return { success: true };
}
