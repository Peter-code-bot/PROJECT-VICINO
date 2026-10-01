"use client";

import { useEffect, useId, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { Check, ChevronDown, MapPin, SlidersHorizontal, X } from "lucide-react";
import { CATEGORIES } from "@vicino/shared";
import { ChangeLocationSheet } from "@/components/home/change-location-sheet";
import type { GeoPosition } from "@/lib/geo/location-storage";
import { UNIVERSITY_CATEGORY } from "@/lib/university";
import { cn } from "@/lib/utils";

export interface DiscoveryFilterValues {
  categories: string[];
  tipo: "" | "producto" | "servicio";
  priceMin: string;
  priceMax: string;
  sort?: string;
  subcategory?: string;
  nearby?: boolean;
  radiusMeters?: number;
}

export interface DiscoveryFiltersProps {
  value: DiscoveryFilterValues;
  onApply: (value: DiscoveryFilterValues) => void;
  multipleCategories?: boolean;
  showSort?: boolean;
  showDistance?: boolean;
  showLocation?: boolean;
  initialPosition?: GeoPosition | null;
  viewerUniversity?: string | null;
  pending?: boolean;
}

const VISIBLE_CATEGORIES = CATEGORIES.filter((category) => !category.hidden_in_form);
const MAX_CATEGORIES = 10;

/** Filter edits stay local until Apply; the location editor has its own explicit Apply. */
export function DiscoveryFilters({
  value,
  onApply,
  multipleCategories = false,
  showSort = false,
  showDistance = false,
  showLocation = false,
  initialPosition,
  viewerUniversity,
  pending = false,
}: DiscoveryFiltersProps) {
  const [panel, setPanel] = useState<"closed" | "filters" | "location">("closed");
  const [draft, setDraft] = useState(value);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const locationButtonRef = useRef<HTMLButtonElement>(null);
  const nextFocus = useRef<"initial" | "trigger" | "location">("initial");
  const restoreTriggerFocus = useRef(false);
  const priceErrorId = useId();
  const universityHelpId = useId();
  const minPrice = draft.priceMin === "" ? null : Number(draft.priceMin);
  const maxPrice = draft.priceMax === "" ? null : Number(draft.priceMax);
  const pricesValid = [minPrice, maxPrice].every(
    (price) => price === null || (Number.isFinite(price) && price >= 0 && price <= 99999999),
  ) && (minPrice === null || maxPrice === null || minPrice <= maxPrice);
  const radiusMeters = draft.radiusMeters ?? 10000;
  const distanceValid = !showDistance || !draft.nearby || (
    Number.isFinite(radiusMeters) && radiusMeters >= 1000 && radiusMeters <= 50000
  );
  const activeCount = value.categories.length
    + Number(Boolean(value.tipo))
    + Number(Boolean(value.priceMin || value.priceMax))
    + Number(showDistance && Boolean(value.nearby))
    + Number(showSort && Boolean(value.sort && value.sort !== "newest"));

  // Applying starts a navigation that temporarily disables the trigger. Radix
  // closes before it can receive focus; restore it when navigation settles.
  useEffect(() => {
    if (panel === "closed" && !pending && restoreTriggerFocus.current) {
      restoreTriggerFocus.current = false;
      triggerRef.current?.focus({ preventScroll: true });
    }
  }, [panel, pending]);

  // The existing location sheet renders its own portal. Focus follows that
  // portal while Radix is closed, then returns to the action inside Filters.
  useEffect(() => {
    if (panel !== "location") return;
    let sheet: HTMLElement | null = null;
    const focusable = () => sheet ? Array.from(sheet.querySelectorAll<HTMLElement>(
      'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], [tabindex="0"]',
    )).filter((element) => element.getClientRects().length > 0 && !element.closest('[aria-hidden="true"]')) : [];
    const focusFirst = () => focusable()[0]?.focus();
    const attach = () => {
      sheet = document.querySelector<HTMLElement>('[role="dialog"][aria-label="Cambiar ubicación"]');
      if (sheet) {
        focusFirst();
        observer.disconnect();
      }
    };
    const observer = new MutationObserver(attach);
    observer.observe(document.body, { childList: true, subtree: true });
    attach();
    const keepFocus = (event: FocusEvent) => {
      if (sheet?.isConnected && !sheet.contains(event.target as Node)) focusFirst();
    };
    const handleTab = (event: KeyboardEvent) => {
      if (event.key !== "Tab" || !sheet?.isConnected) return;
      const elements = focusable();
      const first = elements[0], last = elements.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !sheet.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !sheet.contains(document.activeElement))) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("focusin", keepFocus);
    document.addEventListener("keydown", handleTab);
    return () => {
      observer.disconnect();
      document.removeEventListener("focusin", keepFocus);
      document.removeEventListener("keydown", handleTab);
    };
  }, [panel]);

  function toggleCategory(slug: string) {
    setDraft((previous) => {
      const categories = previous.categories.includes(slug)
        ? previous.categories.filter((category) => category !== slug)
        : multipleCategories
          ? [...previous.categories, slug].slice(0, MAX_CATEGORIES)
          : [slug];
      return {
        ...previous,
        categories,
        subcategory: categories.includes(UNIVERSITY_CATEGORY) ? previous.subcategory : undefined,
      };
    });
  }

  function apply() {
    if (!pricesValid || !distanceValid || pending) return;
    onApply({
      ...draft,
      categories: [...draft.categories],
      subcategory: draft.categories.includes(UNIVERSITY_CATEGORY) ? draft.subcategory : undefined,
      ...(showDistance && draft.nearby ? { radiusMeters } : {}),
    });
    nextFocus.current = "trigger";
    setPanel("closed");
  }

  return (
    <>
    <Dialog.Root
      open={panel === "filters"}
      onOpenChange={(next) => {
        if (next) {
          setDraft({ ...value, categories: [...value.categories] });
          nextFocus.current = "initial";
        } else nextFocus.current = "trigger";
        setPanel(next ? "filters" : "closed");
      }}
    >
      <Dialog.Trigger asChild>
        <button
          type="button"
          ref={triggerRef}
          disabled={pending}
          data-testid="discovery-filters-trigger"
          className={cn("discovery-control relative w-full", activeCount > 0 && "discovery-active")}
        >
          <SlidersHorizontal aria-hidden="true" className="h-5 w-5" />
          <span>Filtros{activeCount > 0 && <span className="ml-1 text-xs">({activeCount})</span>}</span>
          <ChevronDown aria-hidden="true" className="absolute right-4 h-4 w-4" />
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/35" />
        <Dialog.Content
          data-modal-open="true"
          onOpenAutoFocus={(event) => {
            if (nextFocus.current === "location") {
              event.preventDefault();
              locationButtonRef.current?.focus();
            }
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (nextFocus.current === "trigger") {
              restoreTriggerFocus.current = Boolean(triggerRef.current?.disabled);
              if (!restoreTriggerFocus.current) triggerRef.current?.focus({ preventScroll: true });
            }
          }}
          className="discovery-dialog fixed bottom-0 left-0 right-0 z-[81] mx-auto flex max-h-[90dvh] max-w-xl flex-col rounded-t-3xl bg-[color:var(--card)] text-[color:var(--fg)] outline-none sm:bottom-auto sm:top-1/2 sm:-translate-y-1/2 sm:rounded-3xl"
        >
          <div className="flex shrink-0 items-center justify-between gap-3 px-5 pt-4">
            <Dialog.Title className="font-heading text-xl font-bold">Filtros</Dialog.Title>
            <Dialog.Close asChild>
              <button type="button" aria-label="Cerrar filtros" className="discovery-control min-w-12 px-2">
                <X aria-hidden="true" className="h-5 w-5" />
              </button>
            </Dialog.Close>
          </div>
          <Dialog.Description className="shrink-0 px-5 text-sm text-[color:var(--fg-muted)]">
            Elige lo que quieres ver y pulsa Aplicar.
          </Dialog.Description>
          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 py-4">
            {showLocation && (
              <section aria-label="Ubicación de búsqueda" className="space-y-2">
                <button
                  ref={locationButtonRef}
                  type="button"
                  aria-label="Cambiar ubicación"
                  className="discovery-control w-full justify-start text-left"
                  onClick={() => {
                    nextFocus.current = "location";
                    setPanel("location");
                  }}
                >
                  <MapPin aria-hidden="true" className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block">Ubicación</span>
                    <span className="block text-xs font-normal text-[color:var(--fg-muted)]">
                      {initialPosition ? `${initialPosition.name ?? "Zona actual"} · ${(initialPosition.radius ?? 10000) / 1000} km` : "Todo México"}
                    </span>
                  </span>
                  <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0" />
                </button>
                <p className="text-xs text-[color:var(--fg-muted)]">Confirma la zona con Aplicar ubicación. Tus filtros se conservan al volver.</p>
              </section>
            )}
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Publicaciones</legend>
              <div className="grid grid-cols-3 gap-2">
                {([["", "Todo"], ["producto", "Productos"], ["servicio", "Servicios"]] as const).map(([tipo, label]) => (
                  <button
                    key={tipo}
                    type="button"
                    aria-pressed={draft.tipo === tipo}
                    onClick={() => setDraft((previous) => ({ ...previous, tipo }))}
                    className={cn("discovery-control relative px-2", draft.tipo === tipo && "discovery-active")}
                  >
                    {label}
                    {draft.tipo === tipo && <Check aria-hidden="true" data-selected-indicator className="absolute right-1.5 top-1.5 h-3 w-3" />}
                  </button>
                ))}
              </div>
            </fieldset>
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Categorías</legend>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={draft.categories.length === 0}
                  className={cn("discovery-control justify-start", draft.categories.length === 0 && "discovery-active")}
                  onClick={() => setDraft((previous) => ({ ...previous, categories: [], subcategory: undefined }))}
                >
                  Todas
                  {draft.categories.length === 0 && <Check aria-hidden="true" data-selected-indicator className="ml-auto h-4 w-4 shrink-0" />}
                </button>
                {!multipleCategories && (
                  <button
                    type="button"
                    disabled={!viewerUniversity}
                    aria-describedby={!viewerUniversity ? universityHelpId : undefined}
                    aria-pressed={draft.categories.includes(UNIVERSITY_CATEGORY)}
                    onClick={() => toggleCategory(UNIVERSITY_CATEGORY)}
                    className={cn("discovery-control justify-start", draft.categories.includes(UNIVERSITY_CATEGORY) && "discovery-active")}
                  >
                    Universidad
                    {draft.categories.includes(UNIVERSITY_CATEGORY) && <Check aria-hidden="true" className="ml-auto h-4 w-4 shrink-0" />}
                  </button>
                )}
                {VISIBLE_CATEGORIES.map((category) => {
                  const selected = draft.categories.includes(category.slug);
                  return (
                    <button
                      key={category.slug}
                      type="button"
                      data-categoria-slug={category.slug}
                      aria-pressed={selected}
                      disabled={multipleCategories && !selected && draft.categories.length >= MAX_CATEGORIES}
                      onClick={() => toggleCategory(category.slug)}
                      className={cn("discovery-control justify-start text-left", selected && "discovery-active")}
                    >
                      <span className="min-w-0 flex-1">{category.name}</span>
                      {selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0" />}
                    </button>
                  );
                })}
              </div>
              {!multipleCategories && !viewerUniversity && (
                <p id={universityHelpId} className="mt-2 text-xs text-[color:var(--fg-muted)]">
                  Universidad requiere una universidad verificada en tu cuenta.
                </p>
              )}
              {multipleCategories && <p className="mt-2 text-xs text-[color:var(--fg-muted)]">Puedes combinar hasta 10 categorías.</p>}
            </fieldset>
            {draft.categories.includes(UNIVERSITY_CATEGORY) && (
              <label className="block text-sm font-semibold">
                Categoría en tu universidad
                <select
                  value={draft.subcategory ?? ""}
                  onChange={(event) => setDraft((previous) => ({ ...previous, subcategory: event.target.value || undefined }))}
                  className="discovery-input mt-2"
                >
                  <option value="">Todas</option>
                  {VISIBLE_CATEGORIES.map((category) => <option key={category.slug} value={category.slug}>{category.name}</option>)}
                </select>
              </label>
            )}
            <fieldset>
              <legend className="mb-2 text-sm font-semibold">Precio (MXN)</legend>
              <div className="grid grid-cols-2 gap-3">
                {(["priceMin", "priceMax"] as const).map((key) => (
                  <label key={key} className="text-sm">
                    {key === "priceMin" ? "Mínimo" : "Máximo"}
                    <input
                      aria-label={key === "priceMin" ? "Precio mínimo" : "Precio máximo"}
                      aria-invalid={!pricesValid || undefined}
                      aria-describedby={!pricesValid ? priceErrorId : undefined}
                      type="number"
                      inputMode="decimal"
                      min={0}
                      max={99999999}
                      step="any"
                      value={draft[key]}
                      onChange={(event) => setDraft((previous) => ({ ...previous, [key]: event.target.value }))}
                      className="discovery-input mt-1"
                    />
                  </label>
                ))}
              </div>
              {!pricesValid && <p id={priceErrorId} role="alert" className="mt-2 text-sm">Revisa los precios: usa importes positivos y un máximo mayor o igual al mínimo.</p>}
            </fieldset>
            {showSort && (
              <label className="block text-sm font-semibold">
                Ordenar por
                <select value={draft.sort ?? "newest"} onChange={(event) => setDraft((previous) => ({ ...previous, sort: event.target.value }))} className="discovery-input mt-2">
                  <option value="newest">Más recientes</option>
                  <option value="price_asc">Precio: menor a mayor</option>
                  <option value="price_desc">Precio: mayor a menor</option>
                  <option value="most_sold">Más vendidos</option>
                </select>
              </label>
            )}
            {showDistance && (
              <fieldset className="space-y-3">
                <legend className="text-sm font-semibold">Distancia</legend>
                <label className="flex min-h-12 items-center gap-3 text-sm">
                  <input type="checkbox" checked={Boolean(draft.nearby)} onChange={(event) => setDraft((previous) => ({ ...previous, nearby: event.target.checked }))} />
                  Limitar al radio elegido
                </label>
                {draft.nearby && (
                  <label className="block text-sm">
                    Radio: {radiusMeters / 1000} km
                    <input
                      aria-label="Radio de búsqueda en kilómetros"
                      type="range"
                      min={1}
                      max={50}
                      step={1}
                      value={radiusMeters / 1000}
                      onChange={(event) => setDraft((previous) => ({ ...previous, radiusMeters: Number(event.target.value) * 1000 }))}
                      className="mt-2 min-h-12 w-full"
                    />
                  </label>
                )}
              </fieldset>
            )}
          </div>
          <div className="flex shrink-0 gap-2 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
            <button
              type="button"
              className="discovery-control px-3"
              onClick={() => setDraft({ categories: [], tipo: "", priceMin: "", priceMax: "", sort: "newest", nearby: false, radiusMeters: value.radiusMeters })}
            >Limpiar</button>
            <Dialog.Close asChild><button type="button" className="discovery-control px-3">Cancelar</button></Dialog.Close>
            <button type="button" disabled={!pricesValid || !distanceValid || pending} className="discovery-control discovery-active flex-1" onClick={apply}>Aplicar</button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
    {panel === "location" && (
      <ChangeLocationSheet
        open
        initialPositionOverride={initialPosition}
        onClose={() => setPanel("filters")}
      />
    )}
    </>
  );
}
