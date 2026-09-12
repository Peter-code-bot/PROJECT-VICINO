import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatWindow } from "./chat-window";
import type { SalesSeed } from "@/hooks/use-deferred-sales";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ intentFailed?: string }>;
}

export async function generateMetadata() {
  return { title: "Chat" };
}

export default async function ChatDetailPage({ params, searchParams }: Props) {
  const { id: chatId } = await params;
  // chat/page.tsx redirige aqui con ?intentFailed=1 cuando el mensaje
  // automatico de "quiere comprar" no se pudo insertar. El aviso tiene que
  // vivir DENTRO de ChatWindow: chat/[id]/layout.tsx es un flex column de
  // altura fija con overflow-hidden y ChatWindow monta con h-full, asi que
  // un hermano encima lo desbordaria y quedaria recortado.
  const { intentFailed } = await searchParams;
  const supabase = await createClient();

  // `getUser()` VA SOLO Y VA PRIMERO. NO LO METAS EN EL Promise.all DE ABAJO.
  //
  // Cuando el access token esta vencido, getUser() lo REFRESCA y reescribe la
  // cookie. Cualquier consulta que salga a la vez que el refresco viaja con el
  // token viejo, se come un 401 y devuelve `data: null` — o sea que un chat
  // legitimo acabaria en notFound() de forma intermitente, y solo para sesiones
  // largas. Ese viaje extra es el precio de la correccion.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/chat");

  // Only the authorized chat and messages gate the first useful content.
  const chatQuery = supabase
    .from("chats")
    .select(
      `
      id, comprador_id, vendedor_id, ultimo_producto_id,
      deleted_at_comprador, deleted_at_vendedor,
      comprador:profiles!comprador_id(id, nombre, foto, trust_level),
      vendedor:profiles!vendedor_id(id, nombre, foto, trust_level),
      ultimo_producto:products_services!ultimo_producto_id(id, titulo, precio, modo_precio, imagen_principal)
    `
    )
    .eq("id", chatId)
    .single();

  // Get pending sale confirmations for this chat
  const saleConfirmationsQuery = supabase
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

  const { data: chat, error: chatError } = await chatQuery;

  if (chatError && chatError.code !== "PGRST116") throw new Error("No se pudo cargar la conversación. Intenta de nuevo.");
  if (!chat) notFound();

  // Verify user is a participant
  if (chat.comprador_id !== user.id && chat.vendedor_id !== user.id) {
    notFound();
  }

  const salesSeed: Promise<SalesSeed> = Promise.resolve(saleConfirmationsQuery)
    .then(({ data, error }) => error ? { ok: false as const } : { ok: true as const, sales: data ?? [] },
      () => ({ ok: false as const }));

  // Get initial messages.
  // A5.1: fetch the LATEST 50 via DESC then reverse to ASC for render.
  // Previously this used ASC LIMIT 50 which returned the OLDEST 50 messages
  // -- correct for short chats, but for chats with more than 50 messages
  // the user landed on the very first messages of the conversation with no
  // affordance to reach the recent ones. The cursor for load-older is
  // initialMessages[0].created_at (the oldest of the latest 50) when the
  // page filled, so this DESC reverse pattern is what makes A5.1's
  // getMessagesBefore meaningful.
  const isBuyer = user.id === chat.comprador_id;
  const deletedAt = isBuyer ? chat.deleted_at_comprador : chat.deleted_at_vendedor;

  const messagesQuery = supabase
    .from("messages")
    .select("id, chat_id, autor_id, texto, attachments, created_at, leido_por_comprador, leido_por_vendedor")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);

  if (deletedAt) {
    messagesQuery.gt("created_at", deletedAt);
  }

  // Rendering and prefetch are read-only. The visible ChatWindow sends its
  // acknowledgement separately, without blocking this response or the send queue.
  const { data: messagesDesc, error: messagesError } = await messagesQuery;
  if (messagesError) throw new Error("No se pudieron cargar los mensajes. Intenta de nuevo.");
  const messages = (messagesDesc ?? []).slice().reverse();

  // `isBuyer` already computed above
  const otherUser = isBuyer
    ? (Array.isArray(chat.vendedor) ? chat.vendedor[0] : chat.vendedor)
    : (Array.isArray(chat.comprador) ? chat.comprador[0] : chat.comprador);
  const product = Array.isArray(chat.ultimo_producto)
    ? chat.ultimo_producto[0]
    : chat.ultimo_producto;

  return (
    <ChatWindow
      key={`${user.id}:${chatId}`}
      chatId={chatId}
      deletedAt={deletedAt}
      currentUserId={user.id}
      isBuyer={isBuyer}
      otherUser={otherUser ?? null}
      product={product ?? null}
      initialMessages={messages ?? []}
      initialSaleConfirmations={[]}
      salesSeed={salesSeed}
      readinessToken={crypto.randomUUID()}
      buyIntentFailed={intentFailed === "1"}
    />
  );
}
