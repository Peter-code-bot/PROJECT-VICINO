"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useSessionUI } from "@/components/layout/session-data-provider";
import { useRequestReturnScroll } from "@/hooks/use-request-return-scroll";
import { readRequestCollection, requestCollectionURL } from "@/lib/solicitudes/request-navigation";
import { createClient } from "@/lib/supabase/client";
import { RequestCard } from "./request-card";
import { RequestCarousel } from "./request-rows";
import { CreateRequestDrawer } from "./create-request-drawer";
import { FiltroCategoriasDrawer } from "@/components/shared/filtro-categorias-drawer";
import { useRequestPage, type RequestZone } from "@/hooks/use-request-page";
import { CATEGORIES } from "@vicino/shared";
import { Plus, Inbox, ArrowLeft } from "lucide-react";

type Category = { slug: string; nombre: string };
interface SolicitudesFeedProps { userLat: number | null; userLng: number | null; radiusMeters: number; userId: string | null }

function Retry({ onRetry }: { onRetry: () => void }) {
  return <div role="alert" className="py-6 text-sm text-fg"><p>No pudimos cargar las solicitudes.</p><button type="button" className="mt-2 min-h-10 underline underline-offset-4" onClick={onRetry}>Reintentar</button></div>;
}
function Skeleton() {
  return <div className="flex gap-3 overflow-hidden" aria-label="Cargando solicitudes" aria-busy="true">{[1,2,3].map(i => <div key={i} className="h-80 w-40 shrink-0 animate-pulse rounded-2xl bg-bg-elev-2 sm:w-48" />)}</div>;
}
function CategoryRow({ zone, category, onViewMore, onNavigate }: { zone: RequestZone; category: Category | null; onViewMore: () => void; onNavigate: () => void }) {
  const page = useRequestPage(zone, category?.slug ?? null);
  return <section>
    <div className="mb-3 flex items-center justify-between gap-3"><h2 className="font-heading text-base font-bold text-fg">{category?.nombre ?? "Recientes"}</h2><button type="button" onClick={onViewMore} className="min-h-10 px-2 text-sm font-medium underline underline-offset-4">Ver más<span className="sr-only"> {category?.nombre ?? "solicitudes recientes"}</span></button></div>
    {page.loading ? <Skeleton /> : page.error ? <Retry onRetry={page.retry} /> : page.requests.length ? <RequestCarousel requests={page.requests} category={category ?? undefined} scope={zone.cacheScope} onNavigate={onNavigate} /> : <p className="py-4 text-sm text-fg-muted">No hay solicitudes vigentes en esta categoría.</p>}
  </section>;
}
function RequestOverview({ zone, onViewMore }: { zone: RequestZone; onViewMore: (category: Category | null) => void }) {
  const saveY = useRequestReturnScroll(`${zone.cacheScope}:overview`);
  const [categories, setCategories] = useState<Category[]>([]);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");
  const [retry, setRetry] = useState(0);
  const { lat, lng, radius } = zone;
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data, error } = await createClient().rpc("nearby_request_categories", { user_lat: lat, user_lng: lng, radius_meters: Math.max(1000, Math.min(50000,radius)) });
        if (cancelled) return;
        if (error || !data) { setState("error"); return; }
        setCategories(data); setState("ready");
      } catch { if (!cancelled) setState("error"); }
    })();
    return () => { cancelled = true; };
  }, [lat,lng,radius,retry]);
  return <div className="space-y-6">
    <CategoryRow zone={zone} category={null} onViewMore={() => { saveY(); onViewMore(null); }} onNavigate={saveY} />
    {state === "loading" && <Skeleton />}
    {state === "error" && <Retry onRetry={() => { setState("loading"); setRetry(value => value+1); }} />}
    {state === "ready" && categories.map(category => <CategoryRow key={category.slug} zone={zone} category={category} onViewMore={() => { saveY(); onViewMore(category); }} onNavigate={saveY} />)}
  </div>;
}
function RequestCollection({ zone, category, onBack, fresh }: { zone: RequestZone; category: Category | null; onBack: () => void; fresh: boolean }) {
  const page = useRequestPage(zone, category?.slug ?? null);
  const saveY = useRequestReturnScroll(`${zone.cacheScope}:collection:${category?.slug ?? "all"}`, fresh);
  return <section>
    <button type="button" onClick={onBack} className="mb-3 flex min-h-11 items-center gap-2 text-sm"><ArrowLeft className="h-4 w-4" />Volver a las categorías</button>
    <h2 className="mb-4 font-heading text-xl font-bold">{category?.nombre ?? "Solicitudes recientes"}</h2>
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">{page.requests.map(request => <RequestCard key={request.id} data={request} category={category ?? undefined} onNavigate={saveY} />)}</div>
    {page.loading && <Skeleton />}
    {page.error && <Retry onRetry={page.retry} />}
    {!page.loading && !page.error && !page.requests.length && <div className="py-12 text-center text-sm text-fg-muted"><Inbox className="mx-auto mb-3 h-7 w-7" />No hay solicitudes vigentes cerca de ti.</div>}
    {!page.error && page.hasMore && <button type="button" disabled={page.loading} onClick={page.loadMore} className="mt-4 min-h-11 w-full rounded-xl border border-border px-4 py-2 text-sm disabled:opacity-50">{page.loading ? "Cargando…" : "Cargar más solicitudes"}</button>}
  </section>;
}

export function SolicitudesFeed({ userLat, userLng, radiusMeters, userId }: SolicitudesFeedProps) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const collection = readRequestCollection(new URLSearchParams(search.toString()));
  const [freshCollection, setFreshCollection] = useState(false);
  const openCollection = (category: Category | null) => { setFreshCollection(true); router.push(requestCollectionURL(pathname, new URLSearchParams(search.toString()), category?.slug ?? null), { scroll: false }); };
  const closeCollection = () => router.push(requestCollectionURL(pathname, new URLSearchParams(search.toString()), null, true), { scroll: false });
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [revision, setRevision] = useSessionUI(`request-revision:${userId}`, 0);
  const hasLocation = userLat !== null && userLng !== null;
  const zoneKey = `${userId}:${userLat}:${userLng}:${radiusMeters}:${revision}`;
  return <div className="w-full">
    <p className="px-4 pb-3 text-sm leading-relaxed text-fg-muted">Publica lo que necesitas y recibe ofertas de personas cercanas.</p>
    <div className="flex items-center px-4 pb-3"><FiltroCategoriasDrawer seleccionadas={collection?.category ? [collection.category.slug] : []} modo="una" onAplicar={slugs => {
      const slug = slugs.at(0);
      if (slug) openCollection({ slug, nombre: CATEGORIES.find(category => category.slug === slug)?.name ?? slug }); else closeCollection();
    }} /></div>
    <div className="space-y-6 px-4 pb-28">
      {!userId ? <p className="py-16 text-center text-sm text-fg-muted">Inicia sesión para ver las solicitudes de tu zona.</p>
        : !hasLocation ? <p className="py-16 text-center text-sm text-fg-muted">Activa tu ubicación para ver solicitudes cerca de ti.</p>
        : collection ? <RequestCollection key={`${zoneKey}:${collection.category?.slug ?? "all"}`} zone={{ lat: userLat, lng: userLng, radius: radiusMeters, cacheScope: zoneKey }} category={collection.category} onBack={closeCollection} fresh={freshCollection} />
        : <RequestOverview key={zoneKey} zone={{ lat: userLat, lng: userLng, radius: radiusMeters, cacheScope: zoneKey }} onViewMore={openCollection} />}
    </div>
    {userId && <button type="button" onClick={() => setDrawerOpen(true)} className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-lg shadow-foreground/20 transition-transform hover:scale-105 active:scale-95" aria-label="Crear solicitud"><Plus className="h-6 w-6" strokeWidth={2.5} /></button>}
    {drawerOpen && <CreateRequestDrawer onClose={() => setDrawerOpen(false)} onCreated={() => { setDrawerOpen(false); setRevision(revision+1); }} />}
  </div>;
}
