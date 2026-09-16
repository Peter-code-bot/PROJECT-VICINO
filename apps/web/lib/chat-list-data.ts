import "server-only";
import { createClient } from "@/lib/supabase/server";
export async function getChatList() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
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

  return { userId: user.id, value: { visibleChats, userId: user.id } };
}
