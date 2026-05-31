"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";
import { RatingStars } from "@/components/shared/rating-stars";
import { ReviewProductLink } from "@/components/shared/review-product-link";
import { formatPrice, formatDate, primaryCategorySlug } from "@vicino/shared";
import { Grid3X3, Star, GripVertical, Check, X, Loader2 } from "lucide-react";
import { ReportMenuButton } from "@/components/moderation/report-menu-button";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import {
  DndContext,
  closestCenter,
  MouseSensor,
  TouchSensor,
  useSensor,
  useSensors,
  DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  rectSortingStrategy,
  arrayMove,
  useSortable,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { updateProductsOrder } from "./actions";

// --- Subcomponente SortableProductCard ---
function SortableProductCard({ p, isEditing }: { p: any; isEditing: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 50 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "relative aspect-square bg-card dark:bg-neutral-800 overflow-hidden rounded-lg group",
        isEditing && !isDragging && "animate-jiggle",
        isDragging && "shadow-xl scale-105 opacity-80"
      )}
      {...(isEditing ? attributes : {})}
      {...(isEditing ? listeners : {})}
    >
      {p.imagen_principal ? (
        <Image
          src={p.imagen_principal}
          alt={p.titulo}
          fill
          className={cn("object-cover transition-opacity", !isEditing && "group-hover:opacity-80")}
          sizes="33vw"
          draggable={false}
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center text-2xl">📷</div>
      )}
      
      {!isEditing && (
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center pointer-events-none">
          <span className="text-white font-heading font-bold text-sm">
            {formatPrice(Number(p.precio))}
          </span>
        </div>
      )}

      {p.estatus === "pausado" && (
        <div className="absolute right-1 top-1 rounded bg-[color:var(--trust-gold)] px-1.5 py-0.5 text-[8px] font-bold text-[color:var(--brand-dark)]">
          PAUSADO
        </div>
      )}

      {isEditing && (
        <div className="absolute inset-0 bg-black/10 flex items-center justify-center">
          <div className="h-8 w-8 rounded-full bg-white/80 flex items-center justify-center shadow-sm backdrop-blur-sm">
            <GripVertical className="w-5 h-5 text-[color:var(--fg)]" />
          </div>
        </div>
      )}
    </div>
  );
}
// -----------------------------------------

interface ProfileTabsProps {
  // MP#08 #5c-4: product_categories embed opcional (unknown) que llega de
  // perfil/page.tsx y vendedor/[id]/page.tsx. Tipo `unknown` espeja la
  // imprecision de supabase-js para nested embeds; el consumo eventual
  // (5c-4-bis cuando se diseñe el overlay sobre SortableProductCard) pasara
  // por normalizeCardCategories. Render visual diferido a 5c-4-bis.
  products: Array<{
    id: string;
    titulo: string;
    precio: number;
    imagen_principal: string | null;
    categoria: string;
    slug: string;
    estatus: string;
    ventas_count: number;
    product_categories?: unknown;
  }>;
  reviewsAsSeller: Array<{
    id: string;
    rating: number;
    comentario: string | null;
    created_at: string;
    review_type: string;
    reviewer_id?: string;
    profiles: { nombre: string; foto: string | null } | { nombre: string; foto: string | null }[] | null;
    products_services:
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null }
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null }[]
      | null;
  }>;
  reviewsAsBuyer: Array<{
    id: string;
    rating: number;
    comentario: string | null;
    created_at: string;
    review_type: string;
    reviewer_id?: string;
    profiles: { nombre: string; foto: string | null } | { nombre: string; foto: string | null }[] | null;
    products_services:
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null }
      | { id: string; titulo: string; categoria: string; slug: string; imagen_principal: string | null }[]
      | null;
  }>;
  isVendedor: boolean;
  /** Id del usuario autenticado. Se usa para esconder el botón "Reportar" en
   *  reseñas escritas por el propio usuario. */
  currentUserId?: string | null;
}

export function ProfileTabs({ products, reviewsAsSeller, reviewsAsBuyer, isVendedor, currentUserId }: ProfileTabsProps) {
  const [tab, setTab] = useState<"products" | "reviews">("products");
  
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const isEditing = searchParams.get("edit") === "products" && isVendedor;
  const [isSaving, setIsSaving] = useState(false);

  const [localProducts, setLocalProducts] = useState(products);

  // Sync prop changes
  useState(() => {
    setLocalProducts(products);
  });

  const allReviews = [...reviewsAsSeller, ...reviewsAsBuyer];

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 150, tolerance: 5 } })
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setLocalProducts((items) => {
        const oldIndex = items.findIndex((i) => i.id === active.id);
        const newIndex = items.findIndex((i) => i.id === over.id);
        return arrayMove(items, oldIndex, newIndex);
      });
    }
  };

  const handleSaveOrder = async () => {
    setIsSaving(true);
    const updates = localProducts.map((p, index) => ({ id: p.id, sort_order: index }));
    const res = await updateProductsOrder(updates);
    setIsSaving(false);
    if (res?.error) {
      console.error("No se pudo guardar el orden (¿Falta la migración de sort_order?):", res.error);
    }
    // Siempre salir del modo de edición, incluso si hay error temporal en la BD
    router.push(pathname, { scroll: false });
  };

  const handleCancelEdit = () => {
    setLocalProducts(products); // revert
    router.push(pathname, { scroll: false });
  };

  return (
    <div>
      {/* Tab bar */}
      <div className="mb-4 flex shadow-[inset_0_-1px_0_0_var(--border)]">
        <button
          onClick={() => setTab("products")}
          className={cn(
            "-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-sm font-semibold transition-colors",
            tab === "products"
              ? "border-[color:var(--brand)] text-[color:var(--brand-hi)]"
              : "border-transparent text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
          )}
        >
          <Grid3X3 className="w-4 h-4" />
          Productos
        </button>
        <button
          onClick={() => setTab("reviews")}
          className={cn(
            "-mb-px flex flex-1 items-center justify-center gap-2 border-b-2 py-3 text-sm font-semibold transition-colors",
            tab === "reviews"
              ? "border-[color:var(--brand)] text-[color:var(--brand-hi)]"
              : "border-transparent text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
          )}
        >
          <Star className="w-4 h-4" />
          Reseñas ({allReviews.length})
        </button>
      </div>

      {/* Products grid */}
      {tab === "products" && (
        <div className="relative">
          {/* Edit Banner */}
          {isEditing && (
            <div className="mb-4 rounded-xl bg-[color:var(--brand-tint)] border border-[color:var(--brand-tint-strong)] p-3 flex flex-col sm:flex-row items-center justify-between gap-3 animate-fade-in-up">
              <span className="text-sm font-semibold text-[color:var(--brand-dark)] dark:text-[color:var(--brand-hi)]">
                Estás editando tus productos, ordénalos a tu gusto.
              </span>
              <div className="flex gap-2 w-full sm:w-auto">
                <button
                  onClick={handleCancelEdit}
                  disabled={isSaving}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancelar
                </button>
                <button
                  onClick={handleSaveOrder}
                  disabled={isSaving}
                  className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-xs font-bold bg-[color:var(--brand)] text-white shadow-[var(--shadow-glow)] disabled:opacity-50"
                >
                  {isSaving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
                  Guardar
                </button>
              </div>
            </div>
          )}

          {localProducts.length > 0 ? (
            <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
              <SortableContext items={localProducts.map((p) => p.id)} strategy={rectSortingStrategy}>
                <div 
                  className="grid grid-cols-3 gap-1.5"
                  {...(isEditing ? { "data-no-page-swipe": "true" } : {})}
                >
                  {localProducts.map((p) => (
                    isEditing ? (
                      <SortableProductCard key={p.id} p={p} isEditing={true} />
                    ) : (
                      <Link
                        key={p.id}
                        href={`/${primaryCategorySlug(p.product_categories) ?? p.categoria}/${p.slug}`}
                        className="block" // Wrapped Link so layout matches
                      >
                        <SortableProductCard p={p} isEditing={false} />
                      </Link>
                    )
                  ))}
                </div>
              </SortableContext>
            </DndContext>
          ) : (
            <div className="py-12 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--brand-tint)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
                <span className="text-2xl">📦</span>
              </div>
              <p className="text-sm text-[color:var(--fg-muted)]">Sin productos publicados</p>
              {isVendedor && (
                <Link
                  href="/vender"
                  className="mt-3 inline-block text-sm font-semibold text-[color:var(--brand-hi)] hover:text-[color:var(--brand)]"
                >
                  Publicar mi primer producto →
                </Link>
              )}
            </div>
          )}
        </div>
      )}

      {/* Reviews */}
      {tab === "reviews" && (
        <div className="space-y-3">
          {allReviews.length > 0 ? (
            allReviews.map((r) => {
              const reviewer = Array.isArray(r.profiles) ? r.profiles[0] : r.profiles;
              const reviewedProduct = Array.isArray(r.products_services)
                ? r.products_services[0]
                : r.products_services;
              const isOwnReview = currentUserId != null && r.reviewer_id === currentUserId;
              return (
                <div
                  key={r.id}
                  className="space-y-2 rounded-xl bg-[color:var(--card)] p-4 shadow-[inset_0_0_0_1px_var(--border)]"
                >
                  <div className="flex items-center gap-2">
                    <div className="h-7 w-7 shrink-0 overflow-hidden rounded-full bg-[color:var(--bg-elev-2)] shadow-[inset_0_0_0_1px_var(--border)]">
                      {reviewer?.foto ? (
                        <Image src={reviewer.foto} alt="" width={28} height={28} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-xs font-bold text-[color:var(--fg-muted)]">
                          {reviewer?.nombre?.charAt(0) ?? "?"}
                        </div>
                      )}
                    </div>
                    <span className="text-sm font-semibold text-[color:var(--fg)]">{reviewer?.nombre ?? "Usuario"}</span>
                    <RatingStars rating={r.rating} size="sm" />
                    <span className="ml-auto text-xs text-[color:var(--fg-dim)]">{formatDate(r.created_at)}</span>
                    {currentUserId && !isOwnReview && (
                      <ReportMenuButton
                        targetType="review"
                        targetId={r.id}
                        targetLabel={r.comentario ? r.comentario.slice(0, 60) : `Reseña de ${reviewer?.nombre ?? "usuario"}`}
                        iconSize={14}
                        ariaLabel="Reportar reseña"
                      />
                    )}
                  </div>
                  {r.comentario && (
                    <p className="text-sm text-[color:var(--fg-muted)]">{r.comentario}</p>
                  )}
                  <div className="flex items-center justify-between gap-2 pt-1">
                    <span className="shrink-0 text-[10px] uppercase tracking-wide text-[color:var(--fg-dim)]">
                      {r.review_type === "buyer_to_seller" ? "Como vendedor" : "Como comprador"}
                    </span>
                    <ReviewProductLink product={reviewedProduct ?? null} />
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-12 text-center">
              <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-2xl bg-[rgba(212,168,83,0.18)] shadow-[inset_0_0_0_1px_rgba(212,168,83,0.30)]">
                <span className="text-2xl">⭐</span>
              </div>
              <p className="text-sm text-[color:var(--fg-muted)]">Sin reseñas aún</p>
            </div>
          )}
        </div>
      )}

    </div>
  );
}
