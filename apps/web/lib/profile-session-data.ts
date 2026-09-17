import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import { createClient } from "@/lib/supabase/server";
import { usuarioOInvitado } from "@/lib/session-auth";

export type ProfileSessionPart = "core" | "products" | "reviews" | "counts";

/**
 * Sesion que quien llama YA resolvio. La pagina de /perfil pasa por
 * auth.getUser() para decidir el redirect de invitados y tiene el cliente en
 * la mano; sin esto cada una de las cuatro partes crearia su propio cliente y
 * volveria a Auth por el mismo usuario (cuatro viajes que no aportan nada).
 * El correo viaja porque `core` lo devuelve como profile.email.
 */
export interface ProfileSessionContext {
  supabase: SupabaseClient<Database>;
  user: { id: string; email?: string };
}

type Client = ProfileSessionContext["supabase"];
type Usuario = ProfileSessionContext["user"];

async function cargarCore(supabase: Client, user: Usuario) {
  const { data: profileData } = await supabase
    .from("profiles")
    .select(
      "id, nombre, foto, bio, user_id, username, ubicacion, es_vendedor, seller_type, nombre_negocio, categoria_negocio, metodos_pago_aceptados, trust_level, trust_points, total_sales, average_rating, reviews_count, is_verified, created_at, alta_vendedor_paso"
    ).throwOnError()
    .eq("id", user.id)
    .single();
  if (!profileData) throw new Error("No se pudo cargar el perfil. Intenta de nuevo.");

  // Con el Database generico puesto, `profiles` confiesa lo que ya era verdad
  // en la base: casi todas sus columnas de estado son NULLABLE. Tienen DEFAULT,
  // pero un DEFAULT no es una promesa, asi que el valor de reposo se aplica
  // aqui una sola vez en vez de repetirlo en cada consumidor (ProfileHeader ya
  // lo venia haciendo por su cuenta con trust_points y trust_level).
  //
  // `created_at` es el unico sin valor de reposo honesto: inventar una fecha
  // seria mentir. ProfileHeader ya declara created_at nulable y guarda el
  // bloque "Miembro desde" con `{profile.created_at && ...}`, asi que un perfil
  // sin fecha no pinta nada; un "" aqui solo dejaria un valor inventado que el
  // siguiente lector heredaria como si significara algo.
  //
  // Sin ternario sobre profileData: el guard de arriba ya lanzo si no habia
  // fila, y un `: null` de mas convertia el tipo de la parte en `Perfil | null`,
  // que la semilla del servidor no puede sembrar.
  return {
    ...profileData,
    email: user.email || "",
    es_vendedor: profileData.es_vendedor ?? false,
    trust_level: profileData.trust_level ?? "nuevo",
    trust_points: profileData.trust_points ?? 0,
    total_sales: profileData.total_sales ?? 0,
    average_rating: profileData.average_rating ?? 0,
    reviews_count: profileData.reviews_count ?? 0,
    is_verified: profileData.is_verified ?? false,
    created_at: profileData.created_at,
  };
}

// MP#08 #5c-4: SELECT expandido con product_categories embed para que la
// data fluya al tipo ProfileTabsProps.products. Render visual de badges en
// SortableProductCard esta DIFERIDO a 5c-4-bis: ese componente es
// image-only (overlay con precio hover + badge PAUSADO existente) y
// requiere diseno de overlay propio para no colisionar.
async function cargarProducts(supabase: Client, user: Usuario) {
  const result = await supabase
    .from("products_services")
    .select("id, titulo, precio, modo_precio, imagen_principal, categoria, slug, estatus, ventas_count, sort_order, product_categories(is_primary, categories(slug, nombre))")
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });
  // 42703 = columna inexistente: una base sin sort_order todavia (ledger
  // desincronizado) no debe dejar el perfil sin publicaciones; se pide sin la
  // columna y se rellena con 0, el mismo DEFAULT con el que nace la columna
  // (20260825120000), para que la fila tenga la misma forma en los dos casos.
  if (result.error?.code === "42703") {
    const fallback = await supabase.from("products_services")
      .select("id, titulo, precio, modo_precio, imagen_principal, categoria, slug, estatus, ventas_count, product_categories(is_primary, categories(slug, nombre))")
      .eq("creador_id", user.id).neq("estatus", "eliminado")
      .order("created_at", { ascending: false }).throwOnError();
    return (fallback.data ?? []).map(product => ({ ...product, sort_order: 0 }));
  }
  if (result.error) throw result.error;
  return result.data ?? [];
}

async function cargarReviews(supabase: Client, user: Usuario) {
  const reviewsAsSellerQuery = supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, reviewer_id, profiles!reviewer_id(nombre, foto), products_services!product_id(id, titulo, categoria, slug, imagen_principal, product_categories(is_primary, categories(slug)))").throwOnError()
    .eq("reviewed_id", user.id)
    .eq("review_type", "buyer_to_seller")
    .eq("visible", true)
    // LEFT JOIN deliberada: queremos preservar la reseña aunque el producto esté
    // eliminado. <ReviewProductLink> degrada a "Producto no disponible" si el
    // join devuelve null. NO cambiar a !inner — esconde reseñas históricas válidas.
    .eq("products_services.estatus", "disponible")
    .eq("products_services.is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(10);

  const reviewsAsBuyerQuery = supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, reviewer_id, profiles!reviewer_id(nombre, foto), products_services!product_id(id, titulo, categoria, slug, imagen_principal, product_categories(is_primary, categories(slug)))").throwOnError()
    .eq("reviewed_id", user.id)
    .eq("review_type", "seller_to_buyer")
    .eq("visible", true)
    // LEFT JOIN deliberada: queremos preservar la reseña aunque el producto esté
    // eliminado. <ReviewProductLink> degrada a "Producto no disponible" si el
    // join devuelve null. NO cambiar a !inner — esconde reseñas históricas válidas.
    .eq("products_services.estatus", "disponible")
    .eq("products_services.is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(10);

  const [seller, buyer] = await Promise.all([reviewsAsSellerQuery, reviewsAsBuyerQuery]);
  return { reviewsAsSeller: seller.data ?? [], reviewsAsBuyer: buyer.data ?? [] };
}

async function cargarCounts(supabase: Client, user: Usuario) {
  const followersCountQuery = supabase
    .from("store_follows")
    .select("id", { count: "exact", head: true }).throwOnError()
    .eq("store_id", user.id);

  const followingCountQuery = supabase
    .from("store_follows")
    .select("id", { count: "exact", head: true }).throwOnError()
    .eq("follower_id", user.id);

  const [followers, following] = await Promise.all([followersCountQuery, followingCountQuery]);
  return { followers: followers.count ?? 0, following: following.count ?? 0 };
}

/** Forma exacta de cada parte, derivada de las consultas para que no se desincronice de los SELECT. */
export type ProfileSessionValue = {
  core: Awaited<ReturnType<typeof cargarCore>>;
  products: Awaited<ReturnType<typeof cargarProducts>>;
  reviews: Awaited<ReturnType<typeof cargarReviews>>;
  counts: Awaited<ReturnType<typeof cargarCounts>>;
};

export interface ProfileSessionResult<P extends ProfileSessionPart> {
  userId: string;
  value: ProfileSessionValue[P];
}

function cargarParte(part: ProfileSessionPart, supabase: Client, user: Usuario): Promise<ProfileSessionValue[ProfileSessionPart]> {
  if (part === "products") return cargarProducts(supabase, user);
  if (part === "reviews") return cargarReviews(supabase, user);
  if (part === "counts") return cargarCounts(supabase, user);
  return cargarCore(supabase, user);
}

// Sobrecargas por parte: page.tsx siembra cada parte con su tipo concreto y no
// con la union de las cuatro, que no seria asignable a ninguna semilla. La
// ultima sobrecarga (la union) es la que usa /api/session/profile, que recibe
// la parte ya validada por zod como union.
export function getProfileSession(part: "core", ctx?: ProfileSessionContext): Promise<ProfileSessionResult<"core"> | null>;
export function getProfileSession(part: "products", ctx?: ProfileSessionContext): Promise<ProfileSessionResult<"products"> | null>;
export function getProfileSession(part: "reviews", ctx?: ProfileSessionContext): Promise<ProfileSessionResult<"reviews"> | null>;
export function getProfileSession(part: "counts", ctx?: ProfileSessionContext): Promise<ProfileSessionResult<"counts"> | null>;
export function getProfileSession(part: ProfileSessionPart, ctx?: ProfileSessionContext): Promise<ProfileSessionResult<ProfileSessionPart> | null>;
export async function getProfileSession(part: ProfileSessionPart, ctx?: ProfileSessionContext): Promise<ProfileSessionResult<ProfileSessionPart> | null> {
  // Sin contexto (la ruta /api/session/profile y los scripts de prueba, que no
  // tienen a nadie delante) la sesion se resuelve aqui, como siempre.
  const session = ctx ?? (await resolverSesion());
  if (!session) return null;
  const value = await cargarParte(part, session.supabase, session.user);
  return { userId: session.user.id, value };
}

async function resolverSesion(): Promise<ProfileSessionContext | null> {
  const supabase = await createClient();
  // Lanza si Auth no contesto (503 en la ruta); `null` solo sin sesion (401).
  const user = await usuarioOInvitado(supabase);
  if (!user) return null;
  return { supabase, user };
}
