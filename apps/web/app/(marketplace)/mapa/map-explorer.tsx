"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Search, MapPin, LocateFixed, SlidersHorizontal, X, ArrowRight, Loader2, Store } from "lucide-react";
import { CATEGORIES, type MapBounds, type MapFeature, type MapQuery } from "@vicino/shared";
import { PublicationMap } from "@/components/map/publication-map";
import { ChangeLocationSheet } from "@/components/home/change-location-sheet";
import { useSessionUI } from "@/components/layout/session-data-provider";
import { useGeolocation } from "@/hooks/useGeolocation";
import { usePublicationMap } from "@/hooks/use-publication-map";
import { boundsAround, intersectMapBounds } from "@/lib/geo/publication-map";
import { cn } from "@/lib/utils";
import { iconoDeCategoria } from "@/lib/categories/icons";

const EMPTY: MapFeature[] = [];
const control = "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-[color:var(--brand-hi)]";
export function MapExplorer({ initialQuery, initialCenter }: { initialQuery: MapQuery; initialCenter: { lat: number; lng: number } }) {
  const [ui,setUI] = useSessionUI("publication-map:v1:"+JSON.stringify(initialQuery), { query: initialQuery, viewport: initialQuery.bounds, center: initialCenter });
  const [focus,setFocus] = useState<{ bounds: MapBounds; revision: number }|null>(null);
  const [filters,setFilters] = useState(false), [locationOpen,setLocationOpen] = useState(false);
  const [gpsPending,setGpsPending] = useState(false);
  const geo = useGeolocation();
  const latest = useRef(ui);
  useEffect(() => { latest.current = ui; }, [ui]);
  const area = intersectMapBounds(ui.viewport);
  const validPrice = ui.query.price_min === null || ui.query.price_max === null || ui.query.price_min <= ui.query.price_max;
  const { data,error,pending,retry } = usePublicationMap(area && validPrice ? { ...ui.query, bounds: area } : null);
  function update(patch: Partial<MapQuery>) { setUI({ ...ui,query: { ...ui.query,...patch,cursor: null } }); }
  function locate(center: {lat:number;lng:number}, radius=latest.current.query.radius_meters) {
    const bounds = boundsAround(center,radius);
    setUI({ ...latest.current,center,viewport: bounds,query: { ...latest.current.query,center,radius_meters:radius,cell_id:null,cursor:null } });
    setFocus({bounds,revision:Date.now()});
  }
  useEffect(() => {
    const changed = (event: Event) => {
      const p = (event as CustomEvent<{lat:number;lng:number;radius?:number}|null>).detail;
      if (p && Number.isFinite(p.lat) && Number.isFinite(p.lng)) { locate(p,p.radius); setGpsPending(false); }
    };
    window.addEventListener("vicino_location_updated",changed);
    return () => window.removeEventListener("vicino_location_updated",changed);
  // The listener reads the current view from a ref, independent of render timing.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const selected = data?.features.find(f=>f.id===ui.query.cell_id);
  function onBounds(viewport: MapBounds) {
    if (JSON.stringify(viewport)===JSON.stringify(latest.current.viewport)) return;
    const previous = latest.current;
    setUI({ ...previous,viewport,query:{...previous.query,cell_id:null,cursor:null} });
  }
  const title = ui.query.cell_id ? "Publicaciones en este punto" : "Publicaciones en esta zona";
  return <div className="mx-auto w-full max-w-7xl space-y-3 px-3 py-4 sm:px-5" data-navigation-kind="map" data-no-page-swipe data-no-pull-to-refresh>
    <div className="flex items-center justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-widest text-[color:var(--brand-hi)]">Explora tu zona</p><h1 className="font-heading text-2xl font-bold">Lo que hay cerca</h1></div><Link href="/buscar" className={control}>Ver búsqueda<ArrowRight className="h-4 w-4" /></Link></div>
    <label className="flex min-h-12 items-center gap-3 rounded-2xl border border-[color:var(--border)] bg-[color:var(--card)] px-4"><Search className="h-5 w-5 text-[color:var(--fg-muted)]" /><span className="sr-only">Buscar publicaciones o vendedores</span><input type="search" maxLength={120} value={ui.query.q} onChange={e=>update({q:e.target.value,cell_id:null})} placeholder="Busca comida, clases, regalos…" className="min-w-0 flex-1 bg-transparent py-3 text-sm outline-none" />{ui.query.q && <button aria-label="Limpiar búsqueda" type="button" onClick={()=>update({q:"",cell_id:null})} className="min-h-11 min-w-11"><X className="mx-auto h-4 w-4" /></button>}</label>
    <div className="flex gap-2 overflow-x-auto pb-1" aria-label="Categorías">
      <button type="button" aria-pressed={!ui.query.categories.length} onClick={()=>update({categories:[],cell_id:null})} className={cn(control, "shrink-0", !ui.query.categories.length && "bg-[color:var(--brand)] text-white")}>Todas</button>
      {CATEGORIES.filter(c=>!c.hidden_in_form).map(c=>{const Icon=iconoDeCategoria(c.slug); const active=ui.query.categories.includes(c.slug);return <button type="button" key={c.slug} aria-pressed={active} onClick={()=>update({categories:active?[]:[c.slug],cell_id:null})} className={cn(control,"shrink-0",active && "bg-[color:var(--brand)] text-white")}><Icon className="h-4 w-4" />{c.name}</button>;})}
    </div>
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex rounded-2xl bg-[color:var(--card-2)] p-1" aria-label="Área de búsqueda">{([['zone','Toda la zona'],['nearby','Cerca de mí']] as const).map(([mode,label])=><button key={mode} type="button" aria-pressed={ui.query.mode===mode} onClick={()=>update({mode,center:ui.center,cell_id:null})} className={`min-h-10 rounded-xl px-3 text-sm font-semibold ${ui.query.mode===mode?'bg-[color:var(--card)] shadow-sm':''}`}>{label}</button>)}</div>
      <button type="button" onClick={()=>setLocationOpen(true)} className={control}><MapPin className="h-4 w-4" />Cambiar zona</button>
      <button type="button" aria-label="Usar mi ubicación" onClick={()=>{setGpsPending(true);geo.request();}} className={control}><LocateFixed className="h-4 w-4" />{gpsPending&&geo.state.status!=="error" ? "Localizando…" : "Mi ubicación"}</button>
      <button type="button" aria-expanded={filters} onClick={()=>setFilters(!filters)} className={`${control} ml-auto`}><SlidersHorizontal className="h-4 w-4" />Filtros</button>
    </div>
    {gpsPending&&geo.state.status==="error"&&<p role="status" className="text-sm text-[color:var(--fg-muted)]">{geo.state.message}. Puedes elegir la zona manualmente.</p>}
    {ui.query.mode==='nearby'&&<label className="flex items-center gap-3 text-sm"><span className="shrink-0">Mi radio: <strong>{ui.query.radius_meters/1000} km</strong></span><input aria-label="Radio de búsqueda en kilómetros" type="range" min={1} max={50} value={ui.query.radius_meters/1000} onChange={e=>update({radius_meters:Number(e.target.value)*1000,cell_id:null})} className="max-w-sm flex-1 accent-[color:var(--brand)]" /></label>}
    {filters&&<div className="grid grid-cols-2 gap-3 rounded-2xl bg-[color:var(--card-2)] p-4 sm:grid-cols-3">
      <label className="col-span-2 text-sm sm:col-span-1">Tipo<select aria-label="Tipo de publicación" value={ui.query.tipo??''} onChange={e=>update({tipo:e.target.value as MapQuery['tipo']||null,cell_id:null})} className="mt-1 min-h-11 w-full rounded-xl bg-[color:var(--card)] px-3"><option value="">Productos y servicios</option><option value="producto">Productos</option><option value="servicio">Servicios</option></select></label>
      {(['price_min','price_max'] as const).map(key=><label key={key} className="text-sm">{key==='price_min'?'Precio mínimo':'Precio máximo'}<input type="number" min={0} max={99999999} step="any" value={ui.query[key]??''} onChange={e=>update({[key]:e.target.value===''?null:Math.min(99999999,Math.max(0,Number(e.target.value))),cell_id:null})} className="mt-1 min-h-11 w-full rounded-xl bg-[color:var(--card)] px-3" /></label>)}
      {!validPrice&&<p role="alert" className="col-span-2 text-sm sm:col-span-3">El precio máximo debe ser mayor o igual al mínimo.</p>}
    </div>}
    <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="relative h-[43dvh] min-h-[300px] lg:sticky lg:top-24 lg:h-[calc(100dvh-220px)] lg:min-h-[500px]">
        <PublicationMap initialBounds={ui.viewport} focus={focus} features={data?.features??EMPTY} selected={ui.query.cell_id} onBounds={onBounds} onSelect={f=>update({cell_id:f.id})} />
        <div role="status" className="pointer-events-none absolute left-3 top-3 max-w-[calc(100%-24px)] rounded-2xl bg-[color:var(--card)] px-3 py-2 text-xs shadow-sm">{pending ? "Actualizando zona…" : data ? `${data.total} publicaciones · ${data.seller_total} vendedores` : "Explora una zona en el mapa"}</div>
        {selected&&(selected.bounds.east>selected.bounds.west||selected.bounds.north>selected.bounds.south)&&<button type="button" onClick={()=>setFocus({bounds:boundsAround({lat:selected.public_lat,lng:selected.public_lng},Math.max(1000,Math.max((selected.bounds.north-selected.bounds.south)*111000,(selected.bounds.east-selected.bounds.west)*111000*Math.cos(selected.public_lat*Math.PI/180))/2)),revision:Date.now()})} className={`${control} absolute bottom-8 left-3 shadow`}>Acercar este grupo</button>}
      </div>
      <section aria-labelledby="map-results-title" aria-busy={pending} className="min-w-0 space-y-3 rounded-3xl border border-[color:var(--border)] bg-[color:var(--card)] p-4">
        <div className="flex items-start justify-between gap-2"><div><h2 id="map-results-title" className="font-heading text-lg font-bold">{title}</h2><p className="text-xs text-[color:var(--fg-muted)]">{data?`${data.list_total} resultados`:'Resultados del área visible'}</p></div>{ui.query.cell_id&&<button type="button" aria-label="Ver toda la zona" onClick={()=>update({cell_id:null})} className="min-h-11 min-w-11"><X className="mx-auto h-4 w-4" /></button>}</div>
        <p className="text-xs leading-relaxed text-[color:var(--fg-muted)]">Los puntos muestran ubicaciones aproximadas. Los números indican publicaciones; un vendedor puede tener varias.</p>
        {!area&&<p role="status" className="py-6 text-sm">Esta zona está fuera del área disponible. Elige una ubicación en México.</p>}
        {pending&&<div role="status" className="flex items-center gap-2 py-8 text-sm"><Loader2 className="h-5 w-5 animate-spin" />Buscando en esta zona…</div>}
        {error&&<div role="alert" className="space-y-3 py-5 text-sm"><p>{error}</p><button type="button" onClick={retry} className={control}>Reintentar</button>{ui.query.cursor&&<button type="button" onClick={()=>update({cursor:null})} className={control}>Primera página</button>}</div>}
        {data&&!data.list_total&&<div className="space-y-2 py-6"><Store className="h-7 w-7 text-[color:var(--fg-muted)]" /><p className="font-semibold">Aún no hay publicaciones aquí</p><p className="text-sm text-[color:var(--fg-muted)]">Mueve el mapa o prueba otra categoría.</p></div>}
        <div className="max-h-[42dvh] space-y-3 overflow-y-auto overscroll-contain lg:max-h-[calc(100dvh-440px)]">{data?.listings.map(item=><article key={item.id} className="border-b border-[color:var(--border)] pb-3 last:border-b-0"><Link href={item.slug?`/${encodeURIComponent(item.categoria)}/${encodeURIComponent(item.slug)}`:`/vendedor/${item.creador_id}`} className="flex gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-[color:var(--brand-hi)]">
          <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-2xl bg-[color:var(--card-2)]">{item.imagen_principal?<Image src={item.imagen_principal} alt="" fill sizes="80px" className="object-cover" />:<Store className="m-6 h-8 w-8 text-[color:var(--fg-muted)]" />}</div>
          <div className="min-w-0 space-y-1"><h3 className="line-clamp-2 text-sm font-semibold">{item.titulo}</h3><p className="truncate text-xs text-[color:var(--fg-muted)]">{item.vendedor_nombre}</p><p className="text-sm font-bold text-[color:var(--brand-hi)]">{item.modo_precio==='consultar'||item.precio===null?'Consultar precio':new Intl.NumberFormat('es-MX',{style:'currency',currency:'MXN',maximumFractionDigits:0}).format(item.precio)}</p></div>
        </Link><button type="button" onClick={()=>update({cell_id:item.cell_id})} className="mt-2 flex min-h-9 items-center gap-1 text-xs font-medium text-[color:var(--brand-hi)]"><MapPin className="h-3 w-3" />Ver punto{item.seller_listing_count>1?` · ${item.seller_listing_count} de este vendedor`:''}</button></article>)}</div>
        {data&&(data.next_cursor||ui.query.cursor)&&<div className="flex flex-wrap gap-2">{ui.query.cursor&&<button type="button" onClick={()=>update({cursor:null})} className={control}>Primera página</button>}{data.next_cursor&&<button type="button" onClick={()=>setUI({...ui,query:{...ui.query,cursor:data.next_cursor}})} className={control}>Siguientes 30<ArrowRight className="h-4 w-4" /></button>}</div>}
      </section>
    </div>
    <ChangeLocationSheet open={locationOpen} onClose={()=>setLocationOpen(false)} />
  </div>;
}
