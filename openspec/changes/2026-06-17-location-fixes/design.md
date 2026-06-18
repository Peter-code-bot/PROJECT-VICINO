# Design: Correcciones de Hiperlocalidad

## Estado y Almacenamiento
El estado sigue basándose en las cookies `vicino_location` y `vicino_radius` que ya se establecen en el cliente.

## Database (Supabase)
Se añadirá una nueva migración con la función:
`get_nearby_product_ids(user_lat, user_lng, radius_meters) RETURNS SETOF UUID`
Esta función cruza `products_services` con `ST_DWithin` de forma eficiente y devuelve solo UUIDs.

## Búsqueda
En `buscar/page.tsx`, antes de ejecutar `query.range()`, se inyectará el filtro:
`query = query.in("id", nearby_ids)`

## Rankings
`RankingsHomeStripSection` extraerá `cookieStore.get("vicino_location")?.value`. Si no existe, usará Puebla como fallback. De lo contrario, usará las coords del usuario. Si hay menos de 3 resultados, retornará `null`.
