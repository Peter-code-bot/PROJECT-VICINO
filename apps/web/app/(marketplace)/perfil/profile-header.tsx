"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { SellerBadge } from "@/components/shared/seller-badge";
import type { TrustLevel } from "@vicino/shared";
import { Settings, Store, Star, ShoppingBag, Handshake, MapPin, MessageCircle, BadgeCheck, Calendar } from "lucide-react";
import { AvatarWithUpload } from "@/components/profile/avatar-with-upload";
import { TRUST_LEVELS } from "@vicino/shared";
import { ReportMenuButton } from "@/components/moderation/report-menu-button";
import { FollowButton } from "@/components/shared/follow-button";
import { cn } from "@/lib/utils";
interface ProfileHeaderProps {
  profile: {
    id: string;
    nombre: string;
    email: string;
    foto: string | null;
    bio: string | null;
    user_id: string | null;
    ubicacion: string | null;
    es_vendedor: boolean;
    seller_type: string | null;
    nombre_negocio: string | null;
    categoria_negocio: string | null;
    metodos_pago_aceptados: string | null;
    trust_level: string;
    trust_points: number;
    total_sales: number;
    average_rating: number;
    reviews_count: number;
    is_verified: boolean;
    created_at: string;
  } | null;
  productCount: number;
  purchaseCount: number;
  isPublic?: boolean;
  /** Id del usuario autenticado. Se usa para esconder el botón de reportar
   *  cuando el perfil mostrado es el del propio usuario. */
  currentUserId?: string | null;
  isFollowing?: boolean;
}

export function ProfileHeader({ profile, productCount, purchaseCount, isPublic, currentUserId, isFollowing }: ProfileHeaderProps) {
  const [showActions, setShowActions] = useState(false);

  if (!profile) return null;

  return (
    <div className="space-y-5 mb-6">
      {/* Top row: photo + stats */}
      <div className="flex items-start gap-5">
        {/* Avatar with upload */}
        <div className="relative">
          <AvatarWithUpload
            userId={profile.id}
            currentAvatarUrl={profile.foto}
            displayName={profile.nombre}
            isOwnProfile={!isPublic}
          />
          <div className="absolute -bottom-1 -left-1">
            <SellerBadge
              level={(profile.trust_level as TrustLevel) ?? "nuevo"}
              size="sm"
              showLabel={false}
            />
          </div>
        </div>

        {/* Stats */}
        <div className="flex-1 min-w-0">
          {profile.es_vendedor && profile.seller_type === "business" && profile.nombre_negocio ? (
            <>
              <h1 className="font-heading font-bold text-xl truncate">{profile.nombre_negocio}</h1>
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-3">
                <Store className="w-3 h-3" />
                <span>{profile.nombre}</span>
                {profile.user_id && <span>· @{profile.user_id}</span>}
              </div>
            </>
          ) : (
            <>
              <h1 className="font-heading font-bold text-xl truncate">{profile.nombre}</h1>
              {profile.user_id && (
                <p className="text-xs text-muted-foreground mb-3">@{profile.user_id}</p>
              )}
            </>
          )}

          <div className="flex gap-5 text-center">
            <div>
              <p className="font-heading font-bold text-sm">{profile.total_sales}</p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Ventas</p>
            </div>
            <div>
              <p className="font-heading font-bold text-sm">{purchaseCount}</p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Compras</p>
            </div>
            <div>
              <p className="font-heading font-bold text-sm">{productCount}</p>
              <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-wide">Productos</p>
            </div>
            {Number(profile.average_rating) > 0 && (
              <div>
                <p className="font-heading font-bold text-sm flex items-center gap-0.5">
                  <Star className="w-3.5 h-3.5 text-gold fill-gold" />
                  {Number(profile.average_rating).toFixed(1)}
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

      {/* Member since */}
      {profile.created_at && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="w-3 h-3" />
          Miembro desde {new Date(profile.created_at).toLocaleDateString("es-MX", { month: "long", year: "numeric" })}
        </div>
      )}

      {/* Trust level + Verified badge */}
      <div className="space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <SellerBadge level={(profile.trust_level as TrustLevel) ?? "nuevo"} showLabel size="md" />
          {profile.is_verified && (
            <span className="inline-flex items-center gap-1 rounded-full bg-[color:var(--brand-tint-strong)] px-2.5 py-1 text-xs font-medium text-[color:var(--trust-emerald)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
              <BadgeCheck className="w-3.5 h-3.5" />
              Verificado
            </span>
          )}
        </div>
        {(() => {
          const points = profile.trust_points ?? 0;
          const sorted = Object.entries(TRUST_LEVELS).sort((a, b) => a[1].minPoints - b[1].minPoints);
          const next = sorted.find(([, v]) => v.minPoints > points);
          const current = sorted.filter(([, v]) => v.minPoints <= points).pop();
          const currentMin = current ? current[1].minPoints : 0;
          const nextMin = next ? next[1].minPoints : points;
          const progress = next ? Math.min(100, ((points - currentMin) / (nextMin - currentMin)) * 100) : 100;
          return (
            <div className="space-y-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-[color:var(--bg-elev-2)] shadow-[inset_0_0_0_1px_var(--border)]">
                <div
                  className="h-full rounded-full bg-[color:var(--brand)] shadow-[var(--shadow-glow)] transition-all"
                  style={{ width: `${Math.max(5, progress)}%` }}
                />
              </div>
              <div className="flex justify-between text-[10px] text-[color:var(--fg-dim)]">
                <span className="font-semibold text-[color:var(--fg)]">{points} pts</span>
                {next ? (
                  <span>{next[1].minPoints - points} pts para <span className="text-[color:var(--brand-hi)]">{next[1].label}</span></span>
                ) : (
                  <span className="text-[color:var(--trust-gold)]">Nivel máximo</span>
                )}
              </div>
            </div>
          );
        })()}
      </div>

      {/* Seller info */}
      {profile.es_vendedor && profile.nombre_negocio && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-[color:var(--brand-tint-strong)] px-2.5 py-1 text-xs font-medium text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
            <Store className="w-3 h-3" />
            {profile.nombre_negocio}
          </span>
          {profile.metodos_pago_aceptados?.split(",").map((m) => (
            <span
              key={m.trim()}
              className="rounded-lg bg-[color:var(--card-2)] px-2 py-1 text-xs text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)]"
            >
              {m.trim()}
            </span>
          ))}
        </div>
      )}

      {/* Action buttons */}
      {isPublic ? (
        <div className="flex items-center gap-2">
          {currentUserId && currentUserId !== profile.id && profile.es_vendedor && (
            <FollowButton storeId={profile.id} following={isFollowing ?? false} />
          )}
          <Link
            href={`/chat?seller=${profile.id}`}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all",
              currentUserId && currentUserId !== profile.id && profile.es_vendedor
                ? "bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] hover:bg-[color:var(--bg-elev-2)]"
                : "bg-[color:var(--brand)] text-white shadow-[var(--shadow-glow)] hover:bg-[color:var(--brand-dark)]"
            )}
          >
            <MessageCircle className="w-4 h-4" />
            {currentUserId && currentUserId !== profile.id && profile.es_vendedor
              ? isFollowing
                ? "💬"
                : "Mensaje"
              : "Contactar"}
          </Link>
          {currentUserId && currentUserId !== profile.id && (
            <ReportMenuButton
              targetType="user"
              targetId={profile.id}
              targetLabel={profile.nombre_negocio ?? profile.nombre}
              blockableUserId={profile.id}
              ariaLabel="Reportar o bloquear usuario"
              className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-[color:var(--card-2)] text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:text-[color:var(--fg)] shrink-0"
            />
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Link
            href="/perfil/editar"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[color:var(--brand)] px-4 py-2.5 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)]"
          >
            <Settings className="w-4 h-4" />
            Editar perfil
          </Link>
          {profile.es_vendedor && (
            <Link
              href="/seller"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[color:var(--card-2)] px-4 py-2.5 text-sm font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            >
              <Handshake className="w-4 h-4" />
              Mi tienda
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
