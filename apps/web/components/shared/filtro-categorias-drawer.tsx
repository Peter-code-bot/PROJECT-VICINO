"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, LayoutGrid, X, type LucideIcon } from "lucide-react";
import { CATEGORIES } from "@vicino/shared";
import { iconoDeCategoria } from "@/lib/categories/icons";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { cn } from "@/lib/utils";

/**
 * "una" = el filtro de /buscar, que solo sabe leer un `category` de la URL.
 * "varias" = superficies que admiten combinar categorias.
 *
 * El modo es una prop y no una constante porque las dos superficies que hoy
 * usan este componente tienen contratos distintos: forzar el mismo modo en las
 * dos rompe una de las dos, y el fallo no se ve hasta que alguien filtra.
 */
export type ModoSeleccionCategorias = "una" | "varias";

interface FiltroCategoriasDrawerProps {
  /** Lo que esta filtrado AHORA (URL o estado de quien llama), no el borrador. */
  seleccionadas: readonly string[];
  /** Se llama una sola vez, al pulsar Aplicar, con la seleccion completa. */
  onAplicar: (slugs: readonly string[]) => void;
  modo?: ModoSeleccionCategorias;
  /** Texto del boton cuando no hay filtro. */
  etiquetaVacia?: string;
  /** Titulo del panel. */
  titulo?: string;
  className?: string;
}

/**
 * Las de `hidden_in_form` no se ofrecen: son subcategorias de mayoreo que
 * existen en la tabla pero no en ningun selector del producto.
 */
const VISIBLES = CATEGORIES.filter((c) => !c.hidden_in_form);

/**
 * El `as const` del par no es decorativo: sin el, `map` produce string[][] y
 * `Object.fromEntries` cae en su sobrecarga de `any`, que se traga cualquier
 * error de forma al construir el mapa.
 */
const NOMBRE_POR_SLUG: Record<string, string> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, c.name] as const),
);

/**
 * Los iconos resueltos UNA vez, al cargar el modulo.
 *
 * No es solo ahorro: `const Icono = iconoDeCategoria(slug)` en el cuerpo del
 * componente es una llamada que devuelve un componente en cada render, y la
 * regla react-hooks/static-components lo rechaza —con razon, porque un
 * componente creado al renderizar se desmonta y se vuelve a montar en cada
 * repintado—. Aqui la tabla se construye al cargar el modulo, asi que lo que
 * el render hace es leer una propiedad y la referencia es siempre la misma.
 */
const ICONO_POR_SLUG: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, iconoDeCategoria(c.slug)] as const),
);


/**
 * Los tres cajones del catalogo. La cuadricula sigue mostrando TODAS las
 * categorias de una vez; los titulos solo parten un muro de 32 fichas en tres
 * tramos legibles.
 *
 * El reparto se calcula una vez al cargar el modulo y no en el render: si no,
 * se recorre el catalogo entero tres veces cada vez que el panel se repinta,
 * que es en cada toque de una ficha.
 */
const GRUPOS = (
  [
    { tipo: "producto", titulo: "Productos" },
    { tipo: "servicio", titulo: "Servicios" },
    { tipo: "otro", titulo: "Otros" },
  ] as const
)
  .map((g) => ({
    ...g,
    categorias: VISIBLES.filter((c) => c.type === g.tipo),
  }))
  .filter((g) => g.categorias.length > 0);

/** Texto del boton: la seleccion actual, dicha en palabras. */
function etiquetaDeSeleccion(
  seleccionadas: readonly string[],
  etiquetaVacia: string,
): string {
  if (seleccionadas.length === 0) return etiquetaVacia;
  if (seleccionadas.length === 1) {
    const slug = seleccionadas[0] ?? "";
    // Un slug que no esta en el catalogo (una URL escrita a mano) se pinta tal
    // cual. Decir "Todas las categorías" mentiria: el filtro SI esta aplicado
    // y es el que esta devolviendo cero resultados.
    return NOMBRE_POR_SLUG[slug] ?? slug;
  }
  return `${seleccionadas.length} categorías`;
}

/**
 * Boton + panel con la cuadricula completa de categorias.
 *
 * Sustituye al carrusel horizontal: en el carrusel las categorias del final
 * no existian para quien no arrastraba, y arrastrar en movil competia con el
 * gesto de cambio de pestana.
 */
export function FiltroCategoriasDrawer({
  seleccionadas,
  onAplicar,
  modo = "una",
  etiquetaVacia = "Todas las categorías",
  titulo = "Categorías",
  className,
}: FiltroCategoriasDrawerProps): React.JSX.Element {
  const [abierto, setAbierto] = useState(false);
  const [borrador, setBorrador] = useState<readonly string[]>(seleccionadas);
  const disparadorRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const tituloId = useId();

  useBodyScrollLock(abierto);

  const abrir = useCallback(() => {
    // El borrador se siembra al abrir, no en un efecto: asi el panel arranca
    // siempre de lo que esta filtrado de verdad, y descartar el panel sin
    // aplicar no deja un borrador viejo esperando la proxima apertura.
    setBorrador(seleccionadas);
    setAbierto(true);
  }, [seleccionadas]);

  const cerrar = useCallback(() => {
    setAbierto(false);
    // Devolver el foco al disparador: al cerrar, el elemento enfocado vive en
    // un nodo que se desmonta, y el foco cae al body — quien navega con
    // teclado tendria que recorrer la pagina entera para volver al filtro.
    disparadorRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!abierto) return;
    const alPulsarTecla = (e: KeyboardEvent) => {
      if (e.key === "Escape") cerrar();
    };
    document.addEventListener("keydown", alPulsarTecla);
    return () => document.removeEventListener("keydown", alPulsarTecla);
  }, [abierto, cerrar]);

  useEffect(() => {
    if (abierto) panelRef.current?.focus();
  }, [abierto]);

  function alternar(slug: string) {
    setBorrador((prev) => {
      if (modo === "una") return prev.includes(slug) ? [] : [slug];
      return prev.includes(slug)
        ? prev.filter((s) => s !== slug)
        : [...prev, slug];
    });
  }

  const etiqueta = etiquetaDeSeleccion(seleccionadas, etiquetaVacia);

  // Lectura de la tabla, NO una llamada: react-hooks/static-components rechaza
  // cualquier llamada asignada a una variable con mayuscula en el cuerpo del
  // componente, porque no puede saber si devuelve una referencia estable.
  const slugUnico = seleccionadas.length === 1 ? seleccionadas[0] : undefined;
  const IconoDelBoton =
    (slugUnico ? ICONO_POR_SLUG[slugUnico] : undefined) ?? LayoutGrid;

  return (
    <>
      <button
        ref={disparadorRef}
        type="button"
        onClick={abrir}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-2xl product-card-custom px-4 py-2.5 text-sm font-medium text-[color:var(--fg)] transition-opacity hover:opacity-90 sm:w-auto sm:min-w-[15rem]",
          className,
        )}
      >
        <IconoDelBoton className="h-4 w-4 shrink-0 text-[color:var(--brand-hi)]" />
        <span className="truncate">{etiqueta}</span>
        <ChevronDown className="ml-auto h-4 w-4 shrink-0 text-[color:var(--fg-muted)]" />
      </button>

      {/* El panel solo existe despues de un clic, o sea que nunca se pinta en
          el servidor: no hace falta detectar el montaje para el portal. */}
      {abierto &&
        createPortal(
          <div
            className="fixed inset-0 z-[60] flex items-end justify-center md:items-center"
            data-modal-open="true"
          >
            <div
              className="absolute inset-0 bg-black/50 backdrop-blur-sm"
              onClick={cerrar}
            />

            <div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-labelledby={tituloId}
              className="relative flex h-[100dvh] w-full flex-col bg-card shadow-2xl outline-none md:h-auto md:max-h-[85vh] md:max-w-2xl md:rounded-3xl"
            >
              <div className="shrink-0 pt-[calc(env(safe-area-inset-top)+0.5rem)] pb-3 md:pt-3">
                <div className="mx-auto mt-1 mb-3 h-1.5 w-12 rounded-full bg-muted-foreground/30 md:hidden" />
                <div className="flex items-center justify-between px-5">
                  <h2
                    id={tituloId}
                    className="font-heading text-lg font-bold text-foreground"
                  >
                    {titulo}
                  </h2>
                  <button
                    type="button"
                    onClick={cerrar}
                    aria-label="Cerrar"
                    className="flex h-8 w-8 items-center justify-center rounded-full bg-muted transition-colors hover:bg-muted/80"
                  >
                    <X className="h-4 w-4 text-muted-foreground" />
                  </button>
                </div>
              </div>

              <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-5 pb-4">
                {GRUPOS.map((grupo) => (
                  <div key={grupo.tipo} className="space-y-2">
                    <p className="text-xs font-semibold uppercase tracking-wide text-[color:var(--fg-dim)]">
                      {grupo.titulo}
                    </p>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                      {grupo.categorias.map((cat) => {
                        const Icono = ICONO_POR_SLUG[cat.slug] ?? LayoutGrid;
                        const elegida = borrador.includes(cat.slug);
                        return (
                          <button
                            key={cat.slug}
                            type="button"
                            aria-pressed={elegida}
                            onClick={() => alternar(cat.slug)}
                            className={cn(
                              "flex items-center gap-2 rounded-2xl px-3 py-3 text-left text-sm font-medium transition-all",
                              elegida
                                ? "category-tile-selected shadow-md"
                                : "bg-[color:var(--card-2)] text-[color:var(--fg)] hover:bg-[color:var(--brand-tint)]",
                            )}
                          >
                            <Icono className="h-4 w-4 shrink-0" />
                            <span className="min-w-0 flex-1 leading-tight">
                              {cat.name}
                            </span>
                            {elegida && <Check className="h-4 w-4 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex shrink-0 items-center gap-3 border-t border-border/30 bg-card px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] md:rounded-b-3xl">
                <button
                  type="button"
                  onClick={() => setBorrador([])}
                  disabled={borrador.length === 0}
                  className="rounded-xl px-3 py-3 text-sm font-semibold text-[color:var(--fg-muted)] transition-colors hover:text-[color:var(--fg)] disabled:opacity-40"
                >
                  Limpiar
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onAplicar(borrador);
                    cerrar();
                  }}
                  className="flex-1 rounded-xl bg-primary py-3 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90"
                >
                  Aplicar
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
