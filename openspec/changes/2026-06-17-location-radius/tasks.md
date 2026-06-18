# Tasks: Location Radius Filter

1. `hooks/useGeolocation.ts`:
   - Expandir el estado para incluir el radio.
   - Ajustar `readCache` y `writeCache` para manejar y setear la cookie `vicino_radius`.
2. `components/home/change-location-sheet.tsx`:
   - Incluir el nuevo menú desplegable.
   - Enlazar la selección con el guardado en el hook de geolocalización.
3. `app/(marketplace)/page.tsx`:
   - Extraer `vicino_radius` de `cookies()`.
   - Modificar la llamada a `feed_nearby_products` para usar ese radio en vez de 25000.
   - Quitar el `|| feedRpcFailed` del condicional del fallback.
4. `components/shared/location-bar.tsx`:
   - Cambiar de 5000 a 1000.
   - Actualizar el copy del Empty State a "1 km".
