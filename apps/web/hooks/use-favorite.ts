"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { toggleFavorite } from "@/app/(marketplace)/favoritos/actions";
import { useMuroSesion } from "@/components/auth/muro-sesion";
import { useFavorites } from "@/components/layout/favorites-provider";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";

/** All controls for a product share both optimistic state and an in-flight lock. */
export function useFavorite(productId: string, initialFavorite: boolean) {
  const favorites = useFavorites();
  const localLock = useRef(false);
  const [local, setLocal] = useState(initialFavorite);
  const isFavorite = favorites.ready ? favorites.has(productId) : local;
  const setFavorite = (value: boolean) => favorites.ready
    ? favorites.setFavorite(productId, value) : setLocal(value);
  const { pedirSesion } = useMuroSesion();
  const { mutate, isPending } = useOptimisticMutation(toggleFavorite, {
    onMutate: () => {
      const previous = isFavorite;
      setFavorite(!previous);
      return () => setFavorite(previous);
    },
    onSuccess: result => {
      if (typeof result.isFavorite === "boolean") setFavorite(result.isFavorite);
    },
    onError: () => toast.error("No se pudo actualizar tus favoritos. Intenta de nuevo."),
  });
  async function toggle() {
    if (localLock.current || favorites.pending(productId)) return;
    if (!pedirSesion("Inicia sesión para guardar tus favoritos")) return;
    if (!favorites.acquire(productId)) return;
    localLock.current = true;
    try { await mutate(productId); }
    finally { localLock.current = false; favorites.release(productId); }
  }
  return { isFavorite, isPending: isPending || favorites.pending(productId), toggle };
}
