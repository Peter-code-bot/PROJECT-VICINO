import { z } from "zod";

// Espejo de los enums de Postgres definidos en
// supabase/migrations/20260429120000_moderation_reports.sql y ampliados en
// supabase/migrations/20260912210000_comunidades_report_target.sql
// ('community_post': publicacion o comentario del muro de una comunidad).
//
// ESTE ARRAY ES UN ESPEJO QUE EL BUILD NO VIGILA. Si la base gana un valor y
// aqui falta, /api/reports responde 400 al reportarlo y report-modal.tsx hace
// REPORT_REASONS_BY_TARGET[targetType].map sobre undefined. Cada valor nuevo
// entra en los TRES mapas de abajo a la vez.
export const REPORT_TARGET_TYPES = [
  "listing",
  "user",
  "message",
  "review",
  "community_post",
] as const;

export const REPORT_REASONS = [
  "spam",
  "inappropriate_content",
  "fraud_or_scam",
  "harassment",
  "fake_profile",
  "illegal_product",
  "copyright_violation",
  "child_safety",
  "other",
] as const;

export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];
export type ReportReason = (typeof REPORT_REASONS)[number];

export const createReportSchema = z.object({
  target_type: z.enum(REPORT_TARGET_TYPES),
  target_id: z.string().uuid(),
  reason: z.enum(REPORT_REASONS),
  description: z.string().max(500).optional().nullable(),
});

export type CreateReportInput = z.infer<typeof createReportSchema>;

// Etiquetas en español para la UI. Mantener sincronizado con REPORT_REASONS.
export const REPORT_REASON_LABELS: Record<ReportReason, string> = {
  spam: "Spam",
  inappropriate_content: "Contenido inapropiado",
  fraud_or_scam: "Fraude o estafa",
  harassment: "Acoso",
  fake_profile: "Perfil falso",
  illegal_product: "Producto ilegal",
  copyright_violation: "Violación de derechos de autor",
  child_safety: "Seguridad infantil",
  other: "Otro",
};

// Razones aplicables por tipo de target. Si una razón está vacía → no se muestra.
export const REPORT_REASONS_BY_TARGET: Record<ReportTargetType, readonly ReportReason[]> = {
  listing: [
    "spam",
    "inappropriate_content",
    "fraud_or_scam",
    "illegal_product",
    "copyright_violation",
    "child_safety",
    "other",
  ],
  user: [
    "harassment",
    "fake_profile",
    "fraud_or_scam",
    "inappropriate_content",
    "child_safety",
    "other",
  ],
  message: [
    "harassment",
    "spam",
    "inappropriate_content",
    "fraud_or_scam",
    "child_safety",
    "other",
  ],
  review: [
    "spam",
    "inappropriate_content",
    "harassment",
    "fraud_or_scam",
    "other",
  ],
  // Muro de comunidad: texto libre entre vecinos. Se parece mas a un mensaje
  // que a un producto: acoso y spam delante; illegal_product no aplica porque
  // una publicacion no vende nada.
  community_post: [
    "spam",
    "harassment",
    "inappropriate_content",
    "fraud_or_scam",
    "child_safety",
    "other",
  ],
};

export const REPORT_TARGET_LABELS: Record<ReportTargetType, string> = {
  listing: "producto",
  user: "usuario",
  message: "mensaje",
  review: "reseña",
  community_post: "publicación",
};
