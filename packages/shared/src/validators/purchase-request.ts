import { z } from "zod";
import { CATEGORIES } from "../constants/categories";

export const createPurchaseRequestSchema = z.object({
  operation_id: z.string().uuid(),
  request_title: z.string().trim().min(3, "Escribe un título de al menos 3 caracteres").max(100),
  request_description: z.string().trim().max(2000, "La descripción no puede pasar de 2000 caracteres").nullable().optional(),
  request_budget: z.number().finite().min(0, "El presupuesto no puede ser negativo").max(99999999.99).nullable().optional(),
  request_image_url: z.string().url().max(2048).refine(value => value.startsWith("https://"), "Imagen inválida").nullable().optional(),
  request_lat: z.number().finite().min(-90).max(90),
  request_lng: z.number().finite().min(-180).max(180),
  expiry_hours: z.union([z.literal(24), z.literal(72), z.literal(168)]).default(72),
  category_slugs: z.array(z.string().refine(slug => CATEGORIES.some(category => category.slug === slug), "Categoría inválida"))
    .min(1, "Selecciona al menos una categoría").max(3, "Selecciona hasta 3 categorías")
    .refine(slugs => new Set(slugs).size === slugs.length, "Las categorías no pueden repetirse"),
}).strict();

export type CreatePurchaseRequestInput = z.input<typeof createPurchaseRequestSchema>;
