"use client";

import { useRef, type RefObject } from "react";
import Link from "next/link";
import Image from "next/image";
import * as Dialog from "@radix-ui/react-dialog";
import { AnimatePresence, motion, useDragControls, useReducedMotion } from "framer-motion";
import { ArrowRight, Loader2, Store, X } from "lucide-react";
import type { MapCoverageResult, MapFeature } from "@vicino/shared";
import { PriceDisplay } from "@/components/shared/price-display";
import { priceFallbackLabel } from "@/lib/price-mode";

interface PublicationResultsDrawerProps {
  feature: MapFeature | null;
  data: MapCoverageResult | null;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onRetry: () => void;
  onLoadMore: () => void;
  returnFocus: RefObject<HTMLElement | null>;
  fallbackFocus: RefObject<HTMLElement | null>;
}

/** A single modal owns focus and scrolling; only the handle starts the drag. */
export function PublicationResultsDrawer({ feature, data, pending, error, onClose, onRetry, onLoadMore, returnFocus, fallbackFocus }: PublicationResultsDrawerProps) {
  const controls = useDragControls();
  const reducedMotion = useReducedMotion();
  const close = useRef<HTMLButtonElement>(null);
  const title = feature && feature.count > 1 ? "Publicaciones en este grupo" : "Publicaciones en este punto";

  return <Dialog.Root open={feature !== null} onOpenChange={open => { if (!open) onClose(); }}>
    <AnimatePresence>
      {feature && <Dialog.Portal forceMount>
        <Dialog.Overlay forceMount asChild><motion.div className="fixed inset-0 z-[80] bg-black/40" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: reducedMotion ? 0 : .16 }} /></Dialog.Overlay>
        <Dialog.Content forceMount asChild
          onOpenAutoFocus={event => { event.preventDefault(); close.current?.focus(); }}
          onCloseAutoFocus={event => {
            event.preventDefault();
            const target = returnFocus.current;
            if (target?.isConnected && !target.closest('[aria-hidden="true"]')) target.focus({ preventScroll: true });
            else fallbackFocus.current?.focus({ preventScroll: true });
          }}>
          <motion.div data-modal-open="true" data-no-page-swipe data-no-pull-to-refresh
            className="fixed inset-x-0 bottom-0 z-[81] mx-auto flex max-h-[min(86dvh,900px)] max-w-2xl flex-col rounded-t-3xl bg-[color:var(--sidebar-bg)] text-[color:var(--fg)] outline-none"
            initial={{ y: reducedMotion ? 0 : "100%", opacity: reducedMotion ? 0 : 1 }} animate={{ y: 0, opacity: 1 }} exit={{ y: reducedMotion ? 0 : "100%", opacity: reducedMotion ? 0 : 1 }}
            transition={{ duration: reducedMotion ? 0 : .24, ease: [.22, 1, .36, 1] }}
            drag="y" dragListener={false} dragControls={controls} dragConstraints={{ top: 0, bottom: 0 }} dragElastic={{ top: 0, bottom: .45 }}
            onDragEnd={(_, info) => { if (info.offset.y > 96 || info.velocity.y > 650) onClose(); }}>
            <button type="button" aria-label="Cerrar o deslizar hacia abajo las publicaciones" onPointerDown={event => controls.start(event)}
              onClick={onClose} className="flex min-h-11 shrink-0 touch-none items-center justify-center rounded-t-3xl focus-visible:outline-2 focus-visible:outline-[color:var(--fg)]">
              <span className="h-1.5 w-12 rounded-full bg-[color:var(--fg)]/35" />
            </button>
            <div className="flex shrink-0 items-start justify-between gap-3 px-5 pb-3">
              <div className="min-w-0"><Dialog.Title className="font-heading text-xl font-bold">{title}</Dialog.Title>
                <Dialog.Description className="mt-1 text-sm">{data ? `${data.list_total} publicaciones · ${data.list_seller_total} vendedores` : `${feature.count} ${feature.count === 1 ? "publicación" : "publicaciones"}`}<span className="mt-1 block text-xs">Las ubicaciones son aproximadas.</span></Dialog.Description>
              </div>
              <Dialog.Close asChild><button ref={close} type="button" aria-label="Cerrar publicaciones" className="discovery-control min-w-12 shrink-0 px-2"><X className="h-5 w-5" /></button></Dialog.Close>
            </div>
            <div className="min-h-0 overflow-y-auto overscroll-contain px-5 pb-[calc(env(safe-area-inset-bottom)+1rem)]" aria-busy={pending}>
              {pending && !data?.listings.length && <p role="status" className="flex items-center gap-2 py-8 text-sm"><Loader2 className="h-5 w-5 animate-spin motion-reduce:animate-none" />Buscando publicaciones…</p>}
              {error && <div role="alert" className="space-y-3 py-5 text-sm"><p>{error}</p><button type="button" onClick={onRetry} className="discovery-control">Reintentar</button></div>}
              {data && !data.listings.length && !pending && !error && <div className="space-y-2 py-6"><Store className="h-7 w-7" /><p className="font-semibold">Ya no hay publicaciones en este punto</p><p className="text-sm">Prueba otro punto o cambia los filtros.</p></div>}
              <div className="space-y-3">{data?.listings.map(item => <article key={item.id} className="product-card-custom rounded-2xl p-3">
                <Link href={item.slug ? `/${encodeURIComponent(item.categoria)}/${encodeURIComponent(item.slug)}` : `/vendedor/${item.creador_id}`} className="flex gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-[color:var(--fg)]">
                  <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl bg-[color:var(--sidebar-bg)]">{item.imagen_principal ? <Image src={item.imagen_principal} alt="" fill sizes="80px" className="object-cover" /> : <Store className="m-6 h-8 w-8" />}</div>
                  <div className="min-w-0 space-y-1"><h3 className="line-clamp-2 text-sm font-semibold">{item.titulo}</h3><p className="text-sm font-bold"><PriceDisplay amount={item.precio} fallback={priceFallbackLabel(item.modo_precio)} /></p></div>
                </Link>
                <Link href={`/vendedor/${item.creador_id}`} className="mt-2 flex min-h-11 items-center justify-between gap-2 rounded-xl px-1 text-sm focus-visible:outline-2 focus-visible:outline-[color:var(--fg)]"><span className="truncate">{item.vendedor_nombre}</span><span className="inline-flex shrink-0 items-center gap-1 text-xs">Ver negocio<ArrowRight className="h-3 w-3" /></span></Link>
              </article>)}</div>
              {data?.next_cursor && <button type="button" disabled={pending} onClick={onLoadMore} className="discovery-control mt-4 w-full">{pending ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" />Cargando…</> : <>Ver más publicaciones<ArrowRight className="h-4 w-4" /></>}</button>}
            </div>
          </motion.div>
        </Dialog.Content>
      </Dialog.Portal>}
    </AnimatePresence>
  </Dialog.Root>;
}
