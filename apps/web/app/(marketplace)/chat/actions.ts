"use server";

import { redirect } from "next/navigation";
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

  const { data: chatId, error } = await supabase.rpc("get_or_create_chat", {
    p_comprador_id: user.id,
    p_vendedor_id: parsed.data.seller_id,
    p_producto_id: parsed.data.product_id ?? null,
  });

  if (error) return { error: error.message };
  return { chatId: chatId as string };
}

export async function sendMessage(chatId: string, texto: string) {
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

  const { error } = await supabase.from("messages").insert({
    chat_id: parsed.data.chat_id,
    autor_id: user.id,
    texto: parsed.data.texto,
  });

  if (error) return { error: error.message };
  return { success: true };
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

  if (chatErr || !chat) return { error: "Chat no encontrado" };

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

  if (error) return { error: error.message };

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

  await supabase.from("messages").insert({
    chat_id: parsed.data.chat_id,
    autor_id: user.id,
    texto: `🤝 ${profile?.nombre ?? "Alguien"} ha iniciado una confirmación de venta por "${product?.titulo}" — $${parsed.data.precio_acordado} MXN. Confirma para completar la venta.`,
  });

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
    .select("buyer_id, seller_id, chat_id, product_id, precio_acordado")
    .eq("id", parsed.data.sale_confirmation_id)
    .single();

  if (!sc) return { error: "Confirmación no encontrada" };

  const isBuyer = user.id === sc.buyer_id;
  const updates = isBuyer
    ? { buyer_confirmed: true, buyer_confirmed_at: new Date().toISOString() }
    : { seller_confirmed: true, seller_confirmed_at: new Date().toISOString() };

  const { error } = await supabase
    .from("sale_confirmations")
    .update(updates)
    .eq("id", parsed.data.sale_confirmation_id)
    .eq("status", "pending_confirmation");

  if (error) return { error: error.message };

  // Check if both confirmed now
  const { data: updated } = await supabase
    .from("sale_confirmations")
    .select("status")
    .eq("id", parsed.data.sale_confirmation_id)
    .single();

  if (updated?.status === "completed" && sc.chat_id) {
    const { data: product } = await supabase
      .from("products_services")
      .select("titulo")
      .eq("id", sc.product_id)
      .single();

    await supabase.from("messages").insert({
      chat_id: sc.chat_id,
      autor_id: user.id,
      texto: `✅ ¡Venta confirmada en VICINO! "${product?.titulo}" — $${sc.precio_acordado} MXN. ¡Gracias a ambos! Deja tu reseña 👇`,
    });
  }

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

  const { error } = await supabase
    .from("sale_confirmations")
    .update({
      status: "cancelled",
      cancelled_at: new Date().toISOString(),
      cancelled_by: user.id,
      cancel_reason: parsed.data.reason ?? null,
    })
    .eq("id", parsed.data.sale_confirmation_id)
    .eq("status", "pending_confirmation");

  if (error) return { error: error.message };
  return { success: true };
}
