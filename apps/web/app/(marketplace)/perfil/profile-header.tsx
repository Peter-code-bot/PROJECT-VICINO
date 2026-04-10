"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { SellerBadge } from "@/components/shared/seller-badge";
import { LogoutButton } from "@/components/shared/logout-button";
import type { TrustLevel } from "@vicino/shared";
import { Settings, Store, Star, ShoppingBag, Handshake, MapPin } from "lucide-react";

interface ProfileHeaderProps {
  profile: {
    nombre: string;
    email: string;
    foto: string | null;
    bio: string | null;
    user_id: string | null;
    ubicacion: string | null;
    es_vendedor: boolean;
    nombre_negocio: string | null;
    categoria_negocio: string | null;
    metodos_pago_aceptados: string | null;
    trust_level: string;
    trust_points: number;
    total_sales: number;
    average_rating_as_seller: number;
    average_rating_as_buyer: number;
    reviews_count_as_seller: number;
    reviews_count_as_buyer: number;
  } | null;
  productCount: number;
  purchaseCount: number;
}

export function ProfileHeader({ profile, productCount, purchaseCount }: ProfileHeaderProps) {
  const [showActions, setShowActions] = useState(false);

  if (!profile) return null;

  return (
    <div className="space-y-5 mb-6">
      {/* Top row: photo + stats */}
      <div className="flex items-start gap-5">
        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="w-20 h-20 sm:w-24 sm:h-24 rounded-full overflow-hidden border-2 border-border/40 bg-cream-dark dark:bg-neutral-800">
            {profile.foto ? (
              <Image src={profile.foto} alt={profile.nombre} width={96} height={96} className="object-cover w-full h-full" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-3xl">
                {profile.nombre?.charAt(0)?.toUpperCase() ?? "?"}
              </div>
            )}
          </div>
          <SellerBadge
            level={(profile.trust_level as TrustLevel) ?? "nuevo"}
            size="sm"
            showLabel={false}
          />
        </div>

        {/* Stats */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-heading font-bold text-xl truncate">{profile.nombre}</h1>
          </div>
          {profile.user_id && (
            <p className="text-xs text-muted-foreground mb-3">@{profile.user_id}</p>
          )}

          <div className="flex gap-5 text-center">
            <div>
              <p className="font-heading font-bold text-lg">{profile.total_sales}</p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Ventas</p>
            </div>
            <div>
              <p className="font-heading font-bold text-lg">{purchaseCount}</p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Compras</p>
            </div>
            <div>
              <p className="font-heading font-bold text-lg">{productCount}</p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Productos</p>
            </div>
            {Number(profile.average_rating_as_seller) > 0 && (
              <div>
                <p className="font-heading font-bold text-lg flex items-center gap-0.5">
                  <Star className="w-3.5 h-3.5 text-gold fill-gold" />
                  {Number(profile.average_rating_as_seller).toFixed(1)}
                </p>
                <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Rating</p>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bio */}
      {profile.bio && (
        <p className="text-sm leading-relaxed">{profile.bio}</p>
      )}

      {/* Location */}
      {profile.ubicacion && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <MapPin className="w-3 h-3" />
          {profile.ubicacion}
        </div>
      )}

      {/* Seller info */}
      {profile.es_vendedor && profile.nombre_negocio && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="inline-flex items-center gap-1.5 bg-terracotta/10 text-terracotta px-2.5 py-1 rounded-lg text-xs font-medium">
            <Store className="w-3 h-3" />
            {profile.nombre_negocio}
          </span>
          {profile.metodos_pago_aceptados?.split(",").map((m) => (
            <span
              key={m.trim()}
              className="bg-muted px-2 py-1 rounded-lg text-xs text-muted-foreground"
            >
              {m.trim()}
            </span>
          ))}
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        <Link
          href="/perfil/editar"
          className="flex-1 flex items-center justify-center gap-2 rounded-xl bg-charcoal dark:bg-neutral-800 text-white px-4 py-2.5 text-sm font-semibold hover:bg-charcoal-light transition-colors"
        >
          <Settings className="w-4 h-4" />
          Editar perfil
        </Link>
        {profile.es_vendedor && (
          <Link
            href="/seller"
            className="flex items-center justify-center gap-2 rounded-xl border border-border/50 px-4 py-2.5 text-sm font-semibold hover:bg-accent transition-colors"
          >
            <Handshake className="w-4 h-4" />
            Mi tienda
          </Link>
        )}
      </div>
    </div>
  );
}
