"use client";

import { publicProfileName, publicProfileSearchFilter } from "@vicino/shared";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

export function useSearchSuggestions(query: string) {
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- vaciar las sugerencias cuando la consulta baja de dos caracteres
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

      // Search the visible identity: stores by their store name, people by their name.
      const usersPromise = supabase
        .from("profiles")
        .select("nombre, es_vendedor, seller_type, nombre_negocio")
        .or(publicProfileSearchFilter(unaccentedLike))
        .limit(2);

      const [productsRes, usersRes] = await Promise.all([productsPromise, usersPromise]);

      if (!isMounted) return;

      const titles: string[] = [];

      if (productsRes.data) {
        productsRes.data.forEach((item) => titles.push(item.titulo.toLowerCase()));
      }
      if (usersRes.data) {
        usersRes.data.forEach((item) => {
          titles.push(publicProfileName(item).toLowerCase());
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
