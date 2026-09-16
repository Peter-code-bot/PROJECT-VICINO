import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { formatPrice } from "@vicino/shared";
import { priceFallbackLabel } from "@/lib/price-mode";
import { getOrCreateChat } from "./actions";
import { z } from "zod";
import { ChatList } from "./chat-list";

export const metadata = {
  title: "Chat — VICINO",
};

interface Props {
  searchParams: Promise<{
    seller?: string;
    product?: string;
    intent?: string;
    k?: string;
    selfChatError?: string;
  }>;
}

export default async function ChatPage({ searchParams }: Props) {
  const params = await searchParams;
  if (!params.seller) return <ChatList />;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/chat");

  // If seller param is present, create/get chat and redirect
  if (params.seller) {
    // Las ligas antiguas o truncadas abren contacto, sin afirmar una compra.
    // La clave válida queda preparada para la RPC de B4; no se regenera aquí.
    const hasPurchaseKey = z.string().uuid().safeParse(params.k).success;
    const result = await getOrCreateChat(params.seller, params.product);
    // Self-chat guard: owner reached /chat?seller={ownId} (typically from
    // a CTA tapped while in ?preview=visitor mode on their own listing).
    // Server action returns { error }; surface it as a banner on the chat
    // index so the owner understands why no chat opened.
    if (result.error) {
      redirect(`/chat?selfChatError=1`);
    }
    if (result.chatId) {
      if (params.intent === "buy" && (!hasPurchaseKey || !params.product)) {
        redirect(`/chat/${result.chatId}?sinIntencion=1`);
      }
      // Send buy intent message if intent=buy
      if (params.intent === "buy" && params.product && hasPurchaseKey) {
        const { data: product, error: productErr } = await supabase
          .from("products_services")
          .select("titulo, precio, modo_precio").throwOnError()
          .eq("id", params.product)
          .single();
        // El producto puede no ser visible para ESTE comprador: la policy
        // block_aware_products_select solo devuelve la fila con estatus
        // 'disponible' e is_hidden = false, y la esconde si hay bloqueo
        // mutuo en user_blocks. Antes ese caso moria en el `if (product)`
        // y salia por el redirect sin decir nada: el comprador aterrizaba
        // en un chat vacio creyendo que ya habia avisado, y el vendedor no
        // recibia mensaje, ni no_leidos, ni push.
        if (!product) {
          console.error("[chat] buy-intent product lookup:", productErr);
          Sentry.captureException(
            productErr ?? new Error("buy intent: producto no visible para el comprador"),
            {
              tags: { action: "chat_buy_intent", step: "product_lookup" },
              extra: { productId: params.product, chatId: result.chatId },
            }
          );
          redirect(`/chat/${result.chatId}?intentFailed=1`);
        }

        const { data: profile } = await supabase
          .from("profiles")
          .select("nombre").throwOnError()
          .eq("id", user.id)
          .single();
        // El precio es nullable desde que existe modo_precio. El
        // Number(precio) anterior convertia null en 0 y guardaba en la base
        // un "por $0 MXN" que se lee como una oferta real de cero pesos.
        // formatPrice devuelve null cuando no hay monto, y ahi la etiqueta
        // del modo dice la verdad ("Cotizacion" / "Reservacion").
        const precioFmt = formatPrice(product.precio);
        // Mismo manejo que sendMessage en actions.ts:179. El INSERT puede
        // fallar por RLS (42501), por un trigger (increment_unread_count y
        // unhide_chat_on_new_message no tienen bloque EXCEPTION, asi que
        // una excepcion suya aborta el INSERT) o por red. El redirect de
        // abajo es incondicional: sin este chequeo el fallo es invisible
        // para las dos partes.
        const { error: intentMsgErr } = await supabase.from("messages").insert({
          chat_id: result.chatId,
          autor_id: user.id,
          texto: `🛒 ${profile?.nombre ?? "Un comprador"} quiere comprar: ${product.titulo} ${
            precioFmt
              ? `por ${precioFmt} MXN`
              : `(${priceFallbackLabel(product.modo_precio)})`
          }`,
        });
        if (intentMsgErr) {
          console.error("[chat] buy-intent message insert:", intentMsgErr);
          Sentry.captureException(intentMsgErr, {
            tags: { action: "chat_buy_intent", step: "message_insert" },
            extra: { productId: params.product, chatId: result.chatId },
          });
          redirect(`/chat/${result.chatId}?intentFailed=1`);
        }
      }
      redirect(`/chat/${result.chatId}`);
    }
  }

  return <ChatList />;
}
