"use client";

import { useEffect, useState, useCallback } from "react";
import { iconoDeCategoria } from "@/lib/categories/icons";
import { createClient } from "@/lib/supabase/client";
import type { Database } from "@/types/database.types";
import { CATEGORIES } from "@vicino/shared";
import { RequestCard, type RequestCardData } from "./request-card";
import { CreateRequestDrawer } from "./create-request-drawer";
import {
  Plus,
  Inbox,
} from "lucide-react";
import { cn } from "@/lib/utils";



interface SolicitudesFeedProps {
  userLat: number | null;
  userLng: number | null;
  radiusMeters: number;
  userId: string | null;
}

/**
 * La fila TAL COMO la declara el RPC generado. Antes esto era un tipo escrito
 * a mano con `[k: string]: unknown`, y ese indice borraba el tipo real de los
 * otros once campos — con lo cual el spread de abajo necesitaba un
 * `as unknown as` para recuperarlos. O sea que el cast que hacia falta me lo
 * habia fabricado yo al destruir la entrada. Con el tipo generado, el spread
 * compila solo: los campos del RPC son mas estrechos que los de la tarjeta.
 */
type FilaCruda =
  Database["public"]["Functions"]["feed_nearby_requests"]["Returns"][number];

/**
 * Convierte una fila de feed_nearby_requests en una tarjeta, comprobando las
 * dos columnas que la base entrega como jsonb.
 *
 * Devuelve null si la forma no encaja. Descartar una fila rara es mejor que
 * pintarla: lo segundo revienta en `buyer_profile.nombre` a mitad del render
 * y se lleva por delante el feed entero.
 */
function aSolicitud(fila: FilaCruda): RequestCardData | null {
  const perfil = fila.buyer_profile;
  if (!perfil || typeof perfil !== "object" || Array.isArray(perfil)) return null;
  const p = perfil as Record<string, unknown>;
  if (typeof p.nombre !== "string") return null;

  const cats = Array.isArray(fila.categories) ? fila.categories : [];
  const categories = cats.flatMap((c) => {
    if (!c || typeof c !== "object" || Array.isArray(c)) return [];
    const o = c as Record<string, unknown>;
    return typeof o.slug === "string" && typeof o.nombre === "string"
      ? [{ slug: o.slug, nombre: o.nombre }]
      : [];
  });

  return {
    ...fila,
    buyer_profile: {
      nombre: p.nombre,
      avatar_url: typeof p.avatar_url === "string" ? p.avatar_url : null,
    },
    categories,
  };
}

export function SolicitudesFeed({ userLat, userLng, radiusMeters, userId }: SolicitudesFeedProps) {
  const [requests, setRequests] = useState<RequestCardData[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchRequests = useCallback(async () => {
    if (userLat === null || userLng === null) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("feed_nearby_requests", {
      user_lat: userLat,
      user_lng: userLng,
      radius_meters: radiusMeters,
      result_limit: 50,
      // El RPC declara el parametro opcional, o sea `string | undefined`;
      // activeCategory es `string | null`. null y undefined no son lo mismo
      // para PostgREST: undefined omite el parametro y deja actuar su valor
      // por defecto.
      cat_slug: activeCategory ?? undefined,
    });

    if (!error && data) {
      // El RPC devuelve buyer_profile y categories como Json, que es lo que
      // son en la base. Un `as` los daria por buenos sin mirarlos; esto los
      // COMPRUEBA, y una fila con forma rara se descarta en vez de reventar
      // la tarjeta al pintarla.
      setRequests(data.flatMap((fila) => aSolicitud(fila) ?? []));
    }
    setLoading(false);
  }, [userLat, userLng, radiusMeters, activeCategory]);

  useEffect(() => {
    fetchRequests();
  }, [fetchRequests]);

  const hasLocation = userLat !== null && userLng !== null;

  // Filter categories to show only relevant ones (products + services)
  const visibleCategories = CATEGORIES.filter((c) => !c.hidden_in_form);

  return (
    <div className="w-full">
      {/* ─── Category carousel ─────────────────────────── */}
      <div className="px-4 pb-3 overflow-x-auto scrollbar-hide">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setActiveCategory(null)}
            className={cn(
              "shrink-0 rounded-full px-4 py-2 text-sm font-medium transition-all",
              activeCategory === null
                ? "category-tile-selected"
                : "product-card-custom hover:opacity-90"
            )}
          >
            Todas
          </button>
          {visibleCategories.map((cat) => {
            const Icon = iconoDeCategoria(cat.slug);
            return (
              <button
                key={cat.slug}
                type="button"
                onClick={() => setActiveCategory(cat.slug === activeCategory ? null : cat.slug)}
                className={cn(
                  "shrink-0 flex items-center gap-1.5 rounded-full px-4 py-2 text-sm font-medium transition-all whitespace-nowrap",
                  activeCategory === cat.slug
                    ? "category-tile-selected"
                    : "product-card-custom hover:opacity-90"
                )}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span>{cat.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ─── Feed content ──────────────────────────────── */}
      <div className="px-4 space-y-3 pb-28">
        {!hasLocation && (
          <div className="py-16 text-center">
            <p className="text-muted-foreground text-sm">
              Activa tu ubicación para ver solicitudes cerca de ti.
            </p>
          </div>
        )}

        {hasLocation && loading && (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-28 rounded-2xl bg-card border border-border/50 animate-pulse"
              />
            ))}
          </div>
        )}

        {hasLocation && !loading && requests.length === 0 && (
          <div className="py-16 text-center space-y-3">
            <div className="inline-flex h-14 w-14 items-center justify-center rounded-2xl bg-muted">
              <Inbox className="h-7 w-7 text-muted-foreground" />
            </div>
            <p className="text-muted-foreground text-sm font-medium">
              No hay solicitudes cerca de ti
            </p>
            <p className="text-muted-foreground/70 text-xs">
              Sé el primero en publicar lo que necesitas
            </p>
          </div>
        )}

        {hasLocation && !loading && requests.map((req) => (
          <RequestCard key={req.id} data={req} />
        ))}
      </div>

      {/* ─── Floating Action Button ────────────────────── */}
      {userId && (
        <button
          type="button"
          onClick={() => setDrawerOpen(true)}
          className="fixed bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-lg shadow-foreground/20 transition-transform hover:scale-105 active:scale-95"
          aria-label="Crear solicitud"
        >
          <Plus className="h-6 w-6" strokeWidth={2.5} />
        </button>
      )}

      {/* ─── Create Request Drawer ─────────────────────── */}
      {drawerOpen && (
        <CreateRequestDrawer
          onClose={() => setDrawerOpen(false)}
          onCreated={() => {
            setDrawerOpen(false);
            fetchRequests();
          }}

        />
      )}
    </div>
  );
}
