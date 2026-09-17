import { notFound } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase/server";
import { ArrowLeft, Clock, MessageSquare } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
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

/**
 * Etiquetas de categoria de la solicitud.
 *
 * El fondo opaco y la sombra son suyos y no heredados: la etiqueta se apoya
 * sobre la foto que subio el comprador, y una foto clara (un plato en un mantel
 * blanco es el caso tipico aqui) dejaria el texto ilegible si dependiera del
 * contraste de la imagen.
 */
function EtiquetasCategoria({
  categorias,
}: {
  categorias: ReadonlyArray<{ slug: string; nombre: string }>;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-1.5">
      {categorias.map((cat) => (
        <span
          key={cat.slug}
          className="inline-flex px-2.5 py-1 rounded-lg product-card-tab font-heading font-extrabold text-[9.5px] tracking-[1.4px] uppercase shadow-[0_4px_14px_rgba(0,0,0,0.45)]"
        >
          {cat.nombre}
        </span>
      ))}
    </div>
  );
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
        avatar_url:foto
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
        avatar_url:foto,
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
    .map((c) => c.categories)
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
            {/* created_at admite NULL en la base. Sin fecha no se pinta la
                linea: formatRelativeTime sobre un nulo daria "Invalid Date"
                justo debajo del nombre del comprador. */}
            {request.created_at && (
              <p className="text-xs text-muted-foreground">
                {formatRelativeTime(request.created_at)}
              </p>
            )}
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

        {/* Imagen con la categoria montada en su esquina inferior derecha.
            El recorte (overflow-hidden) vive en la caja de la imagen y no en
            este contenedor: si este recortara, se comeria justo el trozo de
            etiqueta que sobresale por abajo. */}
        {request.image_url ? (
          <div className="relative mb-6">
            <div className="relative w-full aspect-video rounded-2xl overflow-hidden">
              <Image
                src={request.image_url}
                alt={request.title}
                fill
                className="object-cover"
                sizes="(max-width: 768px) 100vw, 672px"
              />
            </div>
            {catList.length > 0 && (
              <div className="absolute -bottom-2.5 right-3 max-w-[calc(100%-1.5rem)]">
                <EtiquetasCategoria categorias={catList} />
              </div>
            )}
          </div>
        ) : (
          catList.length > 0 && (
            // Sin foto no hay esquina sobre la que apoyarse: la etiqueta se
            // queda alineada a la derecha en el mismo sitio del flujo, en vez
            // de posicionarse sobre una caja que no existe.
            <div className="mb-4">
              <EtiquetasCategoria categorias={catList} />
            </div>
          )
        )}

        {/* Presupuesto como texto y en el color principal, no como chip. Un
            cero no es un presupuesto: se pintaria "$0 MXN" cuando lo que pasa
            es que el comprador no puso cifra. El locale va explicito porque
            sin el lo elige el ICU del servidor, que no tiene por que agrupar
            los miles como se espera en Mexico. */}
        {typeof request.budget_estimated === "number" &&
          request.budget_estimated > 0 && (
            <p className="mb-6 font-heading text-base font-semibold text-foreground">
              Presupuesto:{" "}
              <span className="font-bold">
                ${request.budget_estimated.toLocaleString("es-MX")} MXN
              </span>
            </p>
          )}

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
