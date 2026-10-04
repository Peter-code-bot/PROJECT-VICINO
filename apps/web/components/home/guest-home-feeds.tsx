"use client";

import { CATEGORIES, formatRelativeTime } from "@vicino/shared";
import { Heart, MessageCircle, LayoutGrid, Plus, ChevronDown } from "lucide-react";
import AuthLink from "@/components/auth/auth-link";
import { useMuroSesion } from "@/components/auth/muro-sesion";
import { RequestCard, type RequestCardPreviewData } from "@/components/solicitudes/request-card";
import { ComunidadCard } from "@/components/comunidades/comunidad-card";
import { SubTabs, type SubTabComunidades } from "@/components/comunidades/sub-tabs";
import { CatalogQueryState } from "@/components/shared/catalog-query-state";
import { loginPara } from "@/lib/auth/acceso-invitado";
import type { HomeGuestPreview, GuestPostPreview } from "@/lib/home-guest-contract";
import { GuestAuthCta } from "./guest-auth-cta";

function NationalPreviewIntro({ title }: { title: string }) {
  return <div className="px-4 pb-3">
    <h2 className="font-heading text-lg font-bold text-fg">{title}</h2>
    <p className="mt-1 text-sm text-fg-muted">Vista previa pública. Inicia sesión para ver lo que hay cerca de ti y participar.</p>
  </div>;
}

export function GuestRequestsFeed({ preview }: {
  preview: Extract<HomeGuestPreview, { kind: "solicitudes" }> | null;
}) {
  const context = "/?feed=solicitudes";
  const requests: RequestCardPreviewData[] = (preview?.requests ?? []).map(request => ({
    id: request.id, title: request.titulo, description: request.descripcion,
    budget_estimated: request.presupuesto_max, created_at: request.created_at,
    categories: request.categoria ? [{ slug: request.categoria, nombre: CATEGORIES.find(category => category.slug === request.categoria)?.name ?? request.categoria }] : [],
  }));
  return <div data-guest-preview="solicitudes" className="mx-auto w-full max-w-lg pb-28">
    <NationalPreviewIntro title="Solicitudes" />
    <GuestAuthCta destino={context} />
    <div className="flex items-center justify-between gap-3 px-4 pb-3">
      <AuthLink href={loginPara(context)} aria-label="Filtrar solicitudes" className="product-card-custom inline-flex min-h-12 items-center gap-2 rounded-xl px-3.5 text-sm font-medium text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!">
        <LayoutGrid className="h-4 w-4 text-brand-hi" aria-hidden="true" />Categorías<ChevronDown className="h-3.5 w-3.5 text-fg-muted" aria-hidden="true" />
      </AuthLink>
      <AuthLink href={loginPara(context)} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!">
        <Plus className="h-4 w-4" aria-hidden="true" />Publicar solicitud
      </AuthLink>
    </div>
    <div className="space-y-3 px-4">
      {!preview || preview.failure ? <CatalogQueryState failure={preview?.failure ?? { kind: "failure" }} section="las solicitudes de vista previa" />
        : requests.length === 0 ? <p role="status" className="py-10 text-center text-sm text-fg-muted">No hay solicitudes disponibles para esta vista previa.</p>
          : requests.map(request => <RequestCard key={request.id} data={request} />)}
    </div>
  </div>;
}

function GuestPostCard({ post }: { post: GuestPostPreview }) {
  const { pedirSesion } = useMuroSesion();
  const href = `/comunidades/${post.community_id}/publicacion/${post.id}`;
  return <article className="rounded-2xl bg-[color:var(--sidebar-bg)] p-4">
    <AuthLink href={`/comunidades/${post.community_id}`} className="inline-flex min-h-12 min-w-12 items-center text-sm font-semibold text-brand dark:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!">
      {post.community_nombre}
    </AuthLink>
    <p className="mb-2 text-xs text-fg dark:text-fg-muted">{formatRelativeTime(post.created_at)}</p>
    <AuthLink href={href} className="block min-h-12 rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!">
      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-fg line-clamp-6">{post.contenido}</p>
    </AuthLink>
    <div className="mt-3 flex items-center gap-4 border-t border-border/30 pt-2 text-sm text-fg dark:text-fg-muted">
      <button type="button" aria-label="Me gusta" onClick={() => { pedirSesion("Inicia sesión para reaccionar", href); }} className="inline-flex min-h-12 min-w-12 items-center gap-1.5 rounded-lg px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!">
        <Heart className="h-4 w-4" aria-hidden="true" />{post.likes_count}
      </button>
      <button type="button" aria-label="Comentar" onClick={() => { pedirSesion("Inicia sesión para comentar", href); }} className="inline-flex min-h-12 min-w-12 items-center gap-1.5 rounded-lg px-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!">
        <MessageCircle className="h-4 w-4" aria-hidden="true" />{post.comentarios_count}
      </button>
    </div>
  </article>;
}

export function GuestCommunitiesFeed({ preview, activeTab }: {
  preview: Extract<HomeGuestPreview, { kind: "comunidades" }> | null;
  activeTab: SubTabComunidades;
}) {
  const { pedirSesion } = useMuroSesion();
  const context = activeTab === "descubrir" ? "/?feed=comunidades&tab=descubrir" : "/?feed=comunidades";
  function changeTab(tab: SubTabComunidades) {
    if (tab === "mias") { pedirSesion("Inicia sesión para ver tus comunidades", "/?feed=comunidades&tab=mias"); return; }
    const url = new URL(window.location.href);
    if (tab === "muro") url.searchParams.delete("tab");
    else url.searchParams.set("tab", tab);
    window.history.replaceState(window.history.state, "", url.toString());
  }
  const communities = preview?.communities ?? [];
  const posts = preview?.posts ?? [];
  const failure = activeTab === "descubrir" ? preview?.communityFailure : preview?.postFailure;
  return <div data-guest-preview="comunidades" className="mx-auto w-full max-w-lg pb-28">
    <NationalPreviewIntro title="Comunidades" />
    <GuestAuthCta destino={context} />
    <div className="pb-3"><SubTabs active={activeTab === "descubrir" ? "descubrir" : "muro"} onChange={changeTab} largeTargets /></div>
    <div className="space-y-3 px-4">
      {!preview || failure ? <CatalogQueryState failure={failure ?? { kind: "failure" }} section="las comunidades de vista previa" />
        : activeTab === "descubrir" ? communities.length === 0
          ? <p role="status" className="py-10 text-center text-sm text-fg-muted">No hay comunidades públicas disponibles para esta vista previa.</p>
          : communities.map(community => <ComunidadCard key={community.id} comunidad={{ ...community, es_privada: false }} />)
        : posts.length === 0
          ? <p role="status" className="py-10 text-center text-sm text-fg-muted">No hay publicaciones públicas disponibles para esta vista previa.</p>
          : posts.map(post => <GuestPostCard key={post.id} post={post} />)}
      <div className="flex justify-center pt-3">
        <button type="button" onClick={() => { pedirSesion("Inicia sesión para fundar una comunidad", context); }} className="inline-flex min-h-12 items-center gap-2 rounded-full bg-brand px-5 text-sm font-semibold text-white hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!">
          <Plus className="h-4 w-4" aria-hidden="true" />Fundar comunidad
        </button>
      </div>
    </div>
  </div>;
}
