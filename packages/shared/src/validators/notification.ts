import { z } from "zod";

export const markNotificationReadSchema = z.object({
  notification_id: z.string().uuid(),
});

export type MarkNotificationReadInput = z.infer<typeof markNotificationReadSchema>;
