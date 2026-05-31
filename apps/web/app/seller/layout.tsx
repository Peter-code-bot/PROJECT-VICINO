import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SellerSidebar } from "@/components/layout/seller-sidebar";
import { SellerMobileDrawer } from "@/components/layout/seller-mobile-drawer";
import { SellerBadge } from "@/components/shared/seller-badge";
import type { TrustLevel } from "@vicino/shared";
import Link from "next/link";
import { Store, Home } from "lucide-react";

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
    .select("nombre_negocio, nombre, trust_level, es_vendedor")
    .eq("id", user.id)
    .single();

  // Phase 9 defense-in-depth: middleware already gates this route on
  // es_vendedor, but the layout-level redirect is a backstop in case
  // middleware is bypassed (e.g., direct server-side render in dev).
  if (!profile?.es_vendedor) {
    redirect("/perfil/editar?prompt=seller-mode");
  }

  const storeName =
    profile?.nombre_negocio ?? profile?.nombre ?? "Mi Tienda Local";

  return (
    <div className="max-w-7xl mx-auto px-5 sm:px-6 lg:px-8 py-8 md:py-10 animate-fade-in">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8 min-w-0">
        <div className="flex items-center gap-3 md:gap-4 min-w-0">
          <div className="shrink-0 flex items-center">
            <SellerMobileDrawer storeName={storeName} />
          </div>
          <Link 
            href="/" 
            className="flex items-center gap-2 group p-2 -ml-2 rounded-xl hover:bg-card/50 transition-colors shrink-0"
            title="Volver al Inicio"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card border border-border/50 group-hover:border-border transition-colors">
              <Home className="w-5 h-5 text-fg" />
            </div>
            <span className="font-heading font-bold text-xl leading-none hidden sm:block text-fg">
              Inicio
            </span>
          </Link>
          <span className="text-muted-foreground/40 font-light text-2xl hidden sm:block shrink-0">/</span>

          <div className="flex items-center gap-2 sm:gap-3 bg-card px-3 sm:px-4 py-2 rounded-2xl border border-border/50 shadow-sm min-w-0 flex-1 sm:flex-none overflow-hidden">
            <div className="flex items-center gap-2 min-w-0 flex-1">
              <Store className="w-4 h-4 text-primary shrink-0" />
              <span className="font-semibold text-sm truncate">{storeName}</span>
            </div>
            <div className="hidden sm:block w-px h-4 bg-border/60 shrink-0" />
            <div className="shrink-0 flex items-center">
              <SellerBadge
                level={(profile?.trust_level as TrustLevel) ?? "nuevo"}
                showLabel={false}
                className="sm:hidden"
              />
              <SellerBadge
                level={(profile?.trust_level as TrustLevel) ?? "nuevo"}
                className="hidden sm:inline-flex"
              />
            </div>
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
        <main className="flex-1 min-w-0 overflow-x-clip min-h-[calc(100vh-14rem)] bg-transparent md:bg-card md:rounded-3xl md:border md:border-border/40 md:shadow-[0_8px_30px_rgb(26,26,46,0.04)] md:p-8 lg:p-10">
          {children}
        </main>
      </div>
    </div>
  );
}
