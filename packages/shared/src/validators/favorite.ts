import { z } from "zod";

export const toggleFavoriteSchema = z.object({
  product_id: z.string().uuid(),
});

export type ToggleFavoriteInput = z.infer<typeof toggleFavoriteSchema>;
