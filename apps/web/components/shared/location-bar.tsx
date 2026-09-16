"use client";

import Link from "next/link";
import { MapPin, Loader2 } from "lucide-react";
import { useGeolocation } from "@/hooks/useGeolocation";
import { useNearbyProducts } from "@/hooks/useNearbyProducts";
import { RADIUS_DEFAULT_METERS } from "@/lib/geo/radius";
import { ProductCarousel } from "@/components/home/product-carousel";
import type { NearbyProduct } from "@/lib/geo/consulta-cercanos";
import { catalogFailure, type CatalogFailure } from "@/lib/catalogo/estado-consulta";
import { CatalogQueryState } from "./catalog-query-state";

interface LocationBarProps {
  managed?: boolean;
  /**
   * Los productos cercanos que el SERVIDOR ya trajo, leyendo la cookie
   * vicino_location al pintar el home.
   *
   * Antes esta seccion entera vivia detras de `{position && ...}`, y `position`
   * es null hasta que hidrata —useGeolocation arranca en `idle` a proposito,
   * para que el primer render coincida con el del servidor—. O sea que la
   * seccion NO EXISTIA en el HTML: aparecia tras descargar y ejecutar el JS, y
   * solo entonces pedia los productos por una server action. Dos esperas en
   * serie antes de ver una sola tarjeta, mientras «Categorias» —que es marcado
   * del servidor— ya estaba pintada.
   *
   * Con esto la seccion entra con el HTML, igual que las categorias.
   */
  productosIniciales?: NearbyProduct[];
  /** Si el servidor ya sabia que hay ubicacion, por la misma cookie. */
  hayUbicacionEnServidor?: boolean;
  initialFailure?: CatalogFailure | null;
}

export function LocationBar({
  productosIniciales = [],
  hayUbicacionEnServidor = false,
  initialFailure = null,
  managed = false,
}: LocationBarProps) {
  const { state } = useGeolocation();
  const position = state.status === "success" ? state.position : null;

  const radioMetros = position?.radius ?? RADIUS_DEFAULT_METERS;

  // El cliente sigue consultando, y no es redundante: la cookie va redondeada a
  // 3 decimales y el localStorage guarda la posicion completa, asi que cuando
  // el usuario mueve su ubicacion o cambia el radio esta es la via por la que
  // la seccion se pone al dia sin recargar. Lo que cambia es que ya no es la
  // PRIMERA vez que se ven productos, solo una actualizacion.
  const { products, loading, error, failure: clientFailure, hasLoaded } = useNearbyProducts({
    position: managed ? null : position,
    radiusMeters: radioMetros,
  });

  // Mientras el cliente no haya traido lo suyo, mandan los del servidor. Sin
  // esto la seccion parpadearia: se pintaria con los del servidor y se vaciaria
  // al hidratar, hasta que respondiese la server action.
  const visibles = hasLoaded ? products : productosIniciales;
  const failure = error ? clientFailure ?? catalogFailure(error) : hasLoaded ? null : initialFailure;
  const hayUbicacion = position !== null || hayUbicacionEnServidor;

  if (!hayUbicacion) return null;

  return (
    <div className="space-y-4">
      <div>
        <div className="mb-3">
          <div className="flex items-center gap-2">
            <MapPin className="h-4 w-4 text-[color:var(--brand-hi)]" />
            <h2 className="font-heading text-xl font-bold text-[color:var(--fg)]">Cerca de ti</h2>
            {loading && visibles.length === 0 && (
              <Loader2 className="h-4 w-4 animate-spin text-[color:var(--fg-muted)]" />
            )}
          </div>
          {visibles.length > 0 && (
            <div className="mt-1 flex justify-end">
              <Link
                href="/buscar"
                className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--brand-hi)] transition-colors hover:text-[color:var(--brand)]"
              >
                Ver más
              </Link>
            </div>
          )}
        </div>

        {failure && <CatalogQueryState failure={failure} section="los productos cercanos" />}
        {visibles.length > 0 ? (
          // Los badges de categoria ya salen, y RESULTO NO NECESITAR NADA DE
          // SQL. El TODO que vivia aqui daba tres pasos y el primero era
          // "CREATE OR REPLACE FUNCTION nearby_products", diferido "para no
          // mezclar schema work con render-only".
          //
          // Ese paso sobraba: esta superficie hace tiempo que dejo de llamar
          // a nearby_products —que quedo huerfana— y llama a
          // search_nearby_products_v4 con sort_by_distance, cuya rama esta
          // literalmente rotulada "Rama 1: Cerca de Ti" en la funcion. Y esa
          // funcion YA devuelve product_categories en cada fila.
          //
          // O sea que los badges no faltaban por falta de datos: los datos
          // llegaban y se tiraban en el mapeo. Se pagaba el agregado en la
          // base y se descartaba antes de la pantalla.
          <ProductCarousel
            products={visibles.map((p) => ({
              id: p.id,
              titulo: p.titulo,
              precio: p.precio,
              imagen_principal: p.imagen_principal,
              categoria: p.categoria,
              slug: p.slug,
              product_categories: p.product_categories,
              profiles: {
                nombre: p.vendedor_nombre,
                trust_level: p.vendedor_trust,
                average_rating: p.vendedor_rating,
                reviews_count: p.vendedor_reviews,
              },
            }))}
          />
        ) : !loading && !failure ? (
          <p className="py-4 text-sm text-[color:var(--fg-muted)]">
            {/* El «1 km» estaba escrito a mano y llevaba mintiendo desde que
                esta seccion dejo de pedir 1.000 m y paso a usar el radio del
                usuario: con el default de 10 km, el aviso se equivocaba por
                diez. Ahora dice el radio que de verdad se consulto. */}
            Sin publicaciones en un radio de{" "}
            {radioMetros >= 1000
              ? `${Number.isInteger(radioMetros / 1000) ? radioMetros / 1000 : (radioMetros / 1000).toFixed(1)} km`
              : `${radioMetros} m`}
            .{" "}
            <Link
              href="/buscar"
              className="font-medium text-[color:var(--brand-hi)] hover:underline"
            >
              Explorar todo
            </Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}
