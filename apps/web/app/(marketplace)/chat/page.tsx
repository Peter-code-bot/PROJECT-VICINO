import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { getChatList, type ChatListContext } from "@/lib/chat-list-data";
import { iniciarConversacion } from "./actions";
import { ChatList } from "./chat-list";

export const metadata = {
  title: "Chat — VICINO",
};

interface Props {
  searchParams: Promise<{
    seller?: string;
    product?: string;
    intent?: string;
    /** Clave de idempotencia que pinta la ficha del producto en sus dos CTA. */
    k?: string;
    selfChatError?: string;
    chatError?: string;
  }>;
}

export default async function ChatPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/chat");

  // Con `seller` en la URL esto deja de ser un indice y pasa a ser una
  // operacion: abrir la conversacion y, si venia con intencion de compra,
  // registrar el aviso. Antes eran DOS pasos sueltos —getOrCreateChat y un
  // INSERT manual en messages— y entre uno y otro no habia nada que atara el
  // resultado a la pulsacion que lo origino: un F5, el boton atras o un doble
  // toque mandaban un segundo "quiere comprar" al mismo vendedor. Ahora los
  // dos pasos son UNA transaccion en la base (iniciar_conversacion,
  // 20260912300000) y la clave de idempotencia decide si esto es la misma
  // pulsacion o una nueva.
  if (params.seller) {
    // Las ligas antiguas o truncadas abren contacto, sin afirmar una compra:
    // sin clave no hay forma de distinguir un reintento de una intencion nueva,
    // y mandar el aviso igual seria volver al duplicado. El comprador lo ve
    // dicho (?sinIntencion=1) y tiene el camino de vuelta a la publicacion.
    const hasPurchaseKey = z.string().uuid().safeParse(params.k).success;
    const quiereComprar = params.intent === "buy" && !!params.product && hasPurchaseKey;

    const result = await iniciarConversacion({
      sellerId: params.seller,
      productId: params.product,
      intencion: quiereComprar ? "compra" : "contacto",
      clave: quiereComprar ? params.k : undefined,
    });
    // Antes CUALQUIER error de aqui redirigia a ?selfChatError=1, que pinta
    // "No puedes iniciar un chat contigo mismo. Estabas en modo vista
    // visitante de tu propio producto." Eso ya mentia cuando el vendedor te
    // tenia bloqueado, y 20260912310000 anade dos motivos mas —cuenta
    // suspendida y producto que no es de ese vendedor— que habrian acabado
    // leyendose igual de mal. El caso de chat-consigo-mismo se distingue por
    // lo que la propia accion comprueba antes de ir a la base; el resto viaja
    // ya traducido por traducirErrorIniciarConversacion, que nunca deja pasar
    // el texto crudo del motor.
    if (result.error) {
      if (result.error.includes("contigo mismo")) {
        redirect("/chat?selfChatError=1");
      }
      redirect(`/chat?chatError=${encodeURIComponent(result.error)}`);
    }
    if (result.chatId) {
      // El aviso "quiere comprar" ya viaja dentro de la misma transaccion que
      // abrio el chat: lo compone la base con el nombre, el titulo y el precio
      // formateado. Lo que antes eran dos consultas (producto + perfil) y un
      // INSERT que podia fallar en solitario —dejando al comprador en un chat
      // vacio convencido de que ya habia avisado— son ahora cero viajes extra:
      // si el aviso no se pudo registrar, la RPC ya devolvio { error } mas
      // arriba y no hay chat a medias que explicar.
      //
      // `repetida` distingue el reintento de la intencion nueva: cuando es
      // true no ha nacido ninguna fila, asi que el comprador vuelve a la misma
      // conversacion y el vendedor no recibe un segundo aviso.
      if (params.intent === "buy" && !quiereComprar) {
        redirect(`/chat/${result.chatId}?sinIntencion=1`);
      }
      redirect(`/chat/${result.chatId}`);
    }
  }

  // Sin `seller` esto es un indice: la lista vive en el cliente y se conserva
  // en memoria durante la sesion (ver chat-list.tsx y SessionDataProvider).
  //
  // La primera visita, en cambio, la sirve ESTE render: el HTML ya lleva la
  // lista y la hidratacion no tiene que volver a pedirla. Se reutilizan el
  // cliente y el usuario que acaban de decidir el redirect de invitados, para
  // no ir a Auth dos veces por navegacion. El renderId distingue este render
  // de una copia del mismo payload que el router de Next vuelva a entregar
  // (ver SessionCache.seed).
  const lista = await cargarSemilla({ supabase, userId: user.id });
  return <ChatList seed={lista ? { value: lista.value, renderId: crypto.randomUUID() } : undefined} />;
}

// Si la consulta falla la pagina NO se cae: se pinta sin semilla, igual que
// antes de sembrar, y es la memoria de sesion la que pide la lista y ofrece el
// reintento en linea. Hasta ahora el servidor no tocaba la base en este
// indice; una caida pasajera no tiene por que convertirse en un error de ruta.
async function cargarSemilla(ctx: ChatListContext): Promise<Awaited<ReturnType<typeof getChatList>>> {
  try {
    return await getChatList(ctx);
  } catch (error) {
    Sentry.captureException(error, { tags: { surface: "chat", query: "chat_list_seed" } });
    return null;
  }
}
