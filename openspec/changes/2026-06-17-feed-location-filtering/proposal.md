# Proposal — Feed location filtering

## Why

VICINO es un marketplace de proximidad, pero el feed principal ("Para ti") muestra publicaciones a nivel global. Un usuario en Villahermosa ve productos de Puebla, traicionando la promesa del producto ("Descubre lo mejor cerca de ti").

La infraestructura geo ya existe: `products_services.ubicacion_geo` (PostGIS `geography(POINT, 4326)`), indice GiST `idx_products_location`, y el RPC `nearby_products` con fuzzing de privacidad a 100m. Lo que falta es **conectar esa infraestructura al feed principal** para que los carruseles y la paginacion infinita respeten la ubicacion del usuario.

Hoy la ubicacion vive solo en `localStorage` (invisible para RSC). El feed (`page.tsx`) hace un `SELECT` global sin filtro geo. La seccion "Cerca de ti" (`LocationBar`) usa el RPC `nearby_products` client-side, pero es una isla independiente — el resto del feed sigue siendo global.

## What

Filtrar el feed completo (carruseles por categoria + paginacion infinita "Mas productos") por proximidad cuando el usuario tiene ubicacion configurada, con fallback al feed global si no la tiene.

## Scope

### IN (este change)

- Sincronizar la ubicacion del usuario a una cookie legible por RSC (hoy solo vive en `localStorage`).
- Nuevo RPC `feed_nearby_products` que filtre por `ST_DWithin`, ordene por `created_at DESC`, y retorne la misma shape que el embed actual de Supabase-js (incluyendo `profiles` y `product_categories`).
- Modificar `page.tsx` para leer la cookie y bifurcar al RPC geo cuando hay coordenadas.
- Modificar `actions.ts` (`getMoreFeedProducts`) para la paginacion filtrada por geo.
- `router.refresh()` post-cambio de ubicacion para re-ejecutar el RSC con la cookie nueva.
- Fallback global si la cookie no existe (preserva el comportamiento actual para usuarios sin ubicacion).
- Filtrar la seccion "Tu Universidad" por geo cuando hay cookie de ubicacion.
- Empty state geo-aware: "No hay vendedores cerca de ti. Cambia tu ubicacion para explorar otra zona."
- Hacer la ubicacion (`ubicacion_geo`) obligatoria en el form de creacion de productos.

### OUT (no es este change)

- Filtro geo para el feed "Siguiendo" (el usuario ya eligio explicitamente a quien seguir; no filtrarlo por geo).
- UI para cambiar el radio de busqueda (fijo en 25 km en la v1).
- Backfill de `ubicacion_geo` para productos legacy que no la tienen.
- Cambio a la seccion "Cerca de ti" (`LocationBar`) — sigue operando como isla independiente.
- Remocion de la seccion "Cerca de ti" si se determina redundante post-migration.

## Stakeholders

| Rol | Persona | Responsabilidad |
|---|---|---|
| Founder / developer | Pedro (Javier) | Aprueba spec, aplica migracion SQL en Supabase Studio, valida el feed con data real |

## Success criteria (medibles)

1. **Feed respeta ubicacion** — Un usuario con ubicacion "Villahermosa" NO ve productos cuya `ubicacion_geo` esta a mas de 25 km de distancia. Verificable cargando el home y confirmando ausencia de productos de Puebla.
2. **Fallback global funciona** — Un usuario sin ubicacion (cookie ausente) ve el mismo feed global que hoy. Zero regresion.
3. **Paginacion respeta geo** — "Mas productos" (infinite scroll) carga estrictamente productos dentro del radio, cronologicamente.
4. **Cambio de ubicacion recarga el feed** — Al cambiar zona en `ChangeLocationSheet` y cerrar, el feed se actualiza sin hard-refresh.
5. **Shape del RPC coincide con el embed** — `pnpm build` pasa sin errores de tipo; el `ProductCarousel`, `ProductCard`, y `MasProductos` renderizan correctamente con data del RPC.
6. **Privacidad geo preservada** — El RPC aplica el mismo snapping a 100m que `nearby_products` (coordenadas del usuario fuzzeadas, distancias bucketeadas).
7. **Seccion universitaria filtrada** — La seccion "Tu Universidad" solo muestra productos de compas dentro del radio geo.
8. **Empty state geo-aware** — Si no hay productos cerca, se muestra "No hay vendedores cerca de ti. Cambia tu ubicacion para explorar otra zona." en vez del empty state generico.
9. **Ubicacion obligatoria en publicacion** — Intentar publicar sin ubicacion muestra error y bloquea el submit.

## Out-of-scope failure modes

- Si la mayoria de productos no tienen `ubicacion_geo`, el feed se vacia. Esto es correcto por diseno (filtrado estricto), pero la UX del empty state ya existe en `page.tsx`. Si el vacio es inaceptable, se evalua un fallback hibrido en un change futuro.

## References

- [useGeolocation.ts](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/apps/web/hooks/useGeolocation.ts) — hook actual, guarda en localStorage
- [page.tsx](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/apps/web/app/(marketplace)/page.tsx) — feed principal, SELECT global
- [actions.ts](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/apps/web/app/(marketplace)/actions.ts) — paginacion `getMoreFeedProducts`
- [mas-productos.tsx](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/apps/web/components/home/mas-productos.tsx) — componente infinite scroll
- [change-location-sheet.tsx](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/apps/web/components/home/change-location-sheet.tsx) — sheet de cambio de ubicacion
- [fuzz_nearby_products.sql](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/supabase/migrations/20260515000001_fuzz_nearby_products.sql) — RPC existente con snapping de privacidad
- [products_services.sql](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/supabase/migrations/20260320000004_products_services.sql) — schema con `ubicacion_geo geography(POINT, 4326)` e indice GiST
