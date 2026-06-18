# Design: Location Radius Filter

## Estado y Almacenamiento (Cookies)
- Se añade un estado `radius` manejado por `useGeolocation`.
- Se almacena persistentemente en `localStorage` (como parte o junto a `vicino_last_location`) y como una cookie `vicino_radius`.
- La cookie permitirá que los Server Components (como el feed principal) puedan leer este valor en la solicitud inicial y hacer SSR preciso de los productos.

## Interfaz de Usuario
- **ChangeLocationSheet**: Se agregará un `<select>` nativo con diseño consistente debajo del input de búsqueda o del mapa. Opciones: 1, 2, 5, 10, 25, 50 km. Default: 2 km.
- **LocationBar**: Modificamos `radiusMeters` de 5000 a 1000 de forma rígida.

## Lógica Backend (page.tsx)
- Se parsea `vicino_radius` de las cookies. Si no existe o es inválido, toma 2000 (2 km).
- **Eliminación de Fallback**:
  El condicional `if (!hasLocation || feedRpcFailed)` se separará.
  Si `hasLocation` es `true` y `feedRpcFailed` es `true`, `products` se mantendrá como array vacío en lugar de inyectar productos globales, forzando la visualización del Empty State "No hay vendedores cerca de ti".
