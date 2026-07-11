# Proposal — Solicitudes (Marketplace Inverso)

## Why

VICINO es un marketplace de proximidad, pero actualmente solo funciona en una dirección: los vendedores publican productos y servicios, y los compradores los buscan. 
Existe una oportunidad latente donde un comprador necesita algo específico (ej. "Busco un plomero para hoy" o "Busco quien venda cartuchos de tinta HP 664") pero no lo encuentra inmediatamente en el feed o prefiere que los vendedores le ofrezcan opciones. 
Implementar un "Marketplace Inverso" (Solicitudes) permite a los compradores publicar lo que necesitan y a los vendedores ofrecer sus productos o servicios directamente.

## What

Crear una nueva sección "Solicitudes" en el Home (tercer tab), donde los compradores pueden publicar necesidades ("solicitudes") geolocalizadas. Los vendedores pueden ver estas solicitudes en su zona y enviar "ofertas" públicas. El comprador puede aceptar una oferta y comenzar un chat.

## Scope

### IN (este change)

- Nueva pestaña "Solicitudes" en el home-tabs.
- Base de datos (Supabase): tabla `purchase_requests` (PostGIS), tabla pivote `purchase_request_categories`, tabla `request_responses`. RLS estricto.
- Feed de solicitudes: RPC `feed_nearby_requests` que filtra por radio (25km) utilizando cookies de geolocalización.
- Modal (Drawer) de creación: Selector multi-categoría, input de presupuesto, expiración (24h, 3d, 1w), e imagen opcional.
- Botón flotante (FAB) que reacciona a modo claro/oscuro (fondo opuesto).
- Página de detalle de la solicitud con visualización de ofertas públicas.
- Formulario para que un vendedor envíe una oferta (texto + precio opcional) y botón de "Aceptar y Chatear" para el comprador.

### OUT (no es este change)

- Integración de notificaciones push cuando alguien envía una oferta.
- Historial de solicitudes en el perfil del usuario.
- Algoritmo complejo de matching (es puramente geográfico y cronológico).

## Stakeholders

| Rol | Persona | Responsabilidad |
|---|---|---|
| Founder / developer | Pedro (Javier) | Aprueba spec, aplica migración SQL en Supabase Studio |

## Success criteria (medibles)

1. **DB Segura**: Las RLS previenen que un usuario modifique solicitudes u ofertas de otros.
2. **Feed Geofenced**: El RPC `feed_nearby_requests` solo devuelve solicitudes dentro del radio del usuario.
3. **UI Responsiva**: El drawer de creación y la vista de detalle funcionan perfectamente en mobile (375px).
4. **Ofertas Públicas**: Cualquier usuario puede ver las ofertas en una solicitud, asegurando transparencia.
5. **No Auto-ofertas**: El comprador no puede enviar una oferta a su propia solicitud.
