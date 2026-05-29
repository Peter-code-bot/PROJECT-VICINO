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
      
      const unaccentedLike = `%${trimmed.replace(/[aeiouáéíóúüAEIOUÁÉÍÓÚÜ]/g, "_")}%`;

      // Full-text search on products_services to get matching titles
      const productsPromise = supabase
        .from("products_services")
        .select("titulo")
        .eq("estatus", "disponible")
        .ilike("titulo", unaccentedLike)
        .limit(4);

      // Search profiles for user names
      const usersPromise = supabase
        .from("profiles")
        .select("nombre")
        .ilike("nombre", unaccentedLike)
        .limit(2);

      const [productsRes, usersRes] = await Promise.all([productsPromise, usersPromise]);

      if (!isMounted) return;

      const titles: string[] = [];

      if (productsRes.data) {
        productsRes.data.forEach((item) => titles.push(item.titulo.toLowerCase()));
      }
      if (usersRes.data) {
        usersRes.data.forEach((item) => {
          if (item.nombre) titles.push(item.nombre.toLowerCase());
        });
      }

      const uniqueTitles = Array.from(new Set(titles)).slice(0, 5);
      setSuggestions(uniqueTitles);
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
