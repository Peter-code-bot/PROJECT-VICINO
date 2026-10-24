import { z } from "zod";

export const operationCursorSchema = z.object({ createdAt: z.string(), id: z.string().uuid() });
export const chatOperationSchema = z.object({
  id: z.string().uuid(), intentMessageId: z.string().uuid().nullable(), saleId: z.string().uuid().nullable(),
  status: z.enum(["requested", "accepted", "pending_confirmation", "completed", "rejected", "cancelled", "expired", "legacy"]),
  source: z.enum(["purchase", "manual"]), productId: z.string().uuid().nullable(),
  title: z.string(), kind: z.enum(["product", "service"]), price: z.coerce.number().nullable(),
  quantity: z.number().int().positive(), notes: z.string().nullable(),
  buyerId: z.string().uuid(), sellerId: z.string().uuid(), initiatedBy: z.string().uuid(),
  buyerConfirmed: z.boolean(), sellerConfirmed: z.boolean(), createdAt: z.string(),
  completedAt: z.string().nullable(), cancelledAt: z.string().nullable(), cancelReason: z.string().nullable(),
  product: z.object({ id: z.string().uuid(), titulo: z.string(), slug: z.string().nullable(), categoria: z.string() }).nullable(),
  canRespond: z.boolean(), canConfirm: z.boolean(), canReject: z.boolean(),
});
export const chatOperationsPageSchema = z.object({ items: z.array(chatOperationSchema), nextCursor: operationCursorSchema.nullable() });
export type ChatOperation = z.infer<typeof chatOperationSchema>;
export type OperationCursor = z.infer<typeof operationCursorSchema>;
export type OperationProposal = { price: number; quantity: number; notes?: string };

export function operationForMessage(operations: ChatOperation[], message: { id: string; sale_confirmation_id?: string | null }) {
  return operations.find(op => op.intentMessageId === message.id || (message.sale_confirmation_id && op.saleId === message.sale_confirmation_id));
}

/** Accepting an intent replaces its key with the sale key; keep only the canonical operation. */
export function mergeOperations(previous: ChatOperation[], incoming: ChatOperation[]) {
  const next = new Map(previous.map(op => [op.id, op]));
  for (const op of incoming) {
    for (const [id, existing] of next) {
      if (id !== op.id && ((op.intentMessageId && op.intentMessageId === existing.intentMessageId) || (op.saleId && op.saleId === existing.saleId))) next.delete(id);
    }
    next.set(op.id, op);
  }
  return [...next.values()];
}
