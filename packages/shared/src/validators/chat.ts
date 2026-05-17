import { z } from "zod";

export const sendMessageSchema = z.object({
  chat_id: z.string().uuid(),
  texto: z.string().min(1, "El mensaje no puede estar vacío").max(2000),
});

export const getOrCreateChatSchema = z.object({
  seller_id: z.string().uuid(),
  product_id: z.string().uuid().optional(),
});

export const markChatReadSchema = z.object({
  chat_id: z.string().uuid(),
});

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type GetOrCreateChatInput = z.infer<typeof getOrCreateChatSchema>;
export type MarkChatReadInput = z.infer<typeof markChatReadSchema>;
