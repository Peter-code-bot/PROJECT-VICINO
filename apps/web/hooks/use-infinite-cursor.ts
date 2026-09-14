"use client";

import { useCallback, useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";

/**
 * A5.0: cursor-based load-more hook reused by chat history (A5.1),
 * home "Mas productos" feed (A5.2), and future load-more surfaces
 * (historial, MED follow-up).
 *
 * Generic over <T> (item shape) and <C> (cursor shape). The Server
 * Action receives { cursor, limit } and returns { items, nextCursor }
 * where nextCursor === null signals "no more pages".
 *
 * Two modes via opts.prepend:
 *  - prepend: false (default) -- items append to the bottom (home, historial)
 *  - prepend: true            -- items prepend to the top (chat older)
 *
 * Imperative API for live inserts that should NOT consume the cursor:
 *  - appendLive(item): new mutation result lands at the bottom (chat
 *    Realtime INSERT, chat send success).
 *  - prependLive(item): rare case where a live insert belongs at the
 *    top; exposed for symmetry.
 *  - removeItem(predicate): drop one or more items (optimistic
 *    rollback, temp-id reclaim before real-id swap).
 *  - setItems(updater): escape hatch for complex cases the three
 *    imperatives above cannot express cleanly. Used by chat-window
 *    for the FIFO temp-id -> real-id swap and for Realtime UPDATE
 *    events (mark-as-read). DOES NOT consume or advance the cursor.
 *
 * Per design.md: SIN useTransition (no rollback concern), SIN
 * AbortController (mountedRef guards setState after unmount; in-flight
 * dedup via inFlightRef collapses rapid IntersectionObserver fires).
 */

export type CursorLoadResult =
  | { status: "loaded"; hasMore: boolean }
  | { status: "failed"; error: string; code?: string; retryAfter?: number }
  | { status: "skipped" };

export type CursorAction<T, C> = (input: {
  cursor: C | null;
  limit: number;
}) => Promise<{ items: T[]; nextCursor: C | null; error?: string; code?: string; retryAfter?: number }>;

export interface UseInfiniteCursorOptions<T, C> {
  action: CursorAction<T, C>;
  initialItems: T[];
  initialCursor: C | null;
  limit?: number;
  prepend?: boolean;
  getKey?: (item: T) => string;
}

export interface UseInfiniteCursorResult<T> {
  items: T[];
  isLoading: boolean;
  hasMore: boolean;
  error: string | null;
  loadMore: () => Promise<CursorLoadResult>;
  prependLive: (item: T) => void;
  appendLive: (item: T) => void;
  removeItem: (predicate: (item: T) => boolean) => void;
  setItems: Dispatch<SetStateAction<T[]>>;
}

const DEFAULT_LIMIT = 30;

export function useInfiniteCursor<T, C>(
  opts: UseInfiniteCursorOptions<T, C>,
): UseInfiniteCursorResult<T> {
  const { action, initialItems, initialCursor, limit = DEFAULT_LIMIT, prepend = false, getKey } = opts;

  const [items, setItems] = useState<T[]>(initialItems);
  const [cursor, setCursor] = useState<C | null>(initialCursor);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mountedRef = useRef(true);
  const inFlightRef = useRef(false);
  // Mirror cursor into a ref so loadMore can read the latest value
  // without depending on it (keeps the callback stable across renders
  // and avoids tearing down the IntersectionObserver every load).
  const cursorRef = useRef<C | null>(initialCursor);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const loadMore = useCallback(async (): Promise<CursorLoadResult> => {
    if (inFlightRef.current || cursorRef.current === null) return { status: "skipped" };
    inFlightRef.current = true;
    setIsLoading(true);
    setError(null);

    try {
      const result = await action({ cursor: cursorRef.current, limit });
      if (!mountedRef.current) return { status: "skipped" };
      if (result.error) {
        setError(result.error);
        // Cursor untouched: caller can retry the same boundary.
        return { status: "failed", error: result.error, code: result.code, retryAfter: result.retryAfter };
      }
      setItems((prev) => {
        const seen = new Set(getKey ? prev.map(getKey) : []);
        const added = getKey ? result.items.filter((item) => {
          const key = getKey(item);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }) : result.items;
        return prepend ? [...added, ...prev] : [...prev, ...added];
      });
      cursorRef.current = result.nextCursor;
      setCursor(result.nextCursor);
      return { status: "loaded", hasMore: result.nextCursor !== null };
    } catch (err) {
      if (!mountedRef.current) return { status: "skipped" };
      const message = err instanceof Error && err.message ? err.message : "No se pudo cargar mas contenido";
      setError(message);
      return { status: "failed", error: message };
    } finally {
      if (mountedRef.current) setIsLoading(false);
      inFlightRef.current = false;
    }
  }, [action, getKey, limit, prepend]);

  const prependLive = useCallback((item: T) => {
    setItems((prev) => [item, ...prev]);
  }, []);

  const appendLive = useCallback((item: T) => {
    setItems((prev) => [...prev, item]);
  }, []);

  const removeItem = useCallback((predicate: (item: T) => boolean) => {
    setItems((prev) => prev.filter((item) => !predicate(item)));
  }, []);

  return {
    items,
    isLoading,
    hasMore: cursor !== null,
    error,
    loadMore,
    prependLive,
    appendLive,
    removeItem,
    setItems,
  };
}
