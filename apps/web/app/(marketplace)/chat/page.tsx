import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateChat } from "./actions";
import { ChatItemCard } from "./chat-item-card";

export const metadata = {
  title: "Chat — VICINO",
};

interface Props {
  searchParams: Promise<{ seller?: string; product?: string; intent?: string }>;
}

export default async function ChatPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/chat");

  // If seller param is present, create/get chat and redirect
  if (params.seller) {
    const result = await getOrCreateChat(params.seller, params.product);
    if (result.chatId) {
      // Send buy intent message if intent=buy
      if (params.intent === "buy" && params.product) {
        const { data: product } = await supabase
          .from("products_services")
          .select("titulo, precio")
          .eq("id", params.product)
          .single();
        const { data: profile } = await supabase
          .from("profiles")
          .select("nombre")
          .eq("id", user.id)
          .single();
        if (product) {
          await supabase.from("messages").insert({
            chat_id: result.chatId,
            autor_id: user.id,
            texto: `🛒 ${profile?.nombre ?? "Un comprador"} quiere comprar: ${product.titulo} por $${Number(product.precio).toLocaleString("es-MX")} MXN`,
          });
        }
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
    )
    .or(`comprador_id.eq.${user.id},vendedor_id.eq.${user.id}`)
    .order("updated_at", { ascending: false });

  // Filtrar chats ocultos para este usuario (soft delete)
  const visibleChats = chats?.filter((chat) => {
    const compradorProfile = Array.isArray(chat.comprador) ? chat.comprador[0] : chat.comprador;
    const isBuyer = compradorProfile?.id === user.id;
    return isBuyer ? !chat.oculto_para_comprador : !chat.oculto_para_vendedor;
  }) ?? [];

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 animate-fade-in-up">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-heading font-bold">Mensajes</h1>
        {visibleChats.length > 0 && (
          <span className="px-3 py-1 bg-primary/10 text-primary text-xs font-semibold rounded-full">
            {visibleChats.length} conversaciones
          </span>
        )}
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
                    ? { id: otherProfile.id, nombre: otherProfile.nombre, foto: otherProfile.foto }
                    : null,
                  unread: unread ?? 0,
                  productoTitulo: producto?.titulo ?? null,
                }}
              />
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 px-4 rounded-3xl border border-dashed border-border/60 bg-card/50">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-primary/5 flex items-center justify-center mb-6">
            <span className="text-4xl translate-y-1">💬</span>
          </div>
          <h2 className="text-xl font-heading font-bold mb-2">Sin conversaciones</h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Tus chats con vendedores y compradores aparecerán aquí cuando empieces a interactuar.
          </p>
          <Link href="/buscar" className="inline-flex items-center justify-center px-6 py-2.5 mt-6 rounded-xl bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors shadow-sm">
            Explorar productos
          </Link>
        </div>
      )}
    </div>
  );
}
