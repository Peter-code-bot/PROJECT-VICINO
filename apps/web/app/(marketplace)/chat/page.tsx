import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatRelativeTime } from "@vicino/shared";
import { getOrCreateChat } from "./actions";

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
      comprador:profiles!comprador_id(id, nombre, foto),
      vendedor:profiles!vendedor_id(id, nombre, foto),
      ultimo_producto:products_services!ultimo_producto_id(titulo)
    `
    )
    .or(`comprador_id.eq.${user.id},vendedor_id.eq.${user.id}`)
    .order("updated_at", { ascending: false });

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 animate-fade-in-up">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-heading font-bold">Mensajes</h1>
        {chats && chats.length > 0 && (
          <span className="px-3 py-1 bg-terracotta/10 text-terracotta text-xs font-semibold rounded-full">
            {chats.length} conversaciones
          </span>
        )}
      </div>

      {chats && chats.length > 0 ? (
        <div className="space-y-3 stagger">
          {chats.map((chat) => {
            const compradorProfile = Array.isArray(chat.comprador) ? chat.comprador[0] : chat.comprador;
            const vendedorProfile = Array.isArray(chat.vendedor) ? chat.vendedor[0] : chat.vendedor;
            const isBuyer = compradorProfile?.id === user.id;
            const otherProfile = isBuyer ? vendedorProfile : compradorProfile;
            const unread = isBuyer
              ? chat.no_leidos_comprador
              : chat.no_leidos_vendedor;
            const producto = Array.isArray(chat.ultimo_producto)
              ? chat.ultimo_producto[0]
              : chat.ultimo_producto;

            return (
              <Link
                key={chat.id}
                href={`/chat/${chat.id}`}
                className={`group flex items-center gap-4 p-4 rounded-2xl border transition-all duration-300 relative overflow-hidden ${
                  unread > 0 
                    ? "bg-white dark:bg-neutral-900 border-terracotta/30 shadow-md" 
                    : "bg-card border-border/40 hover:border-terracotta/20 hover:shadow-sm"
                }`}
              >
                {unread > 0 && (
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-terracotta" />
                )}

                <div className={`w-14 h-14 rounded-full flex items-center justify-center shrink-0 border-2 shadow-sm ${
                  unread > 0 ? "border-terracotta/20 bg-terracotta/5" : "border-background bg-cream-dark dark:bg-neutral-800"
                }`}>
                  <span className={`text-lg font-heading font-bold ${
                    unread > 0 ? "text-terracotta" : "text-muted-foreground"
                  }`}>
                    {otherProfile?.nombre?.charAt(0)?.toUpperCase() ?? "?"}
                  </span>
                </div>

                <div className="flex-1 min-w-0 pr-2">
                  <div className="flex items-center justify-between mb-1">
                    <span className={`font-semibold text-base truncate transition-colors ${
                      unread > 0 ? "text-foreground" : "group-hover:text-terracotta"
                    }`}>
                      {otherProfile?.nombre ?? "Usuario"}
                    </span>
                    <span className={`text-xs whitespace-nowrap ml-2 ${
                      unread > 0 ? "text-terracotta font-semibold" : "text-muted-foreground"
                    }`}>
                      {formatRelativeTime(chat.updated_at)}
                    </span>
                  </div>

                  <div className="flex items-center gap-2">
                    {producto?.titulo ? (
                      <p className={`text-sm truncate ${
                        unread > 0 ? "font-medium text-foreground/90" : "text-muted-foreground"
                      }`}>
                        {producto.titulo}
                      </p>
                    ) : (
                      <p className="text-sm text-muted-foreground/60 italic">Chat general</p>
                    )}
                  </div>
                </div>

                {unread > 0 && (
                  <div className="flex items-center justify-center w-6 h-6 rounded-full bg-terracotta text-white text-xs font-bold shrink-0 shadow-sm shadow-terracotta/20">
                    {unread}
                  </div>
                )}
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-20 px-4 rounded-3xl border border-dashed border-border/60 bg-card/50">
          <div className="w-20 h-20 mx-auto rounded-3xl bg-terracotta/5 flex items-center justify-center mb-6">
            <span className="text-4xl translate-y-1">💬</span>
          </div>
          <h2 className="text-xl font-heading font-bold mb-2">Sin conversaciones</h2>
          <p className="text-sm text-muted-foreground max-w-xs mx-auto">
            Tus chats con vendedores y compradores aparecerán aquí cuando empieces a interactuar.
          </p>
          <Link href="/buscar" className="inline-flex items-center justify-center px-6 py-2.5 mt-6 rounded-xl bg-bone text-bone-contrast font-medium text-sm hover:bg-bone-dark transition-colors shadow-sm">
            Explorar productos
          </Link>
        </div>
      )}
    </div>
  );
}
