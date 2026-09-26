import { z } from "zod";

// buyer_id / seller_id are NOT accepted here — they are derived server-side
// from the product owner and the other chat participant to prevent tampering.
export const selectChatProductSchema = z.object({
  chatId: z.string().uuid(),
  productId: z.string().uuid(),
  expectedRevision: z.number().int().min(0).max(2_147_483_646),
});

export const getChatProductsSchema = z.object({
  chatId: z.string().uuid(),
  query: z.string().trim().max(100).optional(),
});

export const createSaleConfirmationSchema = z.object({
  product_id: z.string().uuid(),
  chat_id: z.string().uuid(),
  producto_revision: z.number().int().min(0).max(2_147_483_646),
  clave_idempotencia: z.string().uuid(),
  precio_acordado: z.number().positive("El precio debe ser mayor a 0").max(99_999_999).multipleOf(0.01, "Usa hasta dos decimales"),
  cantidad: z.number().int().positive().max(9999).default(1),
  metodo_pago: z.string().max(200).optional(),
  notas: z.string().max(1000).optional(),
  tipo_entrega: z.enum(["pickup", "envio"]).default("pickup"),
});

export const confirmSaleSchema = z.object({
  sale_confirmation_id: z.string().uuid(),
});

export const cancelSaleSchema = z.object({
  sale_confirmation_id: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export type CreateSaleConfirmationInput = z.infer<typeof createSaleConfirmationSchema>;
export type ConfirmSaleInput = z.infer<typeof confirmSaleSchema>;
export type CancelSaleInput = z.infer<typeof cancelSaleSchema>;
