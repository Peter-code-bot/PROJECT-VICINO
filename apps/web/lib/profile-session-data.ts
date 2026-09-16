import "server-only";
import { createClient } from "@/lib/supabase/server";
export async function getProfileSession(part: "core" | "products" | "reviews" | "counts") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const profileQuery = supabase
    .from("profiles")
    .select(
      "id, nombre, foto, bio, user_id, username, ubicacion, es_vendedor, seller_type, nombre_negocio, categoria_negocio, metodos_pago_aceptados, trust_level, trust_points, total_sales, average_rating, reviews_count, is_verified, created_at, alta_vendedor_paso"
    ).throwOnError()
    .eq("id", user.id)
    .single();

  // Get user's products.
  // MP#08 #5c-4: SELECT expandido con product_categories embed para que la
  // data fluya al tipo ProfileTabsProps.products. Render visual de badges en
  // SortableProductCard esta DIFERIDO a 5c-4-bis: ese componente es
  // image-only (overlay con precio hover + badge PAUSADO existente) y
  // requiere diseno de overlay propio para no colisionar.
  const productsQueryBuilder = supabase
    .from("products_services")
    .select("id, titulo, precio, modo_precio, imagen_principal, categoria, slug, estatus, ventas_count, sort_order, product_categories(is_primary, categories(slug, nombre))")
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

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

  const followersCountQuery = supabase
    .from("store_follows")
    .select("id", { count: "exact", head: true }).throwOnError()
    .eq("store_id", user.id);

  const followingCountQuery = supabase
    .from("store_follows")
    .select("id", { count: "exact", head: true }).throwOnError()
    .eq("follower_id", user.id);

  const value = await (async () => {
    if (part === "products") {
  return await ((async () => {
    const result = await productsQueryBuilder;
    if (result.error?.code === "42703") {
      const fallback = await supabase.from("products_services")
        .select("id, titulo, precio, modo_precio, imagen_principal, categoria, slug, estatus, ventas_count, product_categories(is_primary, categories(slug, nombre))")
        .eq("creador_id", user.id).neq("estatus", "eliminado")
        .order("created_at", { ascending: false }).throwOnError();
      return (fallback.data ?? []).map(product => ({ ...product, sort_order: 0 }));
    }
    if (result.error) throw result.error;
    return result.data ?? [];
  })());
    }
    if (part === "reviews") {
      const [seller, buyer] = await Promise.all([reviewsAsSellerQuery, reviewsAsBuyerQuery]);
      return { reviewsAsSeller: seller.data ?? [], reviewsAsBuyer: buyer.data ?? [] };
    }
    if (part === "counts") {
      const [followers, following] = await Promise.all([followersCountQuery, followingCountQuery]);
      return { followers: followers.count ?? 0, following: following.count ?? 0 };
    }
  const { data: profileData } = await profileQuery;
  if (!profileData) throw new Error("No se pudo cargar el perfil. Intenta de nuevo.");

  // Con el Database generico puesto, `profiles` confiesa lo que ya era verdad
  // en la base: casi todas sus columnas de estado son NULLABLE. Tienen DEFAULT,
  // pero un DEFAULT no es una promesa, asi que el valor de reposo se aplica
  // aqui una sola vez en vez de repetirlo en cada consumidor (ProfileHeader ya
  // lo venia haciendo por su cuenta con trust_points y trust_level).
  //
  // `created_at` es el unico sin valor de reposo honesto: inventar una fecha
  // seria mentir. La cadena vacia es el sentinel que el render de ProfileHeader
  // ya trata como ausencia — pinta "Miembro desde" dentro de un
  // `{profile.created_at && ...}` — asi que un perfil sin fecha no pinta nada.
  const profile = profileData
    ? {
        ...profileData,
        email: user.email || "",
        es_vendedor: profileData.es_vendedor ?? false,
        trust_level: profileData.trust_level ?? "nuevo",
        trust_points: profileData.trust_points ?? 0,
        total_sales: profileData.total_sales ?? 0,
        average_rating: profileData.average_rating ?? 0,
        reviews_count: profileData.reviews_count ?? 0,
        is_verified: profileData.is_verified ?? false,
        // Sin centinela: ProfileHeader ya declara created_at nulable y guarda el
        // bloque "Miembro desde" con `{profile.created_at && ...}`. Un "" aqui solo
        // dejaria un valor inventado que el siguiente lector heredaria como si
        // significara algo.
        created_at: profileData.created_at,
      }
    : null;

    return profile;
  })();
  return { userId: user.id, value };
}
