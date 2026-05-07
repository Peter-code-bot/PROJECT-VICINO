"use client";

import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "vicino:search-history";
const MAX_ENTRIES = 10;

export interface SearchHistoryEntry {
  query: string;
  timestamp: number;
}

function readStorage(): SearchHistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (e): e is SearchHistoryEntry =>
          typeof e === "object" &&
          e !== null &&
          typeof (e as SearchHistoryEntry).query === "string" &&
          typeof (e as SearchHistoryEntry).timestamp === "number"
      )
      .slice(0, MAX_ENTRIES);
  } catch {
    // Malformed JSON / storage unavailable — silent degrade.
    return [];
  }
}

function writeStorage(entries: SearchHistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // Quota exceeded / private browsing / storage blocked — silent degrade.
  }
}

interface UseSearchHistoryReturn {
  history: SearchHistoryEntry[];
  addQuery: (query: string) => void;
  removeQuery: (query: string) => void;
  clearAll: () => void;
}

/**
 * Per-device search history backed by localStorage under
 * `vicino:search-history`. FIFO max 10 entries; if a query is added that
 * already exists, it is moved to the top with a refreshed timestamp instead
 * of being duplicated. Hydrates from storage on mount, so SSR renders an
 * empty list (matches non-mounted UI of the dropdown — closed by default).
 */
export function useSearchHistory(): UseSearchHistoryReturn {
  const [history, setHistory] = useState<SearchHistoryEntry[]>([]);

  // Hydrate from localStorage on mount. SSR-safe (server gets [] which makes
  // the dropdown render as null per its history.length === 0 check).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage hydration; can't read storage during render
    setHistory(readStorage());
  }, []);

  const addQuery = useCallback((query: string) => {
    const trimmed = query.trim();
    if (!trimmed) return;
    setHistory((prev) => {
      const withoutDup = prev.filter((e) => e.query !== trimmed);
      const next = [
        { query: trimmed, timestamp: Date.now() },
        ...withoutDup,
      ].slice(0, MAX_ENTRIES);
      writeStorage(next);
      return next;
    });
  }, []);

  const removeQuery = useCallback((query: string) => {
    setHistory((prev) => {
      const next = prev.filter((e) => e.query !== query);
      writeStorage(next);
      return next;
    });
  }, []);

  const clearAll = useCallback(() => {
    writeStorage([]);
    setHistory([]);
  }, []);

  return { history, addQuery, removeQuery, clearAll };
}
