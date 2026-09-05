import { createElement } from "react";
import { CATEGORIES } from "@vicino/shared";
import { iconoDeCategoria } from "@/lib/categories/icons";

interface ChipCategoriaProps {
  categoria: string | null;
}

/**
 * Chip con la categoria del negocio, para la fila de datos del vendedor.
 *
 * `categoria_negocio` guarda el SLUG que se eligio en el alta —alta-vendedor
 * hace `setCategoria(c.slug)` y la accion lo pasa tal cual al RPC—, no la
 * etiqueta. Pintarlo en crudo mostraria "electrodomesticos" en vez de
 * "Electrodomesticos", asi que se traduce contra el catalogo con el mismo
 * idiom que ya usan el home y /buscar: `find(...)?.name ?? slug`. El `??`
 * importa: si algun perfil viejo guardo un valor fuera del catalogo, se ve
 * el valor en vez de desaparecer el chip.
 */
export function ChipCategoria({ categoria }: ChipCategoriaProps) {
  if (!categoria) return null;

  const etiqueta = CATEGORIES.find((c) => c.slug === categoria)?.name ?? categoria;

  return (
    <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold product-card-tab shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]">
      {/* createElement en vez de `const Icono = iconoDeCategoria(...)`: la
          regla react-hooks/static-components prohibe declarar un componente
          en el cuerpo del render. Aqui es un falso positivo (iconoDeCategoria
          devuelve siempre la misma referencia de modulo, no crea nada), pero
          los otros seis usos del helper esquivan la regla sin querer porque
          viven dentro de un .map(), y aqui no hay ninguno. */}
      {createElement(iconoDeCategoria(categoria), { className: "w-3 h-3" })}
      {etiqueta}
    </span>
  );
}
