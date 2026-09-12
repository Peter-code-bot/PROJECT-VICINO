import { Suspense } from "react";
import { redirect } from "next/navigation";
import { InvitacionVendedor } from "./invitacion-vendedor";
import { createClient } from "@/lib/supabase/server";
import { ProfileHeader } from "./profile-header";
import { ProfileTabs, ProfileProducts, ProfileReviews, type ProfileTabsProps } from "./profile-tabs";
import { ProfilePanelRetry } from "./profile-panel-retry";
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

  // Start supplementary reads concurrently, but only the profile gates its
  // header/actions. Every deferred promise handles rejection immediately.
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

  const productsData = settle((async () => {
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
  const reviewsData = settle(Promise.all([reviewsAsSellerQuery, reviewsAsBuyerQuery]).then(([seller, buyer]) => ({
    reviewsAsSeller: seller.data ?? [], reviewsAsBuyer: buyer.data ?? [],
  })));
  const followersData = settle(Promise.resolve(followersCountQuery).then(result => result.count ?? 0));
  const followingData = settle(Promise.resolve(followingCountQuery).then(result => result.count ?? 0));
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

  return (
    <div data-navigation-kind="profile" data-navigation-ready={crypto.randomUUID()} className="max-w-3xl mx-auto px-4 py-6 pb-24 md:pb-8">
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
        productCount={<Suspense fallback={<span aria-label="Cargando productos">…</span>}><ProductCount data={productsData} /></Suspense>}
        purchaseCount={0}
        followersCount={<Suspense fallback={<span aria-label="Cargando seguidores">…</span>}><Count data={followersData} label="seguidores" /></Suspense>}
        followingCount={<Suspense fallback={<span aria-label="Cargando siguiendo">…</span>}><Count data={followingData} label="siguiendo" /></Suspense>}
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
        key={user.id}
        products={[]}
        reviewsAsSeller={[]}
        reviewsAsBuyer={[]}
        reviewCount={<Suspense fallback="…"><ReviewCount data={reviewsData} /></Suspense>}
        productsPanel={<Suspense fallback={<PanelPending label="publicaciones" />}><ProductsPanel data={productsData} isVendedor={profile?.es_vendedor ?? false} /></Suspense>}
        reviewsPanel={<Suspense fallback={<PanelPending label="reseñas" />}><ReviewsPanel data={reviewsData} currentUserId={user.id} /></Suspense>}
        isVendedor={profile?.es_vendedor ?? false}
        currentUserId={user.id}
      />
    </div>
  );
}

// Results are fulfilled even on failure so an unselected tab never leaves an
// unhandled rejection. Errors stay local and never become a successful empty list.
type Result<T> = { ok: true; value: T } | { ok: false };
function settle<T>(promise: PromiseLike<T>): Promise<Result<T>> {
  return Promise.resolve(promise).then(value => ({ ok: true as const, value }), () => ({ ok: false as const }));
}
type Products = ProfileTabsProps["products"];
type Reviews = Pick<ProfileTabsProps, "reviewsAsSeller" | "reviewsAsBuyer">;
function PanelPending({ label }: { label: string }) {
  return <p role="status" className="min-h-32 py-6 text-sm text-fg-muted">Cargando {label}…</p>;
}
async function ProductsPanel({ data, isVendedor }: { data: Promise<Result<Products>>; isVendedor: boolean }) {
  const result = await data;
  if (!result.ok) return <ProfilePanelRetry label="publicaciones" />;
  return <ProfileProducts products={result.value} isVendedor={isVendedor} />;
}
async function ReviewsPanel({ data, currentUserId }: { data: Promise<Result<Reviews>>; currentUserId: string }) {
  const result = await data;
  if (!result.ok) return <ProfilePanelRetry label="reseñas" />;
  return <ProfileReviews {...result.value} currentUserId={currentUserId} />;
}
async function ProductCount({ data }: { data: Promise<Result<Products>> }) {
  const result = await data;
  return result.ok ? result.value.length : <span aria-label="Cantidad de productos no disponible">—</span>;
}
async function ReviewCount({ data }: { data: Promise<Result<Reviews>> }) {
  const result = await data;
  return result.ok ? result.value.reviewsAsSeller.length + result.value.reviewsAsBuyer.length : <span aria-label="Cantidad de reseñas no disponible">—</span>;
}
async function Count({ data, label }: { data: Promise<Result<number>>; label: string }) {
  const result = await data;
  return result.ok ? result.value : <ProfilePanelRetry label={label} compact />;
}
