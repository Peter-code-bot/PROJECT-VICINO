"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import {
  Search, SlidersHorizontal, X,
  UtensilsCrossed, Shirt, Smartphone, Home, Sparkles,
  HeartPulse, Dumbbell, PawPrint, Baby, Car, BookOpen, Gamepad2,
  Palette, Armchair, Wrench, GraduationCap, PartyPopper, Truck,
  Code, Stethoscope, Camera, Building, Warehouse, Briefcase,
  MoreHorizontal, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { CATEGORIES } from "@vicino/shared";
import { ListingTypeSwitch } from "@/components/search/listing-type-switch";
import type { ListingType } from "@/components/search/listing-type-switch";
import { SearchHistoryDropdown } from "@/components/search/search-history-dropdown";
import { useSearchHistory } from "@/hooks/use-search-history";

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
}

export function SearchFilters({
  initialQuery,
  initialCategory,
  initialSort,
  initialTipo,
  initialPriceMin,
  initialPriceMax,
}: SearchFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [query, setQuery] = useState(initialQuery ?? "");
  const [showFilters, setShowFilters] = useState(false);
  const [isInputFocused, setIsInputFocused] = useState(false);
  const { history, addQuery, removeQuery, clearAll } = useSearchHistory();

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

  function handleHistorySelect(q: string) {
    setQuery(q);
    setIsInputFocused(false);
    addQuery(q);
    updateParams({ q, page: undefined });
  }

  // Show the history dropdown only when the input is focused, the query is
  // empty, and we actually have past searches to surface.
  const showHistoryDropdown =
    isInputFocused && query.trim() === "" && history.length > 0;

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
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca en VICINO..."
            className="w-full rounded-full border bg-background pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
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
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1 rounded-full border px-3 py-2 text-sm hover:bg-accent"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filtros</span>
        </button>
      </form>

      {/* Category quick filters */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button
          onClick={() => updateParams({ category: undefined })}
          className={cn(
            "shrink-0 rounded-full px-4 py-2 text-sm font-medium border transition-colors",
            !initialCategory
              ? "bg-primary text-primary-foreground border-primary"
              : "bg-card text-foreground border-border hover:bg-muted"
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
                "shrink-0 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium border transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card text-foreground border-border hover:bg-muted"
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
        <div className="rounded-lg border p-4 space-y-4">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Filtros</span>
            <button
              onClick={() => setShowFilters(false)}
              className="text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Price range */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Precio (MXN)
            </label>
            <div className="flex gap-2 items-center">
              <input
                type="number"
                placeholder="Mín"
                defaultValue={initialPriceMin}
                onChange={(e) =>
                  updateParams({ price_min: e.target.value || undefined })
                }
                className="w-24 rounded-md border bg-background px-2 py-1.5 text-xs"
              />
              <span className="text-muted-foreground">—</span>
              <input
                type="number"
                placeholder="Máx"
                defaultValue={initialPriceMax}
                onChange={(e) =>
                  updateParams({ price_max: e.target.value || undefined })
                }
                className="w-24 rounded-md border bg-background px-2 py-1.5 text-xs"
              />
            </div>
          </div>

          {/* Sort */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
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
              className="w-full rounded-md border bg-background px-2 py-1.5 text-xs"
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
