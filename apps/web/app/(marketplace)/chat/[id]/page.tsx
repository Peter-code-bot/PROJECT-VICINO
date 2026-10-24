import { redirect, notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatWindow } from "./chat-window";
import type { SalesSeed } from "@/hooks/use-deferred-sales";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ intentFailed?: string; sinIntencion?: string }>;
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
  const { intentFailed, sinIntencion } = await searchParams;
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
      id, comprador_id, vendedor_id, ultimo_producto_id, producto_revision,
      deleted_at_comprador, deleted_at_vendedor,
      comprador:profiles!comprador_id(id, nombre, foto, trust_level, es_vendedor, seller_type, nombre_negocio),
      vendedor:profiles!vendedor_id(id, nombre, foto, trust_level, es_vendedor, seller_type, nombre_negocio),
      ultimo_producto:products_services!ultimo_producto_id(id, titulo, precio, modo_precio, imagen_principal, creador_id, estatus, is_hidden)
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
      buyer_confirmed, seller_confirmed, created_at, purchase_intent_message_id,
      products_services(id, titulo, slug, categoria, imagen_principal)
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
    .select("id, chat_id, autor_id, texto, attachments, created_at, leido_por_comprador, leido_por_vendedor, message_type, intent_status, publicacion_id, sale_confirmation_id")
    .eq("chat_id", chatId)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(50);

  if (deletedAt) {
    messagesQuery.gt("created_at", deletedAt);
  }

  // ¿Alguno de los dos tiene algo publicado y disponible? Sin eso no hay venta
  // que confirmar, y el boton "Confirmar Venta" solo llevaba a "Ningun
  // participante tiene productos disponibles" (reporte de Pedro, 15-oct-2026).
  // Mismo filtro que loadChatCatalog, con el mismo cliente RLS, para que el
  // boton y el selector no se contradigan. Sale en paralelo con los mensajes.
  const catalogoQuery = supabase
    .from("products_services")
    .select("id")
    .in("creador_id", [chat.comprador_id, chat.vendedor_id])
    .eq("estatus", "disponible")
    .eq("is_hidden", false)
    .limit(1);

  // Rendering and prefetch are read-only. The visible ChatWindow sends its
  // acknowledgement separately, without blocking this response or the send queue.
  const [{ data: messagesDesc, error: messagesError }, catalogo] = await Promise.all([messagesQuery, catalogoQuery]);
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
      productRevision={chat.producto_revision}
      initialMessages={messages ?? []}
      initialSaleConfirmations={[]}
      salesSeed={salesSeed}
      readinessToken={crypto.randomUUID()}
      buyIntentFailed={intentFailed === "1"}
      missingPurchaseIntent={sinIntencion === "1"}
      // null = no se pudo saber: se deja el boton como estaba antes.
      hayProductosDisponibles={catalogo.error ? null : (catalogo.data?.length ?? 0) > 0}
    />
  );
}
