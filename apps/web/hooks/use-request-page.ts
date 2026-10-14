"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { appendRequestPage, decodeRequestPage, REQUEST_PAGE_SIZE, type RequestCursor } from "@/lib/solicitudes/request-feed";
import type { RequestCardData } from "@/components/solicitudes/request-card";
import { useSessionUI } from "@/components/layout/session-data-provider";

export interface RequestZone { lat: number; lng: number; radius: number; cacheScope?: string }
/** Each mounted scope owns its cursor. Cleanup fences out late responses. */
export function useRequestPage(zone: RequestZone, category: string | null) {
  const [saved, save] = useSessionUI<{ requests: RequestCardData[]; cursor: RequestCursor | null; hasMore: boolean } | null>(`request-page:${zone.cacheScope ?? `${zone.lat}:${zone.lng}:${zone.radius}`}:${category ?? "all"}`, null);
  const restored = useRef(saved);
  const saveRef = useRef(save);
  const [requests, setRequests] = useState<RequestCardData[]>(saved?.requests ?? []);
  const [loading, setLoading] = useState(!saved);
  const [error, setError] = useState(false);
  const [hasMore, setHasMore] = useState(saved?.hasMore ?? false);
  const cursor = useRef<RequestCursor | null>(saved?.cursor ?? null);
  const requestsRef = useRef(requests);
  const generation = useRef(0);
  const busy = useRef(false);
  const { lat, lng, radius } = zone;
  const fetchPage = useCallback(async (reset = false) => {
    if (busy.current && !reset) return;
    if (reset) { generation.current++; cursor.current = null; setRequests([]); setHasMore(false); }
    const currentGeneration = generation.current;
    busy.current = true;
    setLoading(true);
    setError(false);
    try {
      const { data, error: rpcError } = await createClient().rpc("feed_nearby_requests_v2", {
        user_lat: lat, user_lng: lng, radius_meters: Math.max(1000, Math.min(50000, radius)),
        cat_slug: category ?? undefined, result_limit: REQUEST_PAGE_SIZE + 1,
        cursor_time: cursor.current?.created_at, cursor_id: cursor.current?.id,
      });
      if (currentGeneration !== generation.current) return;
      if (rpcError || !data) { setError(true); return; }
      const page = decodeRequestPage(data);
      const next = reset ? page.requests : appendRequestPage(requestsRef.current, page.requests);
      requestsRef.current = next;
      setRequests(next);
      cursor.current = page.cursor;
      setHasMore(page.hasMore);
      saveRef.current({ requests: next, cursor: page.cursor, hasMore: page.hasMore });
    } catch {
      if (currentGeneration === generation.current) setError(true);
    } finally {
      if (currentGeneration === generation.current) { busy.current = false; setLoading(false); }
    }
  }, [lat, lng, radius, category]);
  useEffect(() => {
    if (!restored.current) void fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- scalar request sequence, not a DOM ref; invalidate late responses on cleanup.
    return () => { generation.current++; busy.current = false; };
  }, [fetchPage]);
  return { requests, loading, error, hasMore, loadMore: () => fetchPage(), retry: () => fetchPage(requests.length === 0) };
}
