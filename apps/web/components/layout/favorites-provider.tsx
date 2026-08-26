"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

/**
 * Estado compartido de "que productos tiene el usuario en favoritos".
 *
 * El corazon de ProductCard nacia SIEMPRE gris salvo en /favoritos, donde
 * venia forzado a true. En el home, /buscar, el perfil y la pagina del
 * vendedor nadie pasaba el dato, asi que un producto ya guardado se pintaba
 * como si no lo estuviera. El usuario lo tocaba y lo QUITABA de favoritos
 * creyendo que lo estaba anadiendo.
 *
 * Se resuelve con una sola consulta en el layout en vez de una por
 * superficie. Ademas, al ser estado compartido, el mismo producto en dos
 * carruseles distintos del home no puede quedar con corazones distintos.
 *
 * `ready` distingue "no hay favoritos" de "no hay proveedor". Sin esa
 * distincion, montar una tarjeta fuera del layout dejaria el corazon
 * apagado para siempre sin que nada lo delate — justo el tipo de fallo
 * silencioso que estamos quitando del producto.
 */
interface FavoritesValue {
  has: (productId: string) => boolean;
  setFavorite: (productId: string, value: boolean) => void;
  ready: boolean;
}

const FavoritesContext = createContext<FavoritesValue>({
  has: () => false,
  setFavorite: () => {},
  ready: false,
});

export function FavoritesProvider({
  initialIds,
  children,
}: {
  initialIds: readonly string[];
  children: ReactNode;
}) {
  const [ids, setIds] = useState<ReadonlySet<string>>(
    () => new Set(initialIds),
  );

  // Set nuevo en cada cambio, nunca mutacion del anterior: React compara por
  // identidad y un .add() sobre el mismo Set no volveria a renderizar.
  const setFavorite = useCallback((productId: string, value: boolean) => {
    setIds((prev) => {
      if (prev.has(productId) === value) return prev;
      const next = new Set(prev);
      if (value) next.add(productId);
      else next.delete(productId);
      return next;
    });
  }, []);

  const value = useMemo<FavoritesValue>(
    () => ({
      has: (productId: string) => ids.has(productId),
      setFavorite,
      ready: true,
    }),
    [ids, setFavorite],
  );

  return (
    <FavoritesContext.Provider value={value}>
      {children}
    </FavoritesContext.Provider>
  );
}

export function useFavorites(): FavoritesValue {
  return useContext(FavoritesContext);
}
