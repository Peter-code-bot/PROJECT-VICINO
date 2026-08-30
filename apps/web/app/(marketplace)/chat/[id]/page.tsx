import { redirect, notFound } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { ChatWindow } from "./chat-window";

interface Props {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ intentFailed?: string }>;
}

export async function generateMetadata({ params }: Props) {
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

  // PRIMERA TANDA: el chat y sus confirmaciones, a la vez.
  //
  // Hasta el 27-ago esta pagina hacia cinco viajes a Supabase EN FILA, y solo
  // dos de los cinco dependian de verdad del anterior. Abrir un chat costaba
  // la suma de los cinco (~5 s medidos).
  //
  // Las dos de aqui solo necesitan `chatId`. `saleConfirmations` se adelanta al
  // chequeo de participante de mas abajo: si el usuario no lo es, los datos se
  // traen y se tiran sin llegar nunca al cliente, porque `notFound()` corta el
  // render antes. Es una consulta desperdiciada en un caso raro, no una fuga.
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

  const [{ data: chat }, { data: saleConfirmations }] = await Promise.all([
    chatQuery,
    saleConfirmationsQuery,
  ]);

  if (!chat) notFound();

  // Verify user is a participant
  if (chat.comprador_id !== user.id && chat.vendedor_id !== user.id) {
    notFound();
  }

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
    .limit(50);

  if (deletedAt) {
    messagesQuery.gt("created_at", deletedAt);
  }

  // SEGUNDA TANDA: los mensajes y el acuse de lectura, a la vez.
  //
  // Los mensajes son la unica consulta que de verdad depende de la anterior:
  // `deletedAt` sale del chat y recorta la ventana. Por eso hay dos tandas y
  // no una.
  //
  // `mark_messages_as_read` no depende de nada de esto y su resultado no se
  // pinta — pero es una ESCRITURA, y encadenada le cobraba al usuario un viaje
  // entero antes de ver el chat. Va aqui dentro para que solape con la lectura
  // de mensajes en vez de sumarse a ella. No se puede soltar sin `await`: el
  // runtime puede cortar el trabajo pendiente al terminar de renderizar, y
  // entonces el contador de no leidos se queda pegado de forma intermitente.
  const [{ data: messagesDesc }, { error: markReadErr }] = await Promise.all([
    messagesQuery,
    // Gemelo del markAsRead de chat/actions.ts: la RPC es SECURITY DEFINER y
    // levanta 'unauthenticated', 'chat not found' o 'forbidden' como
    // excepcion, y el await pelado las descartaba todas.
    supabase.rpc("mark_messages_as_read", {
      p_chat_id: chatId,
      p_user_id: user.id,
    }),
  ]);

  const messages = (messagesDesc ?? []).slice().reverse();

  // Solo se registra, nunca se aborta: la pagina tiene que renderizar el chat
  // aunque el contador de no leidos se quede pegado.
  if (markReadErr) {
    Sentry.captureException(markReadErr, {
      tags: { action: "ChatDetailPage", step: "mark_read" },
      extra: {
        chatId,
        code: markReadErr.code,
        details: markReadErr.details,
        hint: markReadErr.hint,
      },
    });
  }

  // `isBuyer` already computed above
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
      initialSaleConfirmations={saleConfirmations ?? []}
      buyIntentFailed={intentFailed === "1"}
    />
  );
}
