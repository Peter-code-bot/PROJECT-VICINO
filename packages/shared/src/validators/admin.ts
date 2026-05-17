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

export const resolveDisputeSchema = z.object({
  dispute_id: z.string().uuid(),
  resolution: z.string().min(1, "Indica una resolución").max(500),
});

export type AssignRoleInput = z.infer<typeof assignRoleSchema>;
export type RemoveRoleInput = z.infer<typeof removeRoleSchema>;
export type ModerateReviewInput = z.infer<typeof moderateReviewSchema>;
export type ApproveVerificationInput = z.infer<typeof approveVerificationSchema>;
export type RejectVerificationInput = z.infer<typeof rejectVerificationSchema>;
export type ResolveDisputeInput = z.infer<typeof resolveDisputeSchema>;
