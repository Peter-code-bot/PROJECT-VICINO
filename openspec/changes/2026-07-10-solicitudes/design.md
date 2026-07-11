# Design — Solicitudes (Marketplace Inverso)

## Architecture

El sistema opera sobre tres tablas principales:
1. `purchase_requests`: Contiene la solicitud (título, descripción, presupuesto, geografía, fecha de expiración).
2. `purchase_request_categories`: Tabla pivote M:N que relaciona `purchase_requests` con `categories`. Utilizada para facilitar el filtrado de feed.
3. `request_responses`: Contiene las ofertas de los vendedores. Tiene un índice `UNIQUE(request_id, seller_id)` para asegurar 1 oferta máxima por vendedor por solicitud.

La lectura se hace a través de un RPC `feed_nearby_requests` que aplica filtrado por `ST_DWithin` contra las coordenadas del usuario (`ubicacion_geo`), idéntico a cómo funciona el feed principal de productos.

## UX & UI

- **Home Tabs**: Se añade un tercer tab "Solicitudes" en color verde esmeralda (`text-emerald-600`) para contrastar con los tabs globales.
- **Feed**: Renderiza tarjetas compactas (`RequestCard`) con chip de presupuesto y tags de categorías, similar a las product cards pero optimizadas para texto.
- **FAB**: El Floating Action Button para crear solicitud es inverso al tema actual (fondo foreground, ícono background).
- **Creación**: Se reutiliza la lógica del selector de categorías de `product-form.tsx` en un bottom drawer (`CreateRequestDrawer.tsx`) pero sin la obligatoriedad de una categoría "principal".
- **Ofertas**: Las ofertas son 100% públicas y visibles en la vista de detalle. Los usuarios no autenticados ven un prompt de login; los vendedores ven un formulario para ofertar; el dueño ve botones para iniciar un chat (link hacia `/chat?to={seller_id}`).

## Fallback mechanisms

- Si el usuario no tiene permisos de geolocalización o la cookie `vicino_location` no existe, el feed mostrará un *Empty State* invitando a activar la ubicación (en lugar de cargar todas las solicitudes nacionales).
- Expiración de solicitudes: Se maneja con `expires_at`. El feed filtra `expires_at > NOW()`. Opcionalmente un job de `pg_cron` (si está instalado) o un update perezoso marca como 'expired' a nivel row.

## Security

- **RLS**:
  - `purchase_requests`: Cualquiera puede SELECT donde `status = 'open'`. Solo el `buyer_id` puede INSERT, UPDATE o DELETE.
  - `request_responses`: SELECT abierto si la solicitud está 'open'. INSERT restringido a que `seller_id = auth.uid()` y que el comprador NO sea el mismo vendedor (evita auto-ofertas). UPDATE/DELETE solo por el creador de la oferta.
