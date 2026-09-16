"use client";
import type { ComponentProps } from "react";
import { InvitacionVendedor } from "./invitacion-vendedor";
import { ProfileHeader } from "./profile-header";
import { ProfileTabs, ProfileProducts, ProfileReviews, type ProfileTabsProps } from "./profile-tabs";
import { AccountMenuDrawer } from "@/components/profile/account-menu-drawer";
import { Menu, Pencil } from "lucide-react";
import Link from "next/link";

import { SessionScroll, DataRetry, useSessionData } from "@/components/layout/session-data-provider";
export function ProfileSession() {
  const core = useSessionData<NonNullable<ComponentProps<typeof ProfileHeader>["profile"]> & { alta_vendedor_paso: string | null }>("/api/session/profile?part=core");
  const products = useSessionData<ProfileTabsProps["products"]>("/api/session/profile?part=products");
  const reviews = useSessionData<Pick<ProfileTabsProps, "reviewsAsSeller" | "reviewsAsBuyer">>("/api/session/profile?part=reviews");
  const counts = useSessionData<{ followers: number; following: number }>("/api/session/profile?part=counts");
  const profile = core.data;
  const userId = core.userId;
  if (!profile) return <div className="max-w-3xl mx-auto px-4 py-6">{core.error ? <DataRetry error={core.error} retry={core.retry} /> : <p role="status">Cargando perfil…</p>}</div>;
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
        productCount={products.data?.length ?? "…"}
        purchaseCount={0}
        followersCount={counts.data?.followers ?? "…"}
        followingCount={counts.data?.following ?? "…"}
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
        productsPanel={<><DataRetry error={products.error} retry={products.retry} />{products.data ? <ProfileProducts products={products.data} isVendedor={profile?.es_vendedor ?? false} /> : <p role="status">Cargando publicaciones…</p>}</>}
        reviewsPanel={<><DataRetry error={reviews.error} retry={reviews.retry} />{reviews.data ? <ProfileReviews {...reviews.data} currentUserId={userId} /> : <p role="status">Cargando reseñas…</p>}</>}
        isVendedor={profile?.es_vendedor ?? false}
        currentUserId={userId}
      />
    </div>
  );
}

