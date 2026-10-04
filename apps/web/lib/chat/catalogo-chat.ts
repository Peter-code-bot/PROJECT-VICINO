import { publicProfileName } from "@vicino/shared";
import type { createClient } from "@/lib/supabase/server";
import type { ProductoChat } from "./producto-activo";

type Client = Awaited<ReturnType<typeof createClient>>;
export type VendedorChat = { id: string; nombre: string; foto: string | null };
export type CatalogoChat = { data: ProductoChat[]; sellers: VendedorChat[]; sellerId: string | null };

/** Caller authenticates chat membership. All queries still use the caller's RLS client. */
export async function loadChatCatalog(client: Client, participants: string[], requestedSeller?: string, search?: string): Promise<CatalogoChat> {
  if (requestedSeller && !participants.includes(requestedSeller)) throw new Error("INVALID_SELLER");
  const available = () => client.from("products_services")
    .select("id,titulo,precio,modo_precio,imagen_principal,creador_id,estatus,is_hidden")
    .eq("estatus", "disponible").eq("is_hidden", false);
  const ids = [...new Set(participants)];
  const availability = await Promise.all(ids.map(id => available().eq("creador_id", id).limit(1)));
  if (availability.some(r => r.error || !r.data)) throw new Error("CATALOG_UNAVAILABLE");
  const eligible = ids.filter((_, i) => availability[i]!.data!.length > 0);
  if (!eligible.length) return { data: [], sellers: [], sellerId: null };
  const profiles = await client.from("profiles").select("id,nombre,nombre_negocio,seller_type,foto, es_vendedor").in("id", eligible);
  if (profiles.error || !profiles.data) throw new Error("SELLERS_UNAVAILABLE");
  const sellers = eligible.map(id => {
    const p = profiles.data.find(profile => profile.id === id);
    return { id, nombre: publicProfileName(p, "Participante"), foto: p?.foto ?? null };
  });
  const sellerId = eligible.includes(requestedSeller ?? "") ? requestedSeller! : eligible.length === 1 ? eligible[0]! : null;
  if (!sellerId) return { data: [], sellers, sellerId };
  let query = available().eq("creador_id", sellerId).order("titulo").order("id").limit(50);
  if (search) query = query.ilike("titulo", `%${search.replace(/[\\%_]/g, "\\$&")}%`);
  const products = await query;
  if (products.error || !products.data) throw new Error("PRODUCTS_UNAVAILABLE");
  return { data: products.data, sellers, sellerId };
}
