import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";
import { usuarioOInvitado } from "@/lib/session-auth";

/**
 * Sesion que quien llama YA resolvio. La pagina de /chat pasa por
 * auth.getUser() para decidir el redirect de invitados y tiene el cliente en
 * la mano: aceptarlos evita un segundo viaje a Auth por navegacion solo para
 * volver a obtener el mismo id.
 */
export interface ChatListContext {
  supabase: SupabaseClient<Database>;
  userId: string;
}

export async function getChatList(ctx?: ChatListContext) {
  // Sin contexto (la ruta /api/session/chats, que no tiene a nadie delante)
  // la sesion se resuelve aqui, como siempre.
  const session = ctx ?? (await resolverSesion());
  if (!session) return null;
  const { supabase, userId } = session;
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
    .or(`comprador_id.eq.${userId},vendedor_id.eq.${userId}`)
    .order("updated_at", { ascending: false });

  // Filtrar chats ocultos para este usuario (soft delete)
  const visibleChats = chats?.filter((chat) => {
    const compradorProfile = Array.isArray(chat.comprador) ? chat.comprador[0] : chat.comprador;
    const isBuyer = compradorProfile?.id === userId;
    return isBuyer ? !chat.oculto_para_comprador : !chat.oculto_para_vendedor;
  }) ?? [];

  return { userId, value: { visibleChats, userId } };
}

async function resolverSesion(): Promise<ChatListContext | null> {
  const supabase = await createClient();
  // Lanza si Auth no contesto: la ruta responde 503 y el cliente conserva la
  // lista; `null` queda solo para quien de verdad no tiene sesion (401).
  const user = await usuarioOInvitado(supabase);
  if (!user) return null;
  return { supabase, userId: user.id };
}
