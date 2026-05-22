"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search, SlidersHorizontal, X, Navigation, Loader2,
  type LucideIcon,
  UtensilsCrossed, Shirt, Smartphone, Home, Sparkles, HeartPulse,
  Dumbbell, PawPrint, Baby, Car, BookOpen, Gamepad2, Palette,
  Armchair, Wrench, GraduationCap, PartyPopper, Truck, Code,
  Stethoscope, Camera, Building, Warehouse, Briefcase, MoreHorizontal,
} from "lucide-react";
import { CATEGORIES } from "@vicino/shared";
import { ListingTypeSwitch } from "@/components/search/listing-type-switch";
import type { ListingType } from "@/components/search/listing-type-switch";
import { SearchHistoryDropdown } from "@/components/search/search-history-dropdown";
import { useSearchHistory } from "@/hooks/use-search-history";
import { cn } from "@/lib/utils";

const CATEGORY_ICONS: Record<string, LucideIcon> = {
  comida: UtensilsCrossed,
  ropa: Shirt,
  tecnologia: Smartphone,
  hogar: Home,
  belleza: Sparkles,
  salud: HeartPulse,
  deportes: Dumbbell,
  mascotas: PawPrint,
  bebes: Baby,
  vehiculos: Car,
  libros: BookOpen,
  juguetes: Gamepad2,
  arte: Palette,
  muebles: Armchair,
  "servicios-hogar": Wrench,
  educacion: GraduationCap,
  eventos: PartyPopper,
  transporte: Truck,
  "diseno-tech": Code,
  "salud-terapias": Stethoscope,
  fotografia: Camera,
  inmuebles: Building,
  "proveedores-mayoreo": Warehouse,
  empleos: Briefcase,
  otros: MoreHorizontal,
};

interface SearchFiltersProps {
  initialQuery?: string;
  initialCategory?: string;
  initialSort?: string;
  initialTipo?: string;
  initialPriceMin?: string;
  initialPriceMax?: string;
  initialLat?: string;
}

export function SearchFilters({
  initialQuery,
  initialCategory,
  initialSort,
  initialTipo,
  initialPriceMin,
  initialPriceMax,
  initialLat,
}: SearchFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const [geoLoading, setGeoLoading] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const { history, addQuery, removeQuery, clearAll } = useSearchHistory();
  const showHistoryDropdown = isInputFocused && history.length > 0;

  const updateParams = useCallback(
    (updates: Record<string, string | undefined>) => {
      const params = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(updates)) {
        if (value) {
          params.set(key, value);
        } else {
          params.delete(key);
        }
      }
      router.push(`/buscar?${params.toString()}`);
    },
    [router, searchParams]
  );

  function handleHistorySelect(item: string) {
    setQuery(item);
    setIsInputFocused(false);
    updateParams({ q: item, page: undefined });
  }

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) addQuery(trimmed);
    setIsInputFocused(false);
    // Clear `page` so a fresh query lands on page 1 instead of a possibly
    // out-of-range page from the prior search (mirrors the listing-type
    // switch pattern below).
    updateParams({ q: trimmed || undefined, page: undefined });
  }

  function handleGeo() {
    if (!navigator.geolocation) return;
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        updateParams({
          lat: pos.coords.latitude.toString(),
          lng: pos.coords.longitude.toString(),
          radio: "5000",
        });
        setGeoLoading(false);
      },
      () => setGeoLoading(false),
      { timeout: 8000, maximumAge: 300_000 }
    );
  }

  function clearGeo() {
    updateParams({ lat: undefined, lng: undefined, radio: undefined });
  }

  return (
    <div className="w-full min-w-0 space-y-3">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        {/* Focus tracking lives on the wrapper (not the input) so keyboard
            users tabbing into history-item buttons keep the dropdown open.
            React's synthetic onFocus/onBlur bubble like focusin/focusout, so
            this catches both the input and the dropdown buttons. */}
        <div
          className="relative flex-1"
          onFocus={() => setIsInputFocused(true)}
          onBlur={(e) => {
            const next = e.relatedTarget as Node | null;
            if (next && e.currentTarget.contains(next)) return;
            // Short delay covers the mouse path on browsers where
            // relatedTarget is null on click (older Safari, etc.).
            setTimeout(() => setIsInputFocused(false), 150);
          }}
        >
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[color:var(--brand-hi)]" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca en VICINO..."
            className="w-full rounded-2xl bg-[color:var(--card-2)] pl-10 pr-4 py-2.5 text-sm text-[color:var(--fg)] placeholder:text-[color:var(--fg-dim)] outline-none shadow-[inset_0_0_0_1px_var(--border)] transition-colors focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
          />
          {showHistoryDropdown && (
            <SearchHistoryDropdown
              history={history}
              onSelect={handleHistorySelect}
              onRemove={removeQuery}
              onClearAll={clearAll}
            />
          )}
        </div>
        <button
          type="button"
          onClick={handleGeo}
          disabled={geoLoading}
          title="Cerca de mí"
          className="inline-flex items-center gap-1 rounded-full bg-[color:var(--card-2)] px-3 py-2 text-sm text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)] disabled:opacity-60"
        >
          {geoLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-[color:var(--brand-hi)]" />
          ) : (
            <Navigation className="h-4 w-4 text-[color:var(--brand-hi)]" />
          )}
          <span className="hidden sm:inline">Cerca</span>
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="inline-flex items-center gap-1 rounded-full bg-[color:var(--card-2)] px-3 py-2 text-sm text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filtros</span>
        </button>
      </form>

      {/* Badge de resultados cercanos activos */}
      {initialLat && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-[color:var(--brand-tint-strong)] px-3 py-1 text-xs font-medium text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
            <Navigation className="w-3 h-3" />
            Resultados cercanos
            <button onClick={clearGeo} className="ml-1 hover:text-[color:var(--brand)]" aria-label="Quitar filtro de ubicación">
              <X className="w-3 h-3" />
            </button>
          </span>
        </div>
      )}

      {/* Category quick filters */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button
          onClick={() => updateParams({ category: undefined })}
          className={cn(
            "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all",
            !initialCategory
              ? "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
              : "bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
          )}
        >
          Todos
        </button>
        {CATEGORIES.map((cat) => {
          const Icon = CATEGORY_ICONS[cat.slug] ?? MoreHorizontal;
          const isActive = initialCategory === cat.slug;
          return (
            <button
              key={cat.id}
              onClick={() =>
                updateParams({
                  category: isActive ? undefined : cat.slug,
                })
              }
              className={cn(
                "shrink-0 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all",
                isActive
                  ? "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                  : "bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span>{cat.name}</span>
            </button>
          );
        })}
      </div>

      {/* Listing type switch */}
      <div className="flex justify-center">
        <ListingTypeSwitch
          value={initialTipo as ListingType | undefined}
          onChange={(t) =>
            updateParams({ tipo: t ?? undefined, page: undefined })
          }
        />
      </div>

      {/* Expanded filters */}
      {showFilters && (
        <div className="space-y-4 rounded-2xl bg-[color:var(--card)] p-4 shadow-[inset_0_0_0_1px_var(--border)]">
          <div className="flex items-center justify-between">
            <span className="text-sm font-semibold text-[color:var(--fg)]">Filtros</span>
            <button
              onClick={() => setShowFilters(false)}
              className="text-[color:var(--fg-muted)] transition-colors hover:text-[color:var(--fg)]"
              aria-label="Cerrar filtros"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Price range */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-dim)]">
              Precio (MXN)
            </label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                placeholder="Mín"
                defaultValue={initialPriceMin}
                onChange={(e) =>
                  updateParams({ price_min: e.target.value || undefined })
                }
                className="w-24 rounded-md bg-[color:var(--card-2)] px-2 py-1.5 text-xs text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
              />
              <span className="text-[color:var(--fg-dim)]">—</span>
              <input
                type="number"
                placeholder="Máx"
                defaultValue={initialPriceMax}
                onChange={(e) =>
                  updateParams({ price_max: e.target.value || undefined })
                }
                className="w-24 rounded-md bg-[color:var(--card-2)] px-2 py-1.5 text-xs text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
              />
            </div>
          </div>

          {/* Sort */}
          <div className="space-y-1.5">
            <label className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-dim)]">
              Ordenar por
            </label>
            <select
              value={initialSort ?? "newest"}
              onChange={(e) =>
                updateParams({
                  sort:
                    e.target.value === "newest" ? undefined : e.target.value,
                })
              }
              className="w-full rounded-md bg-[color:var(--card-2)] px-2 py-1.5 text-xs text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] outline-none focus:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            >
              <option value="newest">Más recientes</option>
              <option value="price_asc">Precio: menor a mayor</option>
              <option value="price_desc">Precio: mayor a menor</option>
              <option value="most_sold">Más vendidos</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
