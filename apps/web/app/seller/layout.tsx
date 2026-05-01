import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SellerSidebar } from "@/components/layout/seller-sidebar";
import { SellerMobileDrawer } from "@/components/layout/seller-mobile-drawer";
import { SellerBadge } from "@/components/shared/seller-badge";
import type { TrustLevel } from "@vicino/shared";
import Link from "next/link";
import Image from "next/image";
import { Store } from "lucide-react";

export default async function SellerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/seller");

  const { data: profile } = await supabase
    .from("profiles")
    .select("nombre_negocio, nombre, trust_level")
    .eq("id", user.id)
    .single();

  const storeName =
    profile?.nombre_negocio ?? profile?.nombre ?? "Mi Tienda Local";

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 md:py-10 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div className="flex items-center gap-3 md:gap-4">
          <SellerMobileDrawer storeName={storeName} />
          <Link href="/" className="flex items-center gap-2 group">
            <Image
              src="/vicino-logo.png"
              alt="VICINO"
              width={40}
              height={40}
              className="shrink-0 group-hover:-translate-y-0.5 transition-transform"
              priority
            />
            <span className="font-heading font-bold text-xl leading-none hidden sm:block">
              VICINO
            </span>
          </Link>
          <span className="text-muted-foreground/40 font-light text-2xl hidden sm:block">/</span>

          <div className="flex items-center gap-3 bg-card px-4 py-2 rounded-2xl border border-border/50 shadow-sm">
            <div className="flex items-center gap-2">
              <Store className="w-4 h-4 text-primary" />
              <span className="font-semibold text-sm">{storeName}</span>
            </div>
            <div className="w-px h-4 bg-border/60" />
            <SellerBadge
              level={(profile?.trust_level as TrustLevel) ?? "nuevo"}
            />
          </div>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-8 lg:gap-12">
        {/* Sidebar — desktop only */}
        <aside className="hidden md:block w-full md:w-56 lg:w-64 shrink-0">
          <div className="sticky top-24">
            <SellerSidebar />
          </div>
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0 bg-transparent md:bg-card md:rounded-3xl md:border md:border-border/40 md:shadow-[0_8px_30px_rgb(26,26,46,0.04)] md:p-8 lg:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
