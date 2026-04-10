"use client";

import { useCallback, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, SlidersHorizontal, X, Navigation, Loader2 } from "lucide-react";
import { CATEGORIES } from "@vicino/shared";

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
    updateParams({ q: query || undefined });
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
    <div className="space-y-3">
      {/* Search bar */}
      <form onSubmit={handleSearch} className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Busca en VICINO..."
            className="w-full rounded-full border bg-background pl-10 pr-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary"
          />
        </div>
        <button
          type="button"
          onClick={handleGeo}
          disabled={geoLoading}
          title="Cerca de mí"
          className="flex items-center gap-1 rounded-full border px-3 py-2 text-sm hover:bg-accent disabled:opacity-60"
        >
          {geoLoading ? (
            <Loader2 className="h-4 w-4 animate-spin text-terracotta" />
          ) : (
            <Navigation className="h-4 w-4 text-terracotta" />
          )}
          <span className="hidden sm:inline">Cerca</span>
        </button>
        <button
          type="button"
          onClick={() => setShowFilters(!showFilters)}
          className="flex items-center gap-1 rounded-full border px-3 py-2 text-sm hover:bg-accent"
        >
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">Filtros</span>
        </button>
      </form>

      {/* Badge de resultados cercanos activos */}
      {initialLat && (
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full bg-terracotta/10 border border-terracotta/20 px-3 py-1 text-xs font-medium text-terracotta">
            <Navigation className="w-3 h-3" />
            Resultados cercanos
            <button onClick={clearGeo} className="ml-1 hover:text-terracotta-dark" aria-label="Quitar filtro de ubicación">
              <X className="w-3 h-3" />
            </button>
          </span>
        </div>
      )}

      {/* Category quick filters */}
      <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
        <button
          onClick={() => updateParams({ category: undefined })}
          className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
            !initialCategory
              ? "bg-primary text-primary-foreground border-primary"
              : "hover:bg-accent"
          }`}
        >
          Todos
        </button>
        {CATEGORIES.map((cat) => (
          <button
            key={cat.id}
            onClick={() =>
              updateParams({
                category:
                  initialCategory === cat.slug ? undefined : cat.slug,
              })
            }
            className={`shrink-0 rounded-full px-3 py-1 text-xs font-medium border transition-colors ${
              initialCategory === cat.slug
                ? "bg-primary text-primary-foreground border-primary"
                : "hover:bg-accent"
            }`}
          >
            {cat.name}
          </button>
        ))}
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

          {/* Type */}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              Tipo
            </label>
            <div className="flex gap-2">
              {[
                { value: undefined, label: "Todos" },
                { value: "producto", label: "Productos" },
                { value: "servicio", label: "Servicios" },
              ].map((opt) => (
                <button
                  key={opt.label}
                  onClick={() => updateParams({ tipo: opt.value })}
                  className={`rounded-md px-3 py-1.5 text-xs border ${
                    initialTipo === opt.value ||
                    (!initialTipo && !opt.value)
                      ? "bg-primary text-primary-foreground border-primary"
                      : "hover:bg-accent"
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
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
