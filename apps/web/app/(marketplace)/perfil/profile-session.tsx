"use client";
import type { ComponentProps } from "react";
import { InvitacionVendedor } from "./invitacion-vendedor";
import { ProfileHeader } from "./profile-header";
import { ProfileTabs, ProfileProducts, ProfileReviews, type ProfileTabsProps } from "./profile-tabs";
import { AccountMenuDrawer } from "@/components/profile/account-menu-drawer";
import { SkeletonPerfil } from "@/components/shared/loading-skeletons";
import { Menu, Pencil } from "lucide-react";
import Link from "next/link";

import { SessionScroll, DataRetry, useSessionData, type SessionSeed } from "@/components/layout/session-data-provider";

/** Cabecera del perfil propio mas el paso del alta de vendedor, que decide la invitacion. */
export type ProfileCoreData = NonNullable<ComponentProps<typeof ProfileHeader>["profile"]> & { alta_vendedor_paso: string | null };
export type ProfileProductsData = ProfileTabsProps["products"];
export type ProfileReviewsData = Pick<ProfileTabsProps, "reviewsAsSeller" | "reviewsAsBuyer">;
export interface ProfileCountsData { followers: number; following: number }

/**
 * Lo que trajo el render del servidor, parte por parte. Cada una es opcional
 * porque page.tsx solo siembra las que cargaron: una parte caida se pide a la
 * memoria de sesion como antes, con su reintento en linea. Sin semillas
 * (loading.tsx) todo sale de la memoria. Solo datos: viaja como prop desde un
 * Server Component.
 */
export interface ProfileSessionSeeds {
  core?: SessionSeed<ProfileCoreData>;
  products?: SessionSeed<ProfileProductsData>;
  reviews?: SessionSeed<ProfileReviewsData>;
  counts?: SessionSeed<ProfileCountsData>;
}

export interface ProfileSessionProps { seeds?: ProfileSessionSeeds }

/**
 * Un dato que aun no esta: puntos suspensivos mientras viene, y un reintento
 * si fallo. Sin el segundo caso, un conteo caido se quedaba en «…» para
 * siempre y no habia forma de volver a pedirlo desde ahi.
 */
function EnEspera({ dato, label }: { dato: { error?: string; retry: () => void }; label: string }) {
  if (!dato.error) return <span aria-label={`Cargando ${label}`}>…</span>;
  return (
    <button
      type="button"
      onClick={() => void dato.retry()}
      aria-label={`Reintentar ${label}`}
      className="text-sm font-semibold text-brand"
    >
      —
    </button>
  );
}

export function ProfileSession({ seeds }: ProfileSessionProps) {
  const core = useSessionData<ProfileCoreData>("/api/session/profile?part=core", seeds?.core);
  const products = useSessionData<ProfileProductsData>("/api/session/profile?part=products", seeds?.products);
  const reviews = useSessionData<ProfileReviewsData>("/api/session/profile?part=reviews", seeds?.reviews);
  const counts = useSessionData<ProfileCountsData>("/api/session/profile?part=counts", seeds?.counts);
  const profile = core.data;
  const userId = core.userId;
  if (!profile) {
    if (core.error) return <div className="max-w-3xl mx-auto px-4 py-6"><DataRetry error={core.error} retry={core.retry} /></div>;
    // El esqueleto ya trae su px-4 pt-4; el pt-2 de fuera lo deja a la misma
    // altura (24px) y al mismo ancho que el px-4 py-6 del perfil real, para
    // que el cambio de esqueleto a datos no mueva nada.
    return <div className="max-w-3xl mx-auto pt-2"><SkeletonPerfil /></div>;
  }
  return (
    <div data-navigation-kind="profile" data-navigation-ready={`profile:${userId}:${core.updatedAt}`} className="max-w-3xl mx-auto px-4 py-6 pb-24 md:pb-8">
      <SessionScroll route="/perfil" />
      <DataRetry error={core.error ?? counts.error} retry={() => { void core.retry(); void counts.retry(); }} />
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
          username={profile?.username}
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
        productCount={products.data?.length ?? <EnEspera dato={products} label="publicaciones" />}
        purchaseCount={0}
        followersCount={counts.data?.followers ?? <EnEspera dato={counts} label="seguidores" />}
        followingCount={counts.data?.following ?? <EnEspera dato={counts} label="siguiendo" />}
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
        key={userId}
        products={[]}
        reviewsAsSeller={[]}
        reviewsAsBuyer={[]}
        reviewCount={reviews.data ? reviews.data.reviewsAsSeller.length + reviews.data.reviewsAsBuyer.length : "…"}
        productsPanel={<><DataRetry error={products.error} retry={products.retry} />{products.data ? <ProfileProducts products={products.data} isVendedor={profile?.es_vendedor ?? false} /> : <p role="status" className="min-h-32 py-6 text-sm text-fg-muted">Cargando publicaciones…</p>}</>}
        reviewsPanel={<><DataRetry error={reviews.error} retry={reviews.retry} />{reviews.data ? <ProfileReviews {...reviews.data} currentUserId={userId} /> : <p role="status" className="min-h-32 py-6 text-sm text-fg-muted">Cargando reseñas…</p>}</>}
        isVendedor={profile?.es_vendedor ?? false}
        currentUserId={userId}
      />
    </div>
  );
}
