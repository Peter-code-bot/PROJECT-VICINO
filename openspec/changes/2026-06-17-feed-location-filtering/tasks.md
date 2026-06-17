# Tasks — Feed location filtering

> Checklist ejecutable para `/opsx:apply`.
> Todas las decisiones de `design.md` estan firmadas por Pedro:
> - D-COOKIE: Cookie client-side con coords fuzzeadas (Opcion A)
> - D-RADIUS: 25 km default
> - D-UNI: Seccion universitaria filtrada por geo
> - D-EMPTY: Empty state estricto ("No hay vendedores cerca de ti")
> - D-FORM: Ubicacion obligatoria en el form de productos

## Pre-implementacion: PASO 0 (leccion institucional #3)

- [ ] **T-01 . Verificar DDL real de `profiles`** — Confirmar si las columnas se llaman `average_rating` / `reviews_count` o `average_rating_as_seller` / `reviews_count_as_seller`. Leer DDL en Supabase Studio. El RPC del feed las referencia; un nombre equivocado rompe en runtime.
- [ ] **T-02 . Verificar DDL real de `product_categories`** — Confirmar nombres de columnas: `product_id`, `category_id`, `is_primary`. Confirmar FK a `categories(id)`.
- [ ] **T-03 . Verificar cobertura de `ubicacion_geo`** — `SELECT COUNT(*) FROM products_services WHERE ubicacion_geo IS NOT NULL` vs `SELECT COUNT(*) FROM products_services WHERE estatus = 'disponible'`. Documentar el % con geo para calibrar expectativas del feed filtrado.

## Fase 1: Sincronizacion de ubicacion (cookie)

- [ ] **T-04 . Modificar `writeCache` en `useGeolocation.ts`** — Ademas del `localStorage.setItem`, escribir cookie `vicino_location` con lat/lng fuzzeadas a 3 decimales. `SameSite=Lax`, `path=/`, `max-age=31536000`. Archivo: `apps/web/hooks/useGeolocation.ts`.
- [ ] **T-05 . Agregar `router.refresh()` en `ChangeLocationSheet`** — En `commit()`, despues de `setManualPosition` y `onClose`, llamar `router.refresh()` para que el RSC re-ejecute con la cookie nueva. Archivo: `apps/web/components/home/change-location-sheet.tsx`.

## Fase 2: Base de datos (nuevo RPC)

- [ ] **T-06 . Crear migracion `feed_nearby_products`** — RPC con `ST_DWithin`, snapping a 100m, ORDER BY `created_at DESC`, JSONB embeds para `profiles` y `product_categories`. Usar nombres de columna confirmados en T-01/T-02. Radio default: 25000m (D-RADIUS). Archivo: `supabase/migrations/<timestamp>_feed_nearby_products.sql`.
- [ ] **T-07 . Validar RPC en Supabase Studio** — SQL Camino 2 (READ: schema check -> WRITE: CREATE FUNCTION -> VERIFY: call con coords de prueba y comparar shape con SELECT embebido actual). Verificar con `SET LOCAL ROLE authenticated` que RLS no bloquea la ejecucion.

## Fase 3: Feed principal (Server Component)

- [x] **T-08 . Modificar `page.tsx` para leer cookie** — Importar `cookies` de `next/headers`. Parsear `vicino_location`. Validar con `Number.isFinite` + range check. Si valida: llamar a `supabase.rpc('feed_nearby_products', {...})` con `radius_meters: 25000`. Si invalida: fallback al SELECT global existente (zero regresion). Archivo: `apps/web/app/(marketplace)/page.tsx`.
- [x] **T-09 . Filtrar seccion "Tu Universidad" por geo** — (D-UNI) Cuando la cookie existe, agregar filtro a la query de `universityProducts`: filtrar `sellerIds` para que solo incluya vendedores que tengan al menos un producto con `ubicacion_geo` dentro del radio. Alternativa: usar el mismo RPC `feed_nearby_products` con un filtro adicional de `creador_id IN (sellerIds)`. Archivo: `apps/web/app/(marketplace)/page.tsx`.
- [x] **T-10 . Empty state geo-aware** — (D-EMPTY) Cuando la cookie existe pero `all.length === 0`, mostrar un mensaje especifico: "No hay vendedores cerca de ti. Cambia tu ubicacion para explorar otra zona." con un boton que abra el `ChangeLocationSheet` o linke a `/buscar`. Distinto del empty state generico existente ("Bienvenido a VICINO... no hay productos publicados"). Archivo: `apps/web/app/(marketplace)/page.tsx`.
- [x] **T-11 . Pasar coords a `MasProductos`** — Agregar props opcionales `lat?: number`, `lng?: number` al componente. Pasar desde `page.tsx` los valores de la cookie. Archivo: `apps/web/components/home/mas-productos.tsx`.

## Fase 4: Paginacion infinita

- [x] **T-12 . Modificar `getMoreFeedProducts` en `actions.ts`** — Aceptar `lat?: number`, `lng?: number` como parametros opcionales. Si presentes: invocar `feed_nearby_products` con `cursor_time = cursor`, `radius_meters: 25000`. Si ausentes: query global actual. Archivo: `apps/web/app/(marketplace)/actions.ts`.
- [x] **T-13 . Actualizar `MasProductos` action call** — Pasar `lat`/`lng` de los props al `getMoreFeedProducts`. Archivo: `apps/web/components/home/mas-productos.tsx`.

## Fase 5: Ubicacion obligatoria en el form (D-FORM)

- [x] **T-14 . Validar ubicacion en `createProduct`** — Si `ubicLat` o `ubicLng` son null/0, retornar `{ error: "Selecciona una ubicacion para tu publicacion" }` antes del INSERT. Archivo: `apps/web/app/(marketplace)/vender/actions.ts`.
- [x] **T-15 . Bloquear submit en `product-form.tsx` sin ubicacion** — Si `locationData.lat === 0 && locationData.lng === 0`, mostrar error inline y no llamar a `createProduct`. Solo aplica a CREATE, no a EDIT (productos legacy pueden no tener geo). Archivo: `apps/web/app/(marketplace)/vender/product-form.tsx`.

## Validacion

- [ ] **V-1 . `pnpm build` local verde** — Leccion institucional #1. Sin errores de tipo.
- [ ] **V-2 . Shape comparison test** — Comparar manualmente el output del RPC `feed_nearby_products` contra el output del SELECT embebido. Los campos y tipos deben coincidir para que `ProductCarousel`, `ProductCard`, y `MasProductos` rendericen correctamente.
- [ ] **V-3 . Test de filtrado** — Configurar ubicacion "Villahermosa" via `ZoneCard`. Recargar home. Confirmar que productos de "Puebla" no aparecen. Confirmar que la seccion universitaria tambien respeta el filtro.
- [ ] **V-4 . Test de fallback** — Borrar la cookie `vicino_location` manualmente. Recargar home. Confirmar que el feed global aparece completo (zero regresion).
- [ ] **V-5 . Test de empty state** — Con ubicacion activa en zona sin productos, confirmar que aparece "No hay vendedores cerca de ti" en vez del empty state generico.
- [ ] **V-6 . Test de paginacion** — Con ubicacion activa, hacer scroll hasta "Mas productos". Confirmar que carga estrictamente productos dentro del radio, ordenados por `created_at DESC`.
- [ ] **V-7 . Test de cambio de zona** — Cambiar ubicacion en `ChangeLocationSheet`. Confirmar que el feed se actualiza sin hard-refresh (via `router.refresh()`).
- [ ] **V-8 . Test de publicacion sin ubicacion** — Intentar publicar un producto sin setear ubicacion en el mapa. Confirmar que el form muestra error y no permite el submit.
- [ ] **V-9 . Cross-viewport 375x812 + 1280x800** — Verificar que el feed filtrado y el empty state geo-aware renderiza correctamente en mobile y desktop.

## Cierre

- [ ] **T-16 . CODEX Adversarial Review Loop** — Post-implementacion obligatorio (CLAUDE.md).
- [ ] **T-17 . Leccion institucional nueva (si aplica)** — Si V-1 a V-9 revelan un patron nuevo, anadirla a `CLAUDE.md`.
- [ ] **T-18 . `/opsx:archive 2026-06-17-feed-location-filtering`** — Tras V-9 verde, archivar el change.
