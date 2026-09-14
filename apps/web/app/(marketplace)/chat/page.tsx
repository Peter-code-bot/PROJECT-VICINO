import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { z } from "zod";
import { cleanDisplayName } from "@vicino/shared";
import { iniciarConversacion } from "./actions";
import { ChatItemCard } from "./chat-item-card";

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

  // Get user's chats
  const { data: chats } = await supabase
    .from("chats")
    .select(
      `
      id, updated_at, no_leidos_comprador, no_leidos_vendedor,
      oculto_para_comprador, oculto_para_vendedor,
      comprador:profiles!comprador_id(id, nombre, foto),
      vendedor:profiles!vendedor_id(id, nombre, foto),
      ultimo_producto:products_services!ultimo_producto_id(titulo)
    `
    ).throwOnError()
    .or(`comprador_id.eq.${user.id},vendedor_id.eq.${user.id}`)
    .order("updated_at", { ascending: false });

  // Filtrar chats ocultos para este usuario (soft delete)
  const visibleChats = chats?.filter((chat) => {
    const compradorProfile = Array.isArray(chat.comprador) ? chat.comprador[0] : chat.comprador;
    const isBuyer = compradorProfile?.id === user.id;
    return isBuyer ? !chat.oculto_para_comprador : !chat.oculto_para_vendedor;
  }) ?? [];

  const showSelfChatBanner = params.selfChatError === "1";
  // Motivo real cuando la conversacion no se pudo abrir: vendedor o producto
  // ya no disponibles, cuenta suspendida, cuota diaria agotada. Viene ya
  // traducido desde la accion; se recorta porque el parametro es de la URL y
  // no hay razon para pintar mas de una frase.
  const chatErrorBanner =
    typeof params.chatError === "string" && params.chatError.length > 0
      ? params.chatError.slice(0, 160)
      : null;

  return (
    <div data-navigation-kind="chat_list" data-navigation-ready={crypto.randomUUID()} className="max-w-2xl mx-auto px-4 pt-2 pb-8 sm:pt-4">
      {showSelfChatBanner && (
        <div className="mb-4 rounded-xl border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 px-4 py-3 text-sm text-[color:var(--warning)]">
          No puedes iniciar un chat contigo mismo. Estabas en modo vista visitante de tu propio producto.
        </div>
      )}
      {chatErrorBanner && (
        <div
          role="status"
          className="mb-4 rounded-xl border border-[color:var(--warning)]/30 bg-[color:var(--warning)]/10 px-4 py-3 text-sm text-[color:var(--warning)]"
        >
          {chatErrorBanner}
        </div>
      )}
      <div className="mb-5">
        <h1 className="font-heading text-2xl font-bold text-[color:var(--fg)]">
          Mensajes
        </h1>
      </div>

      {visibleChats.length > 0 ? (
        <div className="space-y-3 stagger">
          {visibleChats.map((chat) => {
            const compradorProfile = Array.isArray(chat.comprador) ? chat.comprador[0] : chat.comprador;
            const vendedorProfile = Array.isArray(chat.vendedor) ? chat.vendedor[0] : chat.vendedor;
            const isBuyer = compradorProfile?.id === user.id;
            const otherProfile = isBuyer ? vendedorProfile : compradorProfile;
            const unread = isBuyer ? chat.no_leidos_comprador : chat.no_leidos_vendedor;
            const producto = Array.isArray(chat.ultimo_producto)
              ? chat.ultimo_producto[0]
              : chat.ultimo_producto;

            return (
              <ChatItemCard
                key={chat.id}
                chat={{
                  id: chat.id,
                  updated_at: chat.updated_at,
                  otherUser: otherProfile
                    ? { id: otherProfile.id, nombre: cleanDisplayName(otherProfile.nombre), foto: otherProfile.foto }
                    : null,
                  unread: unread ?? 0,
                  productoTitulo: producto?.titulo ?? null,
                }}
              />
            );
          })}
        </div>
      ) : (
        <div className="rounded-3xl product-card-custom px-4 py-20 text-center">
          <div className="mx-auto mb-6 flex h-20 w-20 items-center justify-center rounded-3xl product-card-btn">
            <span className="translate-y-1 text-4xl">💬</span>
          </div>
          <h2 className="mb-2 font-heading text-xl font-bold text-[color:var(--fg)]">
            Sin conversaciones
          </h2>
          <p className="mx-auto max-w-xs text-sm text-[color:var(--fg-muted)]">
            Tus chats con vendedores y compradores aparecerán aquí cuando empieces a interactuar.
          </p>
          <Link
            href="/buscar"
            className="mt-6 inline-flex items-center justify-center rounded-xl bg-[color:var(--brand)] px-6 py-2.5 text-sm font-semibold text-white transition-all hover:bg-[color:var(--brand-dark)]"
          >
            Explorar productos
          </Link>
        </div>
      )}
    </div>
  );
}
