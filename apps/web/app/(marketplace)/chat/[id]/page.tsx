import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatWindow } from "./chat-window";

interface Props {
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props) {
  return { title: "Chat" };
}

export default async function ChatDetailPage({ params }: Props) {
  const { id: chatId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/chat");

  // Get chat with participants
  const { data: chat } = await supabase
    .from("chats")
    .select(
      `
      id, comprador_id, vendedor_id, ultimo_producto_id,
      comprador:profiles!comprador_id(id, nombre, foto, trust_level),
      vendedor:profiles!vendedor_id(id, nombre, foto, trust_level),
      ultimo_producto:products_services!ultimo_producto_id(id, titulo, precio, imagen_principal)
    `
    )
    .eq("id", chatId)
    .single();

  if (!chat) notFound();

  // Verify user is a participant
  if (chat.comprador_id !== user.id && chat.vendedor_id !== user.id) {
    notFound();
  }

  // Get initial messages
  const { data: messages } = await supabase
    .from("messages")
    .select("id, chat_id, autor_id, texto, attachments, created_at, leido_por_comprador, leido_por_vendedor")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: true })
    .limit(50);

  // Get pending sale confirmations for this chat
  const { data: saleConfirmations } = await supabase
    .from("sale_confirmations")
    .select(
      `
      id, product_id, buyer_id, seller_id, precio_acordado, cantidad,
      metodo_pago, tipo_entrega, status, initiated_by,
      buyer_confirmed, seller_confirmed, created_at,
      products_services(titulo)
    `
    )
    .eq("chat_id", chatId)
    .in("status", ["pending_confirmation", "completed"])
    .order("created_at", { ascending: false })
    .limit(5);

  // Mark messages as read
  await supabase.rpc("mark_messages_as_read", {
    p_chat_id: chatId,
    p_user_id: user.id,
  });

  const isBuyer = user.id === chat.comprador_id;
  const otherUser = isBuyer
    ? (Array.isArray(chat.vendedor) ? chat.vendedor[0] : chat.vendedor)
    : (Array.isArray(chat.comprador) ? chat.comprador[0] : chat.comprador);
  const product = Array.isArray(chat.ultimo_producto)
    ? chat.ultimo_producto[0]
    : chat.ultimo_producto;

  return (
    <ChatWindow
      chatId={chatId}
      currentUserId={user.id}
      isBuyer={isBuyer}
      otherUser={otherUser ?? null}
      product={product ?? null}
      initialMessages={messages ?? []}
      saleConfirmations={saleConfirmations ?? []}
    />
  );
}
