import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { ProductDetailMobile } from "@/components/product/product-detail-mobile";
import { ProductDetailDesktop } from "@/components/product/product-detail-desktop";
import type {
  ProductDetailCoupon,
  ProductDetailData,
  ProductDetailReview,
} from "@/components/product/types";

interface Props {
  params: Promise<{ categoria: string; slug: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products_services")
    .select("titulo, descripcion, imagen_principal, precio")
    .eq("slug", slug)
    .single();

  if (!product) return { title: "Producto no encontrado" };

  return {
    title: product.titulo,
    description: product.descripcion?.slice(0, 160),
    openGraph: {
      title: `${product.titulo} — VICINO`,
      description: product.descripcion?.slice(0, 160),
      images: product.imagen_principal ? [product.imagen_principal] : [],
    },
  };
}

export default async function ProductDetailPage({ params }: Props) {
  const { slug } = await params;
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("products_services")
    .select(
      `
      *,
      profiles!inner(
        id, nombre, foto, trust_level, metodos_pago_aceptados,
        average_rating, reviews_count, total_sales
      )
    `
    )
    .eq("slug", slug)
    // .neq() (NOT .eq("disponible")) on purpose — RLS already filters
    // non-creators to disponible-only via block_aware_products_select; the
    // creator-bypass path needs to keep working so a seller can preview their
    // own pausado/borrador/agotado listing detail before relisting it.
    .neq("estatus", "eliminado")
    .single();

  if (!product) notFound();

  const seller = Array.isArray(product.profiles)
    ? product.profiles[0]
    : product.profiles;

  const { data: reviews } = await supabase
    .from("reviews")
    .select(
      `
      id, rating, comentario, created_at, review_type, respuesta, respuesta_fecha, reviewer_id,
      profiles!reviewer_id(nombre, foto, trust_level),
      products_services!product_id(id, titulo, categoria, slug, imagen_principal)
    `
    )
    .eq("reviewed_id", product.creador_id)
    .eq("review_type", "buyer_to_seller")
    .eq("visible", true)
    .order("created_at", { ascending: false })
    .limit(50);

  const { data: coupons } = await supabase
    .from("coupons")
    .select("codigo, tipo_descuento, valor")
    .eq("vendedor_id", product.creador_id)
    .eq("activo", true)
    .or("fecha_expiracion.is.null,fecha_expiracion.gt." + new Date().toISOString())
    .limit(5);

  const {
    data: { user },
  } = await supabase.auth.getUser();
  let isFavorite = false;
  if (user) {
    const { data: fav } = await supabase
      .from("favorites")
      .select("id")
      .eq("usuario_id", user.id)
      .eq("producto_id", product.id)
      .maybeSingle();
    isFavorite = !!fav;
  }

  // Increment view count (fire and forget).
  supabase
    .from("products_services")
    .update({ vistas_count: (product.vistas_count ?? 0) + 1 })
    .eq("id", product.id)
    .then();

  const deliveryLabel =
    product.tipo_entrega === "pickup"
      ? "Recoger en punto local"
      : product.tipo_entrega === "envio"
        ? "Envío disponible"
        : "Pickup o envío disponible";

  const isOwner = user?.id === product.creador_id;

  const data: ProductDetailData = {
    product: product as unknown as ProductDetailData["product"],
    seller: seller as unknown as ProductDetailData["seller"],
    reviews: (reviews ?? []) as ProductDetailReview[],
    coupons: (coupons ?? []) as ProductDetailCoupon[],
    isFavorite,
    user: user ? { id: user.id } : null,
    isOwner,
    deliveryLabel,
  };

  return (
    <div className="max-w-4xl mx-auto md:py-8 animate-fade-in">
      <div className="hidden md:flex items-center gap-2 text-sm text-muted-foreground mb-6 px-4">
        <Link href="/" className="hover:text-primary transition-colors">
          Inicio
        </Link>
        <ChevronRight className="w-4 h-4" />
        <Link
          href={`/buscar?category=${product.categoria}`}
          className="hover:text-primary transition-colors capitalize"
        >
          {product.categoria.replace("-", " ")}
        </Link>
        <ChevronRight className="w-4 h-4" />
        <span className="text-foreground truncate max-wxs">
          {product.titulo}
        </span>
      </div>

      <div className="md:hidden">
        <ProductDetailMobile {...data} />
      </div>
      <div className="hidden md:block">
        <ProductDetailDesktop {...data} />
      </div>
    </div>
  );
}
