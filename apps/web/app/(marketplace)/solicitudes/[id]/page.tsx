import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft, Clock, MapPin, DollarSign, MessageSquare } from "lucide-react";
import { OffersList } from "@/components/solicitudes/offers-list";

interface Props {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();
  const { data } = await supabase
    .from("purchase_requests")
    .select("title")
    .eq("id", id)
    .single();

  return {
    title: data ? `${data.title} — Solicitudes VICINO` : "Solicitud — VICINO",
  };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Ahora";
  if (mins < 60) return `Hace ${mins}m`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  return `Hace ${days}d`;
}

function timeLeft(dateStr: string): string {
  const diff = new Date(dateStr).getTime() - Date.now();
  if (diff <= 0) return "Expirada";
  const hrs = Math.floor(diff / (1000 * 60 * 60));
  if (hrs < 1) return "Menos de 1h";
  if (hrs < 24) return `${hrs}h restantes`;
  const days = Math.floor(hrs / 24);
  return `${days}d restantes`;
}

export default async function SolicitudDetailPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Fetch the request with buyer profile
  const { data: request, error } = await supabase
    .from("purchase_requests")
    .select(
      `
      id,
      buyer_id,
      title,
      description,
      budget_estimated,
      image_url,
      status,
      expires_at,
      created_at,
      profiles!purchase_requests_buyer_id_fkey (
        nombre,
        avatar_url
      )
    `
    )
    .eq("id", id)
    .single();

  if (error || !request) {
    notFound();
  }

  // Fetch categories for this request
  const { data: categories } = await supabase
    .from("purchase_request_categories")
    .select(
      `
      categories (
        slug,
        nombre
      )
    `
    )
    .eq("request_id", id);

  // Fetch responses/offers
  const { data: responses } = await supabase
    .from("request_responses")
    .select(
      `
      id,
      seller_id,
      message_offer,
      price_offer,
      linked_product_id,
      created_at,
      profiles!request_responses_seller_id_fkey (
        nombre,
        avatar_url,
        average_rating,
        reviews_count
      )
    `
    )
    .eq("request_id", id)
    .order("created_at", { ascending: true });

  // Check if current user already has an offer
  const userHasOffer =
    user && responses?.some((r) => r.seller_id === user.id);

  const isOwner = user?.id === request.buyer_id;
  const isOpen = request.status === "open" && new Date(request.expires_at) > new Date();

  const buyerProfile = request.profiles as unknown as {
    nombre: string;
    avatar_url: string | null;
  };

  const catList = (categories ?? [])
    .map((c: any) => c.categories)
    .filter(Boolean) as Array<{ slug: string; nombre: string }>;

  return (
    <div className="w-full min-h-screen pb-32">
      {/* ─── Top bar ──────────────────────────────────── */}
      <div className="sticky top-0 z-30 bg-background/80 backdrop-blur-lg border-b border-border/50">
        <div className="flex items-center gap-3 px-4 py-3">
          <Link
            href="/?feed=solicitudes"
            className="flex h-9 w-9 items-center justify-center rounded-full bg-muted"
          >
            <ArrowLeft className="h-4 w-4 text-foreground" />
          </Link>
          <h1 className="font-heading text-base font-bold text-foreground truncate">
            Solicitud
          </h1>
          {!isOpen && (
            <span className="ml-auto rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
              {request.status === "closed" ? "Cerrada" : "Expirada"}
            </span>
          )}
        </div>
      </div>

      {/* ─── Request detail ───────────────────────────── */}
      <div className="px-4 pt-5 max-w-2xl mx-auto">
        {/* Buyer info */}
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0">
            {buyerProfile.avatar_url ? (
              <Image
                src={buyerProfile.avatar_url}
                alt={buyerProfile.nombre}
                width={40}
                height={40}
                className="h-full w-full object-cover"
              />
            ) : (
              <span className="font-semibold text-foreground">
                {buyerProfile.nombre.charAt(0).toUpperCase()}
              </span>
            )}
          </div>
          <div>
            <p className="font-medium text-foreground text-sm">
              {buyerProfile.nombre}
            </p>
            <p className="text-xs text-muted-foreground">
              {timeAgo(request.created_at)}
            </p>
          </div>
          {isOpen && (
            <span className="ml-auto inline-flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {timeLeft(request.expires_at)}
            </span>
          )}
        </div>

        {/* Title */}
        <h2 className="font-heading text-2xl font-bold text-foreground mb-2">
          {request.title}
        </h2>

        {/* Description */}
        {request.description && (
          <p className="text-sm text-muted-foreground leading-relaxed mb-4">
            {request.description}
          </p>
        )}

        {/* Image */}
        {request.image_url && (
          <div className="relative w-full aspect-video rounded-2xl overflow-hidden mb-4">
            <Image
              src={request.image_url}
              alt={request.title}
              fill
              className="object-cover"
              sizes="(max-width: 768px) 100vw, 672px"
            />
          </div>
        )}

        {/* Chips */}
        <div className="flex flex-wrap items-center gap-2 mb-6">
          {request.budget_estimated && (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-3 py-1 text-sm font-medium text-emerald-600 dark:text-emerald-400">
              <DollarSign className="h-3.5 w-3.5" />
              Presupuesto: ${request.budget_estimated.toLocaleString()} MXN
            </span>
          )}
          {catList.map((cat) => (
            <span
              key={cat.slug}
              className="inline-flex rounded-full bg-muted px-3 py-1 text-sm text-muted-foreground"
            >
              {cat.nombre}
            </span>
          ))}
        </div>

        {/* Divider */}
        <div className="border-t border-border mb-6" />

        {/* ─── Offers section ─────────────────────────── */}
        <div className="mb-4 flex items-center justify-between">
          <h3 className="font-heading text-lg font-bold text-foreground inline-flex items-center gap-2">
            <MessageSquare className="h-5 w-5" />
            Ofertas ({responses?.length ?? 0})
          </h3>
        </div>

        <OffersList
          requestId={id}
          responses={
            (responses ?? []).map((r) => ({
              ...r,
              profiles: r.profiles as unknown as {
                nombre: string;
                avatar_url: string | null;
                average_rating: number | null;
                reviews_count: number | null;
              },
            }))
          }
          isOwner={isOwner}
          isOpen={isOpen}
          userHasOffer={!!userHasOffer}
          userId={user?.id ?? null}
        />
      </div>
    </div>
  );
}
