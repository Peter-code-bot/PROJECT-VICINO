"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  sendMessageSchema,
  getOrCreateChatSchema,
  markChatReadSchema,
  createSaleConfirmationSchema,
  confirmSaleSchema,
  cancelSaleSchema,
} from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function getOrCreateChat(sellerId: string, productId?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = getOrCreateChatSchema.safeParse({
    seller_id: sellerId,
    product_id: productId,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // Defense in depth: reject self-chat at the server boundary. The owner-
  // in-preview UX path is covered by the PreviewBanner + chat/page.tsx
  // redirect to /chat?selfChatError=1, but a direct POST that bypasses
  // the UI would still hit get_or_create_chat without this check.
  if (user.id === parsed.data.seller_id) {
    return { error: "No puedes iniciar un chat contigo mismo" };
  }

  const { data: chatId, error } = await supabase.rpc("get_or_create_chat", {
    p_comprador_id: user.id,
    p_vendedor_id: parsed.data.seller_id,
    p_producto_id: parsed.data.product_id ?? null,
  });

  if (error) return { error: error.message };
  return { chatId: chatId as string };
}

/**
 * A5.1: cursor-based load-older for chat history.
 *
 * Returns messages strictly OLDER than `cursor` (ISO timestamp of the
 * currently-oldest message in view), ordered ASC for prepend at the
 * top of the existing list. `nextCursor` is the created_at of the
 * OLDEST returned item if the page was full; null otherwise (signals
 * "no more pages" to use-infinite-cursor.hasMore).
 *
 * RLS enforced: the SSR initial 50 in app/(marketplace)/chat/[id]/page.tsx
 * uses the same Supabase client and the same chats/messages policies.
 * If a user is not a participant of `chatId`, the SELECT returns 0 rows.
 */
export async function getMessagesBefore(
  chatId: string,
  cursor: string,
  limit: number = 30,
): Promise<{
  items: Array<{
    id: string;
    chat_id: string;
    autor_id: string;
    texto: string;
    attachments: unknown;
    created_at: string;
    leido_por_comprador: boolean;
    leido_por_vendedor: boolean;
  }>;
  nextCursor: string | null;
  error?: string;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { items: [], nextCursor: null, error: "No autenticado" };

  // CODEX M4 fix: validate the cursor BEFORE issuing the query. The
  // cursor is a client-supplied string; if it is not a valid ISO
  // timestamp, Supabase/Postgres rejects the cast with a verbose
  // message ("invalid input syntax for type timestamp with time zone")
  // that would leak DB internals to the client. Return a generic
  // error instead and never touch the DB on a malformed cursor.
  if (Number.isNaN(Date.parse(cursor))) {
    return { items: [], nextCursor: null, error: "Cursor invalido" };
  }

  // CODEX H2 fix: clamp the limit so a hostile direct caller cannot
  // request a huge page. 50 is generous for the chat load-older case
  // (the default is 30) without exposing the table to a 10k-row scan.
  const safeLimit = Math.min(Math.max(1, limit), 50);

  // Fetch DESC by created_at + .lt(cursor) to get the immediately-older
  // page. Reverse to ASC for the call-site to prepend without
  // additional sort. nextCursor = the oldest (now first) item's
  // created_at if the page filled; null otherwise.
  // Fetch the chat to check soft-delete timestamps for the current user
  const { data: chat } = await supabase
    .from("chats")
    .select("comprador_id, vendedor_id, deleted_at_comprador, deleted_at_vendedor")
    .eq("id", chatId)
    .single();

  if (!chat) return { items: [], nextCursor: null, error: "Chat no encontrado" };
  if (user.id !== chat.comprador_id && user.id !== chat.vendedor_id) {
    return { items: [], nextCursor: null, error: "No autorizado" };
  }

  const isBuyer = user.id === chat.comprador_id;
  const deletedAt = isBuyer ? chat.deleted_at_comprador : chat.deleted_at_vendedor;

  const messagesQuery = supabase
    .from("messages")
    .select(
      "id, chat_id, autor_id, texto, attachments, created_at, leido_por_comprador, leido_por_vendedor",
    )
    .eq("chat_id", chatId)
    .lt("created_at", cursor)
    .order("created_at", { ascending: false })
    .limit(safeLimit);

  if (deletedAt) {
    messagesQuery.gt("created_at", deletedAt);
  }

  const { data, error } = await messagesQuery;

  if (error) return { items: [], nextCursor: null, error: error.message };

  const items = (data ?? []).reverse();
  const nextCursor = items.length === safeLimit ? items[0]!.created_at : null;
  return { items, nextCursor };
}

export async function sendMessage(chatId: string, texto: string) {
  if (!texto || typeof texto !== "string") return { error: "Mensaje inválido" };
  // Strip HTML tags without entity-encoding: chat renders as plain text so React handles XSS
  const safeTexto = texto.trim().replace(/<[^>]*>/g, "");
  if (!safeTexto || safeTexto.length > 2000) return { error: "Mensaje inválido" };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = sendMessageSchema.safeParse({ chat_id: chatId, texto });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Mensaje inválido" };
  }

  const { data: inserted, error } = await supabase
    .from("messages")
    .insert({
      chat_id: parsed.data.chat_id,
      autor_id: user.id,
      texto: parsed.data.texto,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };
  if (!inserted) return { error: "No se pudo enviar el mensaje" };
  return { success: true as const, data: { id: inserted.id } };
}

export async function markAsRead(chatId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return;

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return;

  const parsed = markChatReadSchema.safeParse({ chat_id: chatId });
  if (!parsed.success) return;

  await supabase.rpc("mark_messages_as_read", {
    p_chat_id: parsed.data.chat_id,
    p_user_id: user.id,
  });
}

export async function createSaleConfirmation(data: {
  productId: string;
  chatId: string;
  precioAcordado: number;
  cantidad: number;
  metodoPago?: string;
  notas?: string;
  tipoEntrega: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = createSaleConfirmationSchema.safeParse({
    product_id: data.productId,
    chat_id: data.chatId,
    precio_acordado: data.precioAcordado,
    cantidad: data.cantidad,
    metodo_pago: data.metodoPago,
    notas: data.notas,
    tipo_entrega: data.tipoEntrega === "envio" ? "envio" : "pickup",
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // Derive buyer/seller server-side from chat record — never trust client-supplied IDs.
  const { data: chat, error: chatErr } = await supabase
    .from("chats")
    .select("comprador_id, vendedor_id")
    .eq("id", parsed.data.chat_id)
    .single();

  if (chatErr || !chat) {
    if (chatErr) console.error("[createSaleConfirmation] chat lookup:", chatErr);
    return { error: chatErr?.message ?? "Chat no encontrado" };
  }

  if (user.id !== chat.comprador_id && user.id !== chat.vendedor_id) {
    return { error: "No autorizado para este chat" };
  }

  const { data: confirmation, error } = await supabase
    .from("sale_confirmations")
    .insert({
      product_id: parsed.data.product_id,
      buyer_id: chat.comprador_id,
      seller_id: chat.vendedor_id,
      chat_id: parsed.data.chat_id,
      precio_acordado: parsed.data.precio_acordado,
      cantidad: parsed.data.cantidad,
      metodo_pago: parsed.data.metodo_pago ?? null,
      notas: parsed.data.notas ?? null,
      tipo_entrega: parsed.data.tipo_entrega,
      initiated_by: user.id,
    })
    .select()
    .single();

  if (error) {
    if (error.code === "23505") return { error: "Ya hay una confirmación en curso." };
    return { error: error.message };
  }

  // Send auto-message in chat
  const { data: profile } = await supabase
    .from("profiles")
    .select("nombre")
    .eq("id", user.id)
    .single();

  const { data: product } = await supabase
    .from("products_services")
    .select("titulo")
    .eq("id", parsed.data.product_id)
    .single();

  const { error: autoMsgErr } = await supabase.from("messages").insert({
    chat_id: parsed.data.chat_id,
    autor_id: user.id,
    texto: `🤝 ${profile?.nombre ?? "Alguien"} ha iniciado una confirmación de venta por "${product?.titulo}" — $${parsed.data.precio_acordado} MXN. Confirma para completar la venta.`,
  });
  if (autoMsgErr) {
    console.error("[createSaleConfirmation] auto-message insert:", autoMsgErr);
  }

  revalidatePath(`/chat/${parsed.data.chat_id}`);
  return { confirmation };
}

export async function confirmSale(saleConfirmationId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = confirmSaleSchema.safeParse({ sale_confirmation_id: saleConfirmationId });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Confirmación inválida" };
  }

  const { data: sc } = await supabase
    .from("sale_confirmations")
    .select("buyer_id, seller_id, chat_id, product_id, precio_acordado, buyer_confirmed, seller_confirmed, status")
    .eq("id", parsed.data.sale_confirmation_id)
    .single();

  if (!sc) return { error: "Confirmación no encontrada" };

  const isBuyer = user.id === sc.buyer_id;
  const myAlreadyConfirmed = isBuyer ? sc.buyer_confirmed : sc.seller_confirmed;

  // Idempotency guard — early return without side effects if already completed
  // or my-side already confirmed (rapid duplicate click case)
  if (sc.status !== "pending_confirmation" || myAlreadyConfirmed) {
    return { success: true, alreadyConfirmed: true };
  }

  const updates = isBuyer
    ? { buyer_confirmed: true, buyer_confirmed_at: new Date().toISOString() }
    : { seller_confirmed: true, seller_confirmed_at: new Date().toISOString() };

  // UPDATE with WHERE narrowed to "my side not yet confirmed"; .select() returns
  // the mutated rows so we can detect 0-row no-ops from a parallel race.
  const { data: updatedRows, error: updateError } = await supabase
    .from("sale_confirmations")
    .update(updates)
    .eq("id", parsed.data.sale_confirmation_id)
    .eq("status", "pending_confirmation");

  if (updateError) return { error: updateError.message };

  // Check if both confirmed now
  const { data: updated } = await supabase
    .from("sale_confirmations")
    .select("status")
    .eq("id", parsed.data.sale_confirmation_id)
    .single();

  // Only insert the "venta confirmada" message if THIS update flipped status to completed.
  if (updated?.status === "completed" && sc.chat_id) {
    const { data: product } = await supabase
      .from("products_services")
      .select("titulo")
      .eq("id", sc.product_id)
      .single();

    const { error: completedMsgErr } = await supabase.from("messages").insert({
      chat_id: sc.chat_id,
      autor_id: user.id,
      texto: `✅ ¡Venta confirmada en VICINO! "${product?.titulo}" — $${sc.precio_acordado} MXN. ¡Gracias a ambos! Deja tu reseña 👇`,
      sale_confirmation_id: saleConfirmationId,
      message_type: "sale_confirmed",
    });
    if (completedMsgErr) {
      console.error("[confirmSale] completed-message insert:", completedMsgErr);
    }
  }

  if (sc.chat_id) revalidatePath(`/chat/${sc.chat_id}`);
  return { success: true };
}

export async function cancelSale(saleConfirmationId: string, reason?: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const parsed = cancelSaleSchema.safeParse({
    sale_confirmation_id: saleConfirmationId,
    reason,
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  const { data: cancelled, error } = await supabase
    .from("sale_confirmations")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: user.id,
      cancel_reason: parsed.data.reason ?? null,
    })
    .eq("id", parsed.data.sale_confirmation_id)
    .eq("status", "pending_confirmation")
    .select("chat_id")
    .maybeSingle();

  if (error) return { error: error.message };
  if (!cancelled) {
    // If we get here without an error, it means the update matched 0 rows.
    // This could be because the status is no longer pending, or RLS blocked it.
    return { error: "No se pudo cancelar: la confirmación ya fue modificada o no tienes permiso." };
  }
  
  if (cancelled.chat_id) revalidatePath(`/chat/${cancelled.chat_id}`);
  return { success: true };
}

export async function getTotalUnreadChats(): Promise<number> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return 0;

  const [{ data: buyerChats }, { data: sellerChats }] = await Promise.all([
    supabase.from("chats").select("no_leidos_comprador").eq("comprador_id", user.id),
    supabase.from("chats").select("no_leidos_vendedor").eq("vendedor_id", user.id),
  ]);

  return (
    (buyerChats?.reduce((sum, c) => sum + (c.no_leidos_comprador ?? 0), 0) ?? 0) +
    (sellerChats?.reduce((sum, c) => sum + (c.no_leidos_vendedor ?? 0), 0) ?? 0)
  );
}

export async function hideChat(chatId: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const { data: chat } = await supabase
    .from("chats")
    .select("comprador_id, vendedor_id")
    .eq("id", chatId)
    .single();

  if (!chat) return { error: "Chat no encontrado" };
  if (chat.comprador_id !== user.id && chat.vendedor_id !== user.id)
    return { error: "Sin permiso" };

  const isBuyer = chat.comprador_id === user.id;
  const updates = isBuyer
    ? { oculto_para_comprador: true, deleted_at_comprador: new Date().toISOString() }
    : { oculto_para_vendedor: true, deleted_at_vendedor: new Date().toISOString() };

  const { error } = await supabase
    .from("chats")
    .update(updates)
    .eq("id", chatId);

  if (error) return { error: error.message };

  revalidatePath("/chat");
  return { success: true };
}
