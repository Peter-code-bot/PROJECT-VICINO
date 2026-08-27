import { redirect } from "next/navigation";
import { InvitacionVendedor } from "./invitacion-vendedor";
import { createClient } from "@/lib/supabase/server";
import { ProfileHeader } from "./profile-header";
import { ProfileTabs } from "./profile-tabs";
import { AccountMenuDrawer } from "@/components/profile/account-menu-drawer";
import { Menu, Pencil } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Mi perfil — VICINO" };

export default async function PerfilPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/perfil");

  const { data: profileData, error: profileError } = await supabase
    .from("profiles")
    .select(
      "id, nombre, foto, bio, user_id, username, ubicacion, es_vendedor, seller_type, nombre_negocio, categoria_negocio, metodos_pago_aceptados, trust_level, trust_points, total_sales, average_rating, reviews_count, is_verified, created_at, alta_vendedor_paso"
    )
    .eq("id", user.id)
    .single();

  if (profileError) {
    console.error("[perfil] Error loading profile:", profileError);
  }

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

  // Get user's products.
  // MP#08 #5c-4: SELECT expandido con product_categories embed para que la
  // data fluya al tipo ProfileTabsProps.products. Render visual de badges en
  // SortableProductCard esta DIFERIDO a 5c-4-bis: ese componente es
  // image-only (overlay con precio hover + badge PAUSADO existente) y
  // requiere diseno de overlay propio para no colisionar.
  const productsQuery = await supabase
    .from("products_services")
    .select("id, titulo, precio, modo_precio, imagen_principal, categoria, slug, estatus, ventas_count, sort_order, product_categories(is_primary, categories(slug, nombre))")
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .order("sort_order", { ascending: true })
    .order("created_at", { ascending: false });

  // `products` sigue siendo let porque el respaldo de mas abajo lo reasigna;
  // `productsError` no se reasigna nunca, y estaba compartiendo el let solo por
  // venir del mismo destructuring.
  const productsError = productsQuery.error;
  let products = productsQuery.data;

  // Fallback si la migración de sort_order aún no se ha aplicado en la BD
  if (productsError && productsError.code === "42703") {
    const fallback = await supabase
      .from("products_services")
      .select("id, titulo, precio, modo_precio, imagen_principal, categoria, slug, estatus, ventas_count, product_categories(is_primary, categories(slug, nombre))")
      .eq("creador_id", user.id)
      .neq("estatus", "eliminado")
      .order("created_at", { ascending: false });

    products = fallback.data ? fallback.data.map(p => ({ ...p, sort_order: 0 })) : null;
  }

  // slug, estatus y ventas_count tambien son NULLABLE en products_services.
  // Las tres columnas nulables (slug, estatus, ventas_count) se pasan TAL CUAL:
  // ProfileTabs ya las declara nulables y ya decide que hacer con cada una.
  //
  // Aqui hubo un `slug: p.slug ?? p.id` que habia que quitar. Anulaba la guarda
  // del hijo —"sin slug no hay pagina de detalle, la tarjeta se pinta sin
  // envolver"— porque con el respaldo puesto `!p.slug` nunca era cierto. El
  // resultado no era "sin enlace": era un enlace a /categoria/<id>, y la ruta
  // de detalle resuelve SOLO por slug, o sea un 404. El respaldo por id esta
  // copiado en otros cuatro sitios del marketplace y no funciona en ninguno.
  const productsForTabs = products ?? [];

  // Get reviews received
  const { data: reviewsAsSeller } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, reviewer_id, profiles!reviewer_id(nombre, foto), products_services!product_id(id, titulo, categoria, slug, imagen_principal, product_categories(is_primary, categories(slug)))")
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

  const { data: reviewsAsBuyer } = await supabase
    .from("reviews")
    .select("id, rating, comentario, created_at, review_type, reviewer_id, profiles!reviewer_id(nombre, foto), products_services!product_id(id, titulo, categoria, slug, imagen_principal, product_categories(is_primary, categories(slug)))")
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

  // Count purchases
  const { count: purchaseCount } = await supabase
    .from("sale_confirmations")
    .select("id", { count: "exact", head: true })
    .eq("buyer_id", user.id)
    .eq("status", "completed");

  const { count: followersCount } = await supabase
    .from("store_follows")
    .select("id", { count: "exact", head: true })
    .eq("store_id", user.id);

  const { count: followingCount } = await supabase
    .from("store_follows")
    .select("id", { count: "exact", head: true })
    .eq("follower_id", user.id);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 pb-24 md:pb-8 animate-fade-in-up">
      {/* Mobile drawer trigger & Edit button */}
      <div className="md:hidden flex justify-end gap-2 mb-4">
        {profile?.es_vendedor && (
          <Link
            href="?edit=products"
            scroll={false}
            className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#F4F1EB] text-[#1A1A2E] transition-colors"
            aria-label="Editar productos"
          >
            <Pencil className="w-4 h-4" />
          </Link>
        )}
        <AccountMenuDrawer
          userName={profile?.nombre}
          userAvatar={profile?.foto}
          // user_id es NULLABLE y el drawer solo distingue "hay" de "no hay"
          // (`{userId && ...}`), asi que null y ausente valen lo mismo aqui.
          userId={profile?.user_id ?? undefined}
          userIsVendedor={profile?.es_vendedor ?? false}
          trigger={
            <button
              aria-label="Menú de cuenta"
              className="inline-flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#F4F1EB] text-[#1A1A2E] transition-colors"
            >
              <Menu className="w-5 h-5" />
            </button>
          }
        />
      </div>
      <ProfileHeader
        profile={profile}
        productCount={productsForTabs.length}
        purchaseCount={purchaseCount ?? 0}
        followersCount={followersCount ?? 0}
        followingCount={followingCount ?? 0}
      />
      {/* La cuarta puerta al alta de vendedor, y la unica que no depende de
          que la persona se tropiece con ella. Las otras tres se cruzan por
          accidente: al registrarse, o al ser rebotado de una zona de vendedor.
          Quien decide un dia que quiere vender no tenia donde pulsar. */}
      <div className="mt-4">
        <InvitacionVendedor
          esVendedor={profile?.es_vendedor ?? false}
          altaPaso={profile?.alta_vendedor_paso ?? null}
        />
      </div>

      <ProfileTabs
        products={productsForTabs}
        reviewsAsSeller={reviewsAsSeller ?? []}
        reviewsAsBuyer={reviewsAsBuyer ?? []}
        isVendedor={profile?.es_vendedor ?? false}
        currentUserId={user.id}
      />
    </div>
  );
}
