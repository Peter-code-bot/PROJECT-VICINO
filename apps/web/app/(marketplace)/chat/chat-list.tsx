"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { cleanDisplayName } from "@vicino/shared";
import { ChatItemCard } from "./chat-item-card";
import { SessionScroll, useSessionData, DataRetry, type SessionSeed } from "@/components/layout/session-data-provider";
import { SkeletonLista } from "@/components/shared/loading-skeletons";
import type { getChatList } from "@/lib/chat-list-data";
type Data = NonNullable<Awaited<ReturnType<typeof getChatList>>>["value"];
export interface ChatListProps {
  /** Lo que trajo el render del servidor; sin ella (loading.tsx) se pide a la memoria de sesion. */
  seed?: SessionSeed<Data>;
}
export function ChatList({ seed }: ChatListProps) {
  const params = useSearchParams();
  const { data, error, retry, userId, updatedAt, mutate } = useSessionData<Data>("/api/session/chats", seed);
  if (!data) {
    // Sin datos utilizables ni error se pinta la FORMA de la lista, no una
    // frase: es el mismo esqueleto que master pintaba desde loading.tsx y lo
    // que evita el salto de maqueta cuando llegan las filas. Con error se
    // conserva la cabecera para que el reintento tenga contexto.
    if (!error) return <SkeletonLista etiqueta="Cargando tus chats" />;
    return <div className="max-w-2xl mx-auto px-4 py-6"><h1 className="font-heading text-2xl font-bold">Mensajes</h1><DataRetry error={error} retry={retry} /></div>;
  }
  const { visibleChats } = data;
  const user = { id: userId };
  const showSelfChatBanner = params.get("selfChatError") === "1";
  // Motivo real cuando la conversacion no se pudo abrir: vendedor o producto
  // ya no disponibles, cuenta suspendida, cuota diaria agotada. Viene ya
  // traducido desde la accion; se recorta porque el parametro es de la URL y
  // no hay razon para pintar mas de una frase.
  const chatError = params.get("chatError");
  const chatErrorBanner = chatError && chatError.length > 0 ? chatError.slice(0, 160) : null;
  return (
    <div data-navigation-kind="chat_list" data-navigation-ready={`chats:${userId}:${updatedAt}`} className="max-w-2xl mx-auto px-4 pt-2 pb-8 sm:pt-4">
      <SessionScroll route="/chat" />
      <DataRetry error={error} retry={retry} />
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
                onHidden={() => mutate(current => ({ ...current, visibleChats: current.visibleChats.filter(item => item.id !== chat.id) }))}
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
