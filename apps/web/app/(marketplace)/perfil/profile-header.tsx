"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Settings, Star, ShoppingBag, Handshake, MapPin, MessageCircle } from "lucide-react";
import { AvatarWithUpload } from "@/components/profile/avatar-with-upload";
import { ChipCategoria } from "@/components/profile/chip-categoria";
import { TrustProgressBadge } from "@/components/profile/trust-progress-badge";
import { PaymentMethodsBadge } from "@/components/profile/payment-methods-badge";
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
    username?: string | null;
    ubicacion: string | null;
    // Las columnas de aqui abajo admiten nulo en `profiles`. Casi todas tienen
    // DEFAULT, asi que en la practica nunca llegan nulas, pero el tipo no puede
    // afirmar lo que la base no garantiza. No hay que tocar el render: las que
    // se pintan ya se leian tras un guard (created_at, is_verified, es_vendedor)
    // o con respaldo (trust_level, trust_points, average_rating), y total_sales
    // y reviews_count no se pintan aqui. Lo unico que mentia era el tipo.
    es_vendedor: boolean | null;
    seller_type: string | null;
    nombre_negocio: string | null;
    categoria_negocio: string | null;
    metodos_pago_aceptados: string | null;
    trust_level: string | null;
    trust_points: number | null;
    total_sales: number | null;
    average_rating: number | null;
    reviews_count: number | null;
    is_verified: boolean | null;
    created_at: string | null;
  } | null;
  productCount: ReactNode;
  purchaseCount: number;
  isPublic?: boolean;
  /** Id del usuario autenticado. Se usa para esconder el botón de reportar
   *  cuando el perfil mostrado es el del propio usuario. */
  currentUserId?: string | null;
  isFollowing?: boolean;
  followersCount?: ReactNode;
  followingCount?: ReactNode;
}

export function ProfileHeader({ 
  profile, 
  productCount, 
  purchaseCount = 0, 
  isPublic = false, 
  currentUserId = null, 
  isFollowing = false,
  followersCount = 0,
  followingCount = 0,
}: ProfileHeaderProps) {

  const displayName = profile
    ? profile.es_vendedor && profile.seller_type === "business" && profile.nombre_negocio
      ? profile.nombre_negocio
      : (profile.nombre?.trim().split(" ")[0] ?? profile.nombre)
    : "";

  if (!profile) {
    return (
      <div className="py-8 text-center text-sm text-[color:var(--fg-muted)]">
        No se pudo cargar el perfil.
      </div>
    );
  }

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
        </div>

        {/* Stats & Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="min-w-0 flex-1">
              {profile.es_vendedor && profile.seller_type === "business" && profile.nombre_negocio ? (
                <>
                  <h1 className="font-heading font-bold text-xl truncate">{profile.nombre_negocio}</h1>
                  {profile.username && (
                    <p className="text-xs text-muted-foreground">@{profile.username}</p>
                  )}
                </>
              ) : (
                <>
                  <h1 className="font-heading font-bold text-xl truncate">{profile.nombre}</h1>
                  {profile.username && (
                    <p className="text-xs text-muted-foreground">@{profile.username}</p>
                  )}
                </>
              )}
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <TrustProgressBadge
                profile={profile}
                displayName={displayName}
                createdAt={profile.created_at}
              />
              {profile.es_vendedor && (
                <PaymentMethodsBadge
                  metodosPagoAceptados={profile.metodos_pago_aceptados}
                  displayName={displayName}
                />
              )}
            </div>
          </div>

          {/* Stats — Fila Compacta */}
          <div className="w-full">


            {/* Fila de stats */}
            <div className="flex w-full text-center py-1">

              {/* Productos */}
              <div className="flex-1 flex flex-col items-center gap-1">
                <p className="font-heading font-bold text-[13px] sm:text-[15px] leading-none text-foreground">
                  {productCount}
                </p>
                <p className="text-[9px] font-semibold uppercase tracking-[0.5px] text-muted-foreground leading-none">
                  Productos
                </p>
              </div>

              {/* Seguidores — solo si es vendedor */}
              {profile.es_vendedor && (
                <div className="flex-1 flex flex-col items-center gap-1 border-l border-white/[0.07]">
                  <p className="font-heading font-bold text-[13px] sm:text-[15px] leading-none text-foreground">
                    {followersCount}
                  </p>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.5px] text-muted-foreground leading-none">
                    Seguidores
                  </p>
                </div>
              )}

              {/* Siguiendo */}
              <div className="flex-1 flex flex-col items-center gap-1 border-l border-white/[0.07]">
                <p className="font-heading font-bold text-[13px] sm:text-[15px] leading-none text-foreground">
                  {followingCount}
                </p>
                <p className="text-[9px] font-semibold uppercase tracking-[0.5px] text-muted-foreground leading-none">
                  Siguiendo
                </p>
              </div>

              {/* Rating — solo si tiene calificaciones */}
              {Number(profile.average_rating) > 0 && (
                <div className="flex-1 flex flex-col items-center gap-1 border-l border-white/[0.07]">
                  <p className="font-heading font-bold text-[13px] sm:text-[15px] leading-none text-foreground flex items-center gap-0.5">
                    <Star className="w-3 h-3 text-gold fill-gold" />
                    {Number(profile.average_rating).toFixed(1)}
                  </p>
                  <p className="text-[9px] font-semibold uppercase tracking-[0.5px] text-muted-foreground leading-none">
                    Rating
                  </p>
                </div>
              )}

            </div>


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
      {/* La fila NO puede colgar de nombre_negocio, que es lo que hacia antes.
          Esa columna solo se escribe para el vendedor de tipo "business" (el
          RPC activar_modo_vendedor la mete en un CASE WHEN), mientras que
          categoria_negocio se escribe SIEMPRE, porque elegir categoria es el
          primer paso del alta y es obligatorio. Colgar la fila del nombre
          dejaba sin ver su categoria justo al vendedor casual, que es el tipo
          preseleccionado — y el alta le promete lo contrario por escrito:
          "Tu categoria se ve en tu perfil". Cada chip decide por su cuenta;
          los dos componentes devuelven null cuando no tienen dato. */}
      {profile.es_vendedor && profile.categoria_negocio && (
        <div className="flex flex-wrap items-center gap-2">
          <ChipCategoria categoria={profile.categoria_negocio} />
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
              "inline-flex flex-1 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-all hover:opacity-90",
              currentUserId && currentUserId !== profile.id && profile.es_vendedor
                ? "bg-[color:var(--sidebar-bg)] text-[color:var(--fg)]"
                : "bg-[color:var(--fg)] text-[color:var(--bg)] shadow-sm"
            )}
          >
            <MessageCircle className="w-4 h-4" />
            {currentUserId && currentUserId !== profile.id && profile.es_vendedor
              ? "Mensaje"
              : "Contactar"}
          </Link>
          {currentUserId && currentUserId !== profile.id && (
            <ReportMenuButton
              targetType="user"
              targetId={profile.id}
              targetLabel={profile.nombre_negocio ?? profile.nombre}
              blockableUserId={profile.id}
              ariaLabel="Reportar o bloquear usuario"
              className="inline-flex h-[42px] w-[42px] items-center justify-center rounded-xl bg-[color:var(--sidebar-bg)] text-[color:var(--fg-muted)] transition-colors hover:text-[color:var(--fg)] hover:opacity-90 shrink-0"
            />
          )}
        </div>
      ) : (
        <div className="flex gap-2">
          <Link
            href="/perfil/editar"
            className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-[color:var(--fg)] px-4 py-2.5 text-sm font-semibold text-[color:var(--bg)] shadow-sm transition-all hover:opacity-90"
          >
            <Settings className="w-4 h-4" />
            Editar perfil
          </Link>
          {profile.es_vendedor && (
            <Link
              href="/seller"
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[color:var(--sidebar-bg)] px-4 py-2.5 text-sm font-semibold text-[color:var(--fg)] transition-colors hover:opacity-90"
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
