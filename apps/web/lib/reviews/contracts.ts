import { z } from "zod";

export const localReviewSchema = z.object({
  id: z.string().uuid(), rating: z.number().int().min(1).max(5),
  comentario: z.string().nullable(), visible: z.boolean(),
});

export const sellerReviewSchema = z.object({
  id: z.string().uuid(), rating: z.number().int().min(1).max(5),
  comentario: z.string().nullable(), created_at: z.string(),
  review_type: z.string().nullable(), reviewer_id: z.string().uuid(),
  respuesta: z.string().nullable(), respuesta_fecha: z.string().nullable(),
  is_verified: z.boolean(),
  profiles: z.object({
    nombre: z.string().nullable(), foto: z.string().nullable(),
    trust_level: z.string().nullable().optional(),
    es_vendedor: z.boolean().nullable(),
    seller_type: z.string().nullable(),
    nombre_negocio: z.string().nullable(),
  }).nullable(),
  products_services: z.object({
    id: z.string().uuid(), titulo: z.string(), categoria: z.string(), slug: z.string().nullable(),
    imagen_principal: z.string().nullable().optional(),
  }).nullable(),
});

export const reviewSummarySchema = z.object({
  count: z.number().int().nonnegative(), average: z.number().min(0).max(5),
  buckets: z.object({
    1: z.number().int().nonnegative(), 2: z.number().int().nonnegative(),
    3: z.number().int().nonnegative(), 4: z.number().int().nonnegative(),
    5: z.number().int().nonnegative(),
  }),
}).refine((summary) => Object.values(summary.buckets).reduce((sum, count) => sum + count, 0) === summary.count,
  "La distribución debe coincidir con el total visible");

export const sellerReviewsSnapshotSchema = z.object({
  reviews: z.array(sellerReviewSchema), summary: reviewSummarySchema,
  own_local_review: localReviewSchema.nullable(),
});

export const readSellerReviewsSchema = z.object({
  sellerId: z.string().uuid(), offset: z.number().int().min(0).default(0),
});

export type SellerReviewSummary = z.infer<typeof reviewSummarySchema>;
export type OwnLocalReview = z.infer<typeof localReviewSchema>;
export type SellerReviewsSnapshot = z.infer<typeof sellerReviewsSnapshotSchema>;

export const EMPTY_REVIEW_SUMMARY: SellerReviewSummary = {
  count: 0, average: 0, buckets: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 },
};
