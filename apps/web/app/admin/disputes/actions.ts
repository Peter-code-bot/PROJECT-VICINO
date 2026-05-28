"use server";

import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { requireAdmin } from "@/lib/auth/require-admin";
import { resolveDisputeSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

type ResolveDisputeArgs = {
  disputeId: string;
  decision: string;
  nota: string;
};

export async function resolveDispute(args: ResolveDisputeArgs) {
  let supabase: Awaited<ReturnType<typeof requireAdmin>>["supabase"];
  let userId: string;
  try {
    const ctx = await requireAdmin();
    supabase = ctx.supabase;
    userId = ctx.user.id;
  } catch {
    return { error: "No autorizado" };
  }

  const rate = await enforce(writeRateLimit, `write:${userId}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = resolveDisputeSchema.safeParse({
    dispute_id: args.disputeId,
    decision: args.decision,
    nota: args.nota,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
  }

  // RPC transaccional: UPDATE disputes + INSERT audit_log en una sola transaccion.
  // Cast a `any` temporal: los tipos generados por `supabase gen types` aun no
  // contemplan resolve_dispute_admin. Follow-up: regenerar tipos cuando
  // Supabase local este disponible.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await (supabase as any).rpc("resolve_dispute_admin", {
    p_dispute_id: parsed.data.dispute_id,
    p_decision: parsed.data.decision,
    p_nota: parsed.data.nota,
  });

  if (error) {
    // Log to Sentry without leaking the full error.message (may contain
    // PII from the RPC payload). Only the supabase code is safe to ship
    // as structured context. Follow-up MP07 #11 firma.
    Sentry.captureException(error, {
      tags: { action: "resolveDispute" },
      contexts: {
        dispute: { id: parsed.data.dispute_id },
        supabase: { code: (error as { code?: string }).code },
      },
    });
    const msg = String(error.message ?? "");
    if (msg.includes("dispute not found or already resolved")) {
      return { error: "Dispute no encontrada o ya resuelta" };
    }
    if (msg.includes("forbidden") || msg.includes("unauthenticated")) {
      return { error: "No autorizado" };
    }
    if (msg.includes("invalid decision")) {
      return { error: "Decisión inválida" };
    }
    return { error: "No se pudo resolver la disputa. Intenta de nuevo." };
  }

  revalidatePath("/admin/disputes");
  return { success: true };
}
