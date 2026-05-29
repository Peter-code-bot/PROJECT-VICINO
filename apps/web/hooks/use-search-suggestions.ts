"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export function useSearchSuggestions(query: string) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setSuggestions([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    let isMounted = true;

    const fetchSuggestions = async () => {
      const supabase = createClient();
      
      // Full-text search on products_services to get matching titles
      const { data, error } = await supabase
        .from("products_services")
        .select("titulo")
        .eq("estatus", "disponible")
        .textSearch("search_vector", trimmed, {
          type: "websearch",
          config: "spanish",
        })
        .limit(5);

      if (!isMounted) return;

      if (error || !data) {
        setSuggestions([]);
      } else {
        // Extract unique titles, keeping them lowercase for a unified look
        const titles = Array.from(
          new Set(data.map((item) => item.titulo.toLowerCase()))
        );
        setSuggestions(titles);
      }
      setLoading(false);
    };

    // Debounce the call to avoid spamming the DB while typing
    const timeoutId = setTimeout(fetchSuggestions, 300);

    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
    };
  }, [query]);

  return { suggestions, loading };
}
