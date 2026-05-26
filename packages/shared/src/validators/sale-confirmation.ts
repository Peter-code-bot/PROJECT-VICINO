import { z } from "zod";

// buyer_id / seller_id are NOT accepted here — they are derived server-side
// from the chat record to prevent client tampering.
export const createSaleConfirmationSchema = z.object({
  product_id: z.string().uuid(),
  chat_id: z.string().uuid(),
  precio_acordado: z.number().positive("El precio debe ser mayor a 0").max(99_999_999),
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
