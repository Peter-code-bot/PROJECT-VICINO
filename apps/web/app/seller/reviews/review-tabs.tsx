"use client";

import { useState } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { RatingStars } from "@/components/shared/rating-stars";
import { formatDate } from "@vicino/shared";
import { RespondForm } from "./respond-form";

interface ReviewTabsProps {
  received: Array<{
    id: string;
    rating: number;
    comentario: string | null;
    respuesta: string | null;
    respuesta_fecha: string | null;
    created_at: string;
    profiles: { nombre: string } | { nombre: string }[] | null;
  }>;
  given: Array<{
    id: string;
    rating: number;
    comentario: string | null;
    created_at: string;
    profiles: { nombre: string } | { nombre: string }[] | null;
  }>;
  pending: Array<{
    id: string;
    products_services: { id: string; titulo: string } | { id: string; titulo: string }[] | null;
    buyer: { nombre: string } | { nombre: string }[] | null;
  }>;
  currentUserId: string;
}

export function ReviewTabs({ received, given, pending }: ReviewTabsProps) {
  const [tab, setTab] = useState<"received" | "given" | "pending">("received");

  const tabs = [
    { key: "received" as const, label: `Recibidas (${received.length})` },
    { key: "given" as const, label: `Dejadas (${given.length})` },
    { key: "pending" as const, label: `Pendientes (${pending.length})` },
  ];

  return (
    <div className="space-y-4">
      <div className="flex border-b">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors",
              tab === t.key
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "received" && (
        <div className="space-y-3">
          {received.length > 0 ? (
            received.map((r) => {
              const reviewer = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              return (
                <div key={r.id} className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm">{reviewer?.nombre ?? "Usuario"}</span>
                    <RatingStars rating={r.rating} size="sm" />
                    <span className="text-xs text-muted-foreground ml-auto">{formatDate(r.created_at)}</span>
                  </div>
                  {r.comentario && <p className="text-sm text-muted-foreground">{r.comentario}</p>}
                  {r.respuesta ? (
                    <div className="ml-4 pl-3 border-l text-sm">
                      <span className="font-medium">Tu respuesta:</span>{" "}
                      <span className="text-muted-foreground">{r.respuesta}</span>
                    </div>
                  ) : (
                    <RespondForm reviewId={r.id} />
                  )}
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">Sin reseñas recibidas</p>
          )}
        </div>
      )}

      {tab === "given" && (
        <div className="space-y-3">
          {given.length > 0 ? (
            given.map((r) => {
              const reviewed = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              return (
                <div key={r.id} className="rounded-lg border p-4 space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm">Para: <strong>{reviewed?.nombre ?? "Usuario"}</strong></span>
                    <RatingStars rating={r.rating} size="sm" />
                    <span className="text-xs text-muted-foreground ml-auto">{formatDate(r.created_at)}</span>
                  </div>
                  {r.comentario && <p className="text-sm text-muted-foreground">{r.comentario}</p>}
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">Sin reseñas dejadas</p>
          )}
        </div>
      )}

      {tab === "pending" && (
        <div className="space-y-3">
          {pending.length > 0 ? (
            pending.map((s) => {
              const product = Array.isArray(s.products_services) ? s.products_services[0] : s.products_services;
              const buyer = Array.isArray(s.buyer) ? s.buyer[0] : s.buyer;
              return (
                <div key={s.id} className="rounded-lg border p-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{product?.titulo ?? "Producto"}</p>
                    <p className="text-xs text-muted-foreground">Comprador: {buyer?.nombre ?? "Usuario"}</p>
                  </div>
                  <Link
                    href={`/historial/review?sale=${s.id}&type=seller_to_buyer&product=${product?.id ?? ""}`}
                    className="text-xs font-medium text-primary hover:underline"
                  >
                    Evaluar →
                  </Link>
                </div>
              );
            })
          ) : (
            <p className="text-sm text-muted-foreground py-8 text-center">Sin reseñas pendientes</p>
          )}
        </div>
      )}
    </div>
  );
}
