"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { chatOperationsPageSchema, type ChatOperation, type OperationCursor } from "@/lib/chat/operations";
import { enforce, chatReadRateLimit } from "@/lib/rate-limit";
import { getChatSalesHistorySchema as inputSchema } from "@vicino/shared";

export async function getChatOperations(input: z.input<typeof inputSchema>): Promise<{
  items: ChatOperation[]; nextCursor: OperationCursor | null; error?: string;
}> {
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) return { items: [], nextCursor: null, error: "Datos de consulta inválidos." };
  try {
    const client = await createClient();
    const { data: { user }, error: authError } = await client.auth.getUser();
    if (authError || !user) return { items: [], nextCursor: null, error: "Inicia sesión para consultar las operaciones." };
    const rate = await enforce(chatReadRateLimit, `chat-read:${user.id}`);
    if (!rate.ok) return { items: [], nextCursor: null, error: rate.error };
    const { data, error } = await client.rpc("get_chat_operations", {
      p_chat_id: parsed.data.chatId, p_cursor: parsed.data.cursor ?? undefined,
      p_limit: parsed.data.limit, p_ids: parsed.data.ids,
    });
    if (error) return { items: [], nextCursor: null, error: "No se pudieron consultar las operaciones. Reintenta." };
    const result = chatOperationsPageSchema.safeParse(data);
    if (!result.success) return { items: [], nextCursor: null, error: "No se pudo comprobar el estado de las operaciones. Reintenta." };
    return result.data;
  } catch {
    return { items: [], nextCursor: null, error: "No se pudo conectar. Conservamos el chat; reintenta la consulta." };
  }
}
