"use client";

import { useEffect, useState, useCallback } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES } from "@vicino/shared";
import { RequestCard, type RequestCardData } from "./request-card";
import { CreateRequestDrawer } from "./create-request-drawer";
import { Plus, Inbox } from "lucide-react";
import { cn } from "@/lib/utils";

interface SolicitudesFeedProps {
  userLat: number | null;
  userLng: number | null;
  radiusMeters: number;
  userId: string | null;
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
      cat_slug: activeCategory,
    });

    if (!error && data) {
      setRequests(data as RequestCardData[]);
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
              "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors border",
              activeCategory === null
                ? "bg-foreground text-background border-foreground"
                : "bg-transparent text-muted-foreground border-border hover:border-foreground/30"
            )}
          >
            Todas
          </button>
          {visibleCategories.map((cat) => (
            <button
              key={cat.slug}
              type="button"
              onClick={() => setActiveCategory(cat.slug === activeCategory ? null : cat.slug)}
              className={cn(
                "shrink-0 rounded-full px-4 py-1.5 text-sm font-medium transition-colors border whitespace-nowrap",
                activeCategory === cat.slug
                  ? "bg-foreground text-background border-foreground"
                  : "bg-transparent text-muted-foreground border-border hover:border-foreground/30"
              )}
            >
              {cat.name}
            </button>
          ))}
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
          className="fixed bottom-24 right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background shadow-lg shadow-foreground/20 transition-transform hover:scale-105 active:scale-95"
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
          userLat={userLat}
          userLng={userLng}
        />
      )}
    </div>
  );
}
