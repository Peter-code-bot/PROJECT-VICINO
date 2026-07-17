# Tasks — Solicitudes (Marketplace Inverso)

- [x] **1. Base de Datos (Supabase)**
  - [x] Migración: tabla `purchase_requests` con PostGIS
  - [x] Migración: tabla pivote `purchase_request_categories`
  - [x] Migración: tabla `request_responses`
  - [x] RLS policies para las 3 tablas (incluyendo bloqueo de auto-ofertas)
  - [x] RPC `feed_nearby_requests` (basada en `feed_nearby_products`)

- [x] **2. Frontend — Tab de Navegación**
  - [x] Modificar `home-tabs.tsx` para agregar pestaña "Solicitudes"
  - [x] Modificar `page.tsx` del Home para renderizar el feed de Solicitudes en un branch ternario

- [x] **3. Frontend — Feed de Solicitudes**
  - [x] Componente `SolicitudesFeed.tsx` con carrusel de categorías
  - [x] Componente `RequestCard.tsx` (tarjeta de solicitud)
  - [x] Botón flotante FAB (`bg-foreground text-background`)

- [x] **4. Frontend — Crear Solicitud**
  - [x] Componente `CreateRequestDrawer.tsx`
  - [x] Selector multi-categoría (reutilizando lógica de `product-form.tsx`) sin requerir categoría principal
  - [x] Inserción en DB vía Supabase client con fallback para errores y subida opcional de imagen

- [x] **5. Frontend — Detalle y Ofertas**
  - [x] Página de detalle `/solicitudes/[id]/page.tsx` que es Server Component
  - [x] Lista pública de ofertas (`OffersList.tsx`) que es Client Component
  - [x] Botón "Agregar Oferta" (vendedor) / "Aceptar y Chatear" (comprador)

- [x] **6. Verificación**
  - [x] TypeScript compila sin errores
  - [x] CODEX Adversarial Review completado
  - [x] Aplicar migraciones SQL en Supabase

- [x] **7. Hotfixes de UI (Polishing)**
  - [x] Alinear color del tab "Solicitudes" con `--brand`
  - [x] Ajustar Z-index global y SafeArea para BottomNav y Botón Flotante
  - [x] Bloqueo de scroll (`overflow: hidden`) en desktop al abrir Drawer
  - [x] Ajuste Fullscreen Mobile (`100dvh`) con scroll interno habilitado para Drawer

- [x] **8. Bug Fixes Críticos (Post-Deploy)**
  - [x] Corregir bucket de Storage: `"media"` → `"product-media"`
  - [x] Corregir path de Storage: `solicitudes/{uid}/...` → `{uid}/solicitudes-...` (cumplir política hardened)
  - [x] Corregir WKT de PostGIS: `POINT(...)` → `SRID=4326;POINT(...)`
  - [x] Error handling explícito: si upload falla, no intentar INSERT
  - [x] Limpieza de archivos huérfanos: si INSERT falla tras upload exitoso, borrar imagen subida
  - [x] Extraer botón Submit fuera del scroll area (`shrink-0`) — siempre visible
  - [x] Safe area cross-platform (iOS + Android/Capacitor, confirmado `viewport-fit: cover`)
  - [x] Indicador de ubicación con reverse geocoding Nominatim + fallback graceful
  - [x] Sufijo random en filename para prevenir colisiones de milisegundo

