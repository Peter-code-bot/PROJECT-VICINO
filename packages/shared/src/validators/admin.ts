import { z } from "zod";

const roleEnum = z.enum(["admin", "moderator", "user"]);

export const assignRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: roleEnum,
});

export const removeRoleSchema = z.object({
  user_id: z.string().uuid(),
  role: roleEnum,
});

export const moderateReviewSchema = z.object({
  review_id: z.string().uuid(),
});

export const approveVerificationSchema = z.object({
  verification_id: z.string().uuid(),
  user_id: z.string().uuid(),
});

export const rejectVerificationSchema = z.object({
  verification_id: z.string().uuid(),
  note: z.string().max(1000).default(""),
});

export const disputeDecisionEnum = z.enum([
  "resolved_buyer",
  "resolved_seller",
  "closed",
]);

export const resolveDisputeSchema = z
  .object({
    dispute_id: z.string().uuid(),
    decision: disputeDecisionEnum,
    nota: z.string().trim().max(2000).default(""),
  })
  .refine((d) => d.decision === "closed" || d.nota.length >= 10, {
    path: ["nota"],
    message: "La nota es obligatoria (al menos 10 caracteres) al resolver a favor de una parte",
  });

export type DisputeDecision = z.infer<typeof disputeDecisionEnum>;

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
export type RemoveRoleInput = z.infer<typeof removeRoleSchema>;
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;
export type ApproveVerificationInput = z.infer<typeof approveVerificationSchema>;
export type RejectVerificationInput = z.infer<typeof rejectVerificationSchema>;
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
