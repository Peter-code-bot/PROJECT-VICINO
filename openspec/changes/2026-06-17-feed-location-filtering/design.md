# Design — Feed location filtering

> Este documento describe **como** se implementa el filtro geo del feed.
> El **que** y el **por que** viven en `proposal.md`.
> Decisiones con `[NEEDS CLARIFICATION]` requieren input de Pedro antes de `/opsx:apply`.

## 1. Decision: Cookie strategy (D-COOKIE) — FIRMADA

**Opcion A: Cookie client-side con coords fuzzeadas a 3 decimales.**

La ubicacion del buscador es informacion de baja sensibilidad (no revela donde vive el vendedor, que es el asset protegido por `audit-geo-privacy`). Las coords se fuzzean a 3 decimales (~111m) antes de escribirse a `document.cookie`.

## 2. Decision: Radio default (D-RADIUS) — FIRMADA

**25 km default.** Suficiente para filtrar entre ciudades, sin ser tan grande que pierda utilidad en zonas metropolitanas densas. Constante en el RPC call, facil de ajustar.

## 3. Decision: Seccion "Tu Universidad" (D-UNI) — FIRMADA

**Si, filtrar por geo.** La seccion universitaria tambien respeta la ubicacion del usuario. La implementacion filtra los `sellerIds` del SELECT de universidad usando un sub-query que verifica que al menos uno de sus productos tenga `ubicacion_geo` dentro del radio. Esto requiere un JOIN extra contra `products_services.ubicacion_geo`, pero el pool ya esta acotado por universidad.

## 3b. Decision: Comportamiento sin resultados (D-EMPTY) — FIRMADA

**Empty state estricto.** Si no hay productos cerca, el feed muestra un mensaje tipo "No hay vendedores cerca de ti. Cambia tu ubicacion para explorar otra zona." No hay fallback global.

## 3c. Decision: Ubicacion obligatoria en el form (D-FORM) — FIRMADA

**El form de productos debe exigir ubicacion.** Actualmente `ubicacion_geo` es opcional en `createProduct` y `updateProductFull` ([actions.ts:320-322](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/apps/web/app/(marketplace)/vender/actions.ts#L320-L322)). El spread condicional `...(ubicLat && ubicLng ? { ubicacion_geo: ... } : {})` permite publicar sin coordenadas.

Para que el filtro geo del feed sea util, **todos los productos nuevos deben tener `ubicacion_geo`**. Esto implica:
- Validar en `createProduct` que `ubicLat` y `ubicLng` esten presentes (retornar error si no).
- En el form UI (`product-form.tsx`), bloquear el submit si `locationData.lat === 0 && locationData.lng === 0` (estado default, sin ubicacion seteada).
- Los productos existentes sin geo seguiran apareciendo solo en el feed global (fallback cuando no hay cookie).

> **Nota**: Los productos legacy sin `ubicacion_geo` se excluyen del feed filtrado. Un backfill no es necesario de inmediato — el flujo de publicacion asegura que todos los productos nuevos tendran geo.

## 4. Arquitectura del flujo

```
[Cliente: ZoneCard/ChangeLocationSheet]
     |
     | setManualPosition() o request() GPS
     |
     v
[useGeolocation.writeCache()]
     |
     +-- localStorage.setItem("vicino_last_location", {lat, lng})
     +-- document.cookie = "vicino_location=lat,lng; path=/; max-age=31536000; SameSite=Lax"
     |
     v
[router.refresh()]    <-- NUEVO: fuerza re-render del RSC
     |
     v
[page.tsx (RSC)]
     |
     +-- cookies().get("vicino_location")
     |   |
     |   +-- existe? --> supabase.rpc("feed_nearby_products", {lat, lng, radius, cursor, limit})
     |   +-- no?     --> supabase.from("products_services").select(...) (global, sin cambios)
     |
     v
[Carruseles + MasProductos]
     |
     +-- MasProductos recibe {lat?, lng?} como props
     +-- getMoreFeedProducts(cursor, limit, lat?, lng?)
         |
         +-- coords? --> supabase.rpc("feed_nearby_products", {...})
         +-- no?     --> supabase.from("products_services")... (global, sin cambios)
```

## 5. Componentes tecnicos

### 5.1 Cookie sync en `useGeolocation.ts`

Modificar `writeCache(pos: GeoPosition)` para, ademas del `localStorage.setItem`, escribir:

```typescript
// Fuzzear a 3 decimales (~111m) antes de escribir a cookie
const lat3 = pos.lat.toFixed(3);
const lng3 = pos.lng.toFixed(3);
document.cookie = `vicino_location=${lat3},${lng3}; path=/; max-age=31536000; SameSite=Lax`;
```

**No HttpOnly** (decision D-COOKIE asumiendo opcion A). `SameSite=Lax` previene envio cross-site. `max-age=1y` para persistencia.

### 5.2 `router.refresh()` en `ChangeLocationSheet`

En `commit()` (linea 248), despues de `setManualPosition()` y `onClose()`:

```typescript
import { useRouter } from "next/navigation";
// ...
const router = useRouter();
// en commit():
setManualPosition({ lat: loc.lat, lng: loc.lng });
// ... writeRecents, onClose ...
router.refresh(); // re-ejecuta el RSC con la cookie nueva
```

Tambien en `useGeolocation.request()` (GPS), pero como ese flow no cierra un sheet, el refresh puede delegarse a un `useEffect` que observe cambios en `state.position` y haga `router.refresh()` si hubo cambio real. Alternativa: dejarlo al proximo page load natural.

### 5.3 Nuevo RPC `feed_nearby_products`

```sql
CREATE OR REPLACE FUNCTION feed_nearby_products(
  user_lat      FLOAT,
  user_lng      FLOAT,
  radius_meters INT      DEFAULT 25000,
  cursor_time   TIMESTAMPTZ DEFAULT NULL,
  result_limit  INT      DEFAULT 150
)
RETURNS TABLE (
  id                UUID,
  titulo            TEXT,
  precio            NUMERIC,
  imagen_principal  TEXT,
  categoria         TEXT,
  slug              TEXT,
  created_at        TIMESTAMPTZ,
  precio_negociable BOOLEAN,
  profiles          JSONB,
  product_categories JSONB
) AS $$
  WITH snapped AS (
    SELECT
      ROUND(user_lat::numeric, 3)::FLOAT AS s_lat,
      ROUND(user_lng::numeric, 3)::FLOAT AS s_lng,
      (CEIL(radius_meters::FLOAT / 100) * 100 + 100)::INT AS s_radius
  )
  SELECT
    ps.id,
    ps.titulo,
    ps.precio,
    ps.imagen_principal,
    ps.categoria,
    ps.slug,
    ps.created_at,
    ps.precio_negociable,
    -- profiles embed: misma shape que supabase-js profiles!inner(...)
    jsonb_build_object(
      'nombre',         pr.nombre,
      'trust_level',    pr.trust_level::TEXT,
      'average_rating', pr.average_rating,
      'reviews_count',  pr.reviews_count
    ) AS profiles,
    -- product_categories embed: misma shape que supabase-js
    COALESCE(
      (SELECT jsonb_agg(
        jsonb_build_object(
          'is_primary', pc.is_primary,
          'categories', jsonb_build_object(
            'slug',   c.slug,
            'nombre', c.nombre
          )
        )
      )
      FROM product_categories pc
      JOIN categories c ON c.id = pc.category_id
      WHERE pc.product_id = ps.id),
      '[]'::jsonb
    ) AS product_categories
  FROM products_services ps
  CROSS JOIN snapped s
  JOIN profiles pr ON pr.id = ps.creador_id
  WHERE
    ps.estatus = 'disponible'
    AND ps.ubicacion_geo IS NOT NULL
    AND ST_DWithin(
          ps.ubicacion_geo,
          ST_MakePoint(s.s_lng, s.s_lat)::geography,
          s.s_radius
        )
    AND (cursor_time IS NULL OR ps.created_at < cursor_time)
  ORDER BY ps.created_at DESC
  LIMIT result_limit;
$$ LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public;

GRANT EXECUTE ON FUNCTION feed_nearby_products(FLOAT, FLOAT, INT, TIMESTAMPTZ, INT) TO anon, authenticated;
```

**Notas criticas:**
- `profiles` y `product_categories` se retornan como `JSONB`, no como relaciones embebidas. El TypeScript los recibira como `unknown`/`JsonValue`. Dado que `page.tsx` ya trata `profiles` y `product_categories` como shapes anotadas manualmente, esto funciona sin refactor.
- El correlated subquery para `product_categories` es menos eficiente que un LATERAL JOIN para sets grandes. Aceptable para limits de 150 rows. Si escala, refactorizar a LATERAL.
- `COALESCE(..., '[]'::jsonb)` evita `null` para productos sin categorias pivot — clave para que `normalizeCardCategories()` no explote.
- El snapping a 3 decimales y buffer de 100m replica el patron de `nearby_products`.

### 5.4 Lectura de cookie en `page.tsx`

```typescript
import { cookies } from "next/headers";

// Dentro de HomePage():
const cookieStore = await cookies();
const locationCookie = cookieStore.get("vicino_location")?.value;
let userLat: number | null = null;
let userLng: number | null = null;

if (locationCookie) {
  const [latStr, lngStr] = locationCookie.split(",");
  const lat = parseFloat(latStr);
  const lng = parseFloat(lngStr);
  if (Number.isFinite(lat) && Number.isFinite(lng)
      && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
    userLat = lat;
    userLng = lng;
  }
}

// Fetch "Para ti" data — bifurca
let products;
if (userLat !== null && userLng !== null) {
  const { data } = await supabase.rpc("feed_nearby_products", {
    user_lat: userLat,
    user_lng: userLng,
    radius_meters: 25000,  // D-RADIUS default
    cursor_time: null,
    result_limit: 150,
  });
  products = data ?? [];
} else {
  // Fallback global (codigo actual sin cambios)
  const { data } = await supabase.from("products_services").select(`...`).eq(...)...;
  products = data ?? [];
}
```

### 5.5 Paginacion en `actions.ts`

`getMoreFeedProducts` recibe parametros opcionales `lat?: number`, `lng?: number`:

- Si presentes: `supabase.rpc("feed_nearby_products", { user_lat, user_lng, radius_meters: 25000, cursor_time: cursor, result_limit: safeLimit })`.
- Si ausentes: la query global actual (sin cambios).

`MasProductos` pasa `lat`/`lng` como props desde `page.tsx`.

## 6. PASO 0: Verificacion de schema (Leccion institucional #3)

Antes de escribir el RPC, confirmar con DDL real:

| Tabla | Columna | Verificar |
|---|---|---|
| `profiles` | `average_rating` | Existe? O es `average_rating_as_seller`? |
| `profiles` | `reviews_count` | Existe? O es `reviews_count_as_seller`? |
| `profiles` | `nombre`, `trust_level` | Tipos correctos |
| `product_categories` | `product_id`, `category_id`, `is_primary` | Nombres correctos de FK |
| `categories` | `slug`, `nombre` | Nombres correctos |

**El RPC existente `nearby_products`** usa `pr.average_rating_as_seller` y `pr.reviews_count_as_seller`. **El SELECT del feed** usa `average_rating` y `reviews_count`. Hay que confirmar cual existe en la tabla `profiles` real — si son columnas distintas, el RPC nuevo debe usar las mismas que el feed (no las del RPC viejo).

> Esta verificacion se ejecuta como T-01 antes de escribir SQL.

## 7. Failure modes

| Failure | Sintoma | Mitigacion |
|---|---|---|
| Cookie malformada / tampered | `parseFloat` retorna NaN | Guard con `Number.isFinite` + range check. Fallback a global. |
| RPC retorna shape incompatible | TypeScript compile error o runtime crash en `ProductCard` | PASO 0 + test manual de comparacion de shapes |
| La mayoria de productos no tiene `ubicacion_geo` | Feed vacio o muy escaso | Empty state existente en `page.tsx`. Nota en proposal.md: "filtrado estricto por diseno". |
| Cookie desincronizada de localStorage | Raro (ambas se escriben en `writeCache`). Si ocurre, la cookie gana para RSC. | No hay conflicto real — la cookie es para RSC, localStorage para el hook client-side |
| `router.refresh()` causa parpadeo/flicker | El RSC se re-ejecuta, los Client Components se reconcilian | `startTransition` en el router.refresh si es necesario |
| Correlated subquery para `product_categories` lento con muchos productos | Query > 200ms para 150 rows (improbable con indice GiST + limit) | EXPLAIN ANALYZE en T-01. Si lento, refactorizar a LATERAL JOIN. |

## 8. References

- [fuzz_nearby_products.sql](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/supabase/migrations/20260515000001_fuzz_nearby_products.sql) — patron de snapping a copiar
- [products_services.sql](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/supabase/migrations/20260320000004_products_services.sql) — schema con PostGIS
- [geo/actions.ts](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/apps/web/lib/geo/actions.ts) — patron de fuzz/enforce existente
- [openspec/project.md](file:///c:/Users/10G82LA/Documents/Javier/proyectos/VICINO/PROJECT-VICINO/openspec/project.md) — workflow y reglas del proyecto
