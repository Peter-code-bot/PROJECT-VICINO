import { z } from "zod";

export const createReviewSchema = z.object({
  sale_confirmation_id: z.string().uuid(),
  reviewed_id: z.string().uuid(),
  review_type: z.enum(["buyer_to_seller", "seller_to_buyer"]),
  rating: z.number().int().min(1).max(5),
  comentario: z.string().max(2000).optional(),
});

export const respondReviewSchema = z.object({
  review_id: z.string().uuid(),
  respuesta: z.string().min(1, "Escribe una respuesta").max(1000),
});

export type CreateReviewInput = z.infer<typeof createReviewSchema>;
export type RespondReviewInput = z.infer<typeof respondReviewSchema>;
