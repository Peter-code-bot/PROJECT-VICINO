"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { Star, MessageCircle, Send, Loader2, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface OfferData {
  id: string;
  seller_id: string;
  message_offer: string;
  price_offer: number | null;
  linked_product_id: string | null;
  created_at: string;
  profiles: {
    nombre: string;
    avatar_url: string | null;
    average_rating: number | null;
    reviews_count: number | null;
  };
}

interface OffersListProps {
  requestId: string;
  responses: OfferData[];
  isOwner: boolean;
  isOpen: boolean;
  userHasOffer: boolean;
  userId: string | null;
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

export function OffersList({
  requestId,
  responses,
  isOwner,
  isOpen,
  userHasOffer,
  userId,
}: OffersListProps) {
  const [showForm, setShowForm] = useState(false);
  const [message, setMessage] = useState("");
  const [price, setPrice] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [localResponses, setLocalResponses] = useState<OfferData[]>(responses);

  const handleSubmitOffer = async () => {
    if (!message.trim()) {
      setError("Escribe un mensaje con tu oferta");
      return;
    }

    setSubmitting(true);
    setError(null);

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setError("Inicia sesión para hacer una oferta");
      setSubmitting(false);
      return;
    }

    const { data: newResponse, error: insertError } = await supabase
      .from("request_responses")
      .insert({
        request_id: requestId,
        seller_id: user.id,
        message_offer: message.trim(),
        price_offer: price ? parseFloat(price) : null,
      })
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
      .single();

    if (insertError) {
      if (insertError.code === "23505") {
        setError("Ya enviaste una oferta para esta solicitud");
      } else {
        setError("Error al enviar la oferta. Intenta de nuevo.");
      }
      setSubmitting(false);
      return;
    }

    if (newResponse) {
      const mapped: OfferData = {
        ...newResponse,
        profiles: newResponse.profiles as unknown as OfferData["profiles"],
      };
      setLocalResponses((prev) => [...prev, mapped]);
    }

    setShowForm(false);
    setMessage("");
    setPrice("");
    setSubmitting(false);
  };

  return (
    <div className="space-y-4">
      {/* Offers list */}
      {localResponses.length === 0 ? (
        <div className="py-10 text-center">
          <p className="text-sm text-muted-foreground">
            Aún no hay ofertas. {isOpen ? "¡Sé el primero!" : ""}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {localResponses.map((offer) => (
            <div
              key={offer.id}
              className="rounded-2xl bg-card border border-border/50 p-4"
            >
              <div className="flex items-start gap-3">
                {/* Avatar */}
                <Link
                  href={`/vendedor/${offer.seller_id}`}
                  className="h-10 w-10 rounded-full bg-muted flex items-center justify-center overflow-hidden shrink-0"
                >
                  {offer.profiles.avatar_url ? (
                    <Image
                      src={offer.profiles.avatar_url}
                      alt={offer.profiles.nombre}
                      width={40}
                      height={40}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <User className="h-5 w-5 text-muted-foreground" />
                  )}
                </Link>

                <div className="flex-1 min-w-0">
                  {/* Seller name + rating */}
                  <div className="flex items-center gap-2">
                    <Link
                      href={`/vendedor/${offer.seller_id}`}
                      className="font-medium text-foreground text-sm hover:underline"
                    >
                      {offer.profiles.nombre}
                    </Link>
                    {offer.profiles.average_rating != null &&
                      offer.profiles.average_rating > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                          <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                          {offer.profiles.average_rating.toFixed(1)}
                        </span>
                      )}
                    <span className="text-xs text-muted-foreground ml-auto">
                      {timeAgo(offer.created_at)}
                    </span>
                  </div>

                  {/* Price offer */}
                  {offer.price_offer && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400 mt-1">
                      ${offer.price_offer.toLocaleString()} MXN
                    </span>
                  )}

                  {/* Message */}
                  <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
                    {offer.message_offer}
                  </p>

                  {/* Owner action: Accept + Chat */}
                  {isOwner && isOpen && (
                    <Link
                      href={`/chat?to=${offer.seller_id}`}
                      className="mt-3 inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      Aceptar y Chatear
                    </Link>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add offer button / form */}
      {isOpen && userId && !isOwner && !userHasOffer && (
        <>
          {!showForm ? (
            <button
              type="button"
              onClick={() => setShowForm(true)}
              className="w-full rounded-xl border border-border py-3 text-sm font-semibold text-foreground transition-colors hover:bg-muted flex items-center justify-center gap-2"
            >
              <Send className="h-4 w-4" />
              Agregar mi Oferta
            </button>
          ) : (
            <div className="rounded-2xl bg-card border border-border/50 p-4 space-y-3">
              <h4 className="font-medium text-foreground text-sm">
                Tu oferta
              </h4>

              {/* Price */}
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  $
                </span>
                <input
                  type="number"
                  inputMode="numeric"
                  value={price}
                  onChange={(e) => setPrice(e.target.value)}
                  placeholder="Precio (opcional)"
                  className="w-full rounded-xl bg-background border border-input pl-7 pr-16 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/20"
                />
                <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                  MXN
                </span>
              </div>

              {/* Message */}
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="Describe tu oferta..."
                rows={3}
                className="w-full rounded-xl bg-background border border-input px-3 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/20 resize-none"
              />

              {error && (
                <p className="text-xs text-destructive font-medium">{error}</p>
              )}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false);
                    setError(null);
                  }}
                  className="flex-1 rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={handleSubmitOffer}
                  disabled={submitting}
                  className="flex-1 rounded-xl bg-primary py-2.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  {submitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <>
                      <Send className="h-3.5 w-3.5" />
                      Enviar
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {/* Login prompt */}
      {isOpen && !userId && (
        <Link
          href="/login?next=/solicitudes"
          className="block w-full rounded-xl border border-border py-3 text-center text-sm font-semibold text-foreground transition-colors hover:bg-muted"
        >
          Inicia sesión para hacer una oferta
        </Link>
      )}
    </div>
  );
}
