# Proposal — Enlaces de contacto del negocio (Instagram, WhatsApp, Google Maps y resenas de Google)

> Change: `2026-11-08-enlaces-negocio`. Rama `feat/enlaces-negocio-20261108` sobre
> `master` `192876f`. Primera entrega del pendiente INT-CRM-20261104. **Trae codigo**:
> una migracion, cambios en `@vicino/shared` y en `apps/web`, con pruebas. Nada
> aplicado en produccion ni mergeado.

## Why

Los negocios que llegan a VICINO ya atienden por Instagram y WhatsApp, y los que tienen
local viven en Google Maps. Hoy su ficha en VICINO no lleva a ninguno de esos sitios, asi
que la persona que descubre un negocio en la app tiene que buscarlo a mano fuera. El
pendiente INT-CRM-20261104 pide dos entregas: primero, **enlazar los canales desde la
ficha**; despues, **si hay demanda**, evaluar una bandeja para gestionarlos. Este change
es solo la primera.

Lo que se decidio NO hacer aqui, a proposito:

- No se leen ni sincronizan mensajes de Instagram, Facebook o WhatsApp. Eso exige una
  app en Meta con App Review y Business Verification, y es la fase dos.
- No se leen ni responden resenas de Google. La API de Business Profile sigue detras de un
  formulario de acceso y exige un perfil verificado con sitio web; tambien es fase dos.
- La resena de la compra sigue dentro de VICINO. El enlace de Google se **ofrece** solo a
  quien ya compro, nunca a cambio de algo ni filtrando por calificacion.

## Lo que hay hoy (leido, no supuesto)

- `profiles` guarda `telefono`, `nombre_negocio`, `descripcion_negocio`,
  `categoria_negocio` y `metodos_pago_aceptados`, pero ningun enlace externo.
- La cabecera `apps/web/app/(marketplace)/perfil/profile-header.tsx` pinta bio, zona,
  chip de categoria y los botones Mensaje/Seguir. La ficha publica
  `vendedor/[id]/page.tsx` elige columna por columna lo que viaja (es la frontera de
  privacidad; `email` y `telefono` nunca salen).
- El perfil se escribe por RPC (`update_profile_and_pause_products`), no por UPDATE
  directo: `authenticated` solo tiene UPDATE sobre `foto` y `fcm_token`
  (migracion 20260826240000). Los grants de `profiles` son por columna.
- Los enlaces externos ya se abren con `<a target="_blank" rel="noopener noreferrer">`
  en `legal-footer.tsx` y `seller-steps.tsx`; `@capacitor/browser` solo se usa para el
  pase de Google Wallet.
- No existe ninguna tabla de eventos o clics; solo `loyalty_events`.

## What changes

1. **Cuatro columnas** en `profiles`: `instagram_usuario`, `whatsapp_numero`,
   `google_maps_url`, `google_resenas_url`, con CHECK de formato y SELECT publico.
2. **RPC `actualizar_enlaces_negocio`**: unico camino de escritura; exige modo vendedor.
3. **Tabla `clics_enlaces_negocio`** y **RPC `registrar_clic_enlace_negocio`**
   (ejecutable por `anon`): un clic por fila, sin identidad de quien toca.
4. **`@vicino/shared`**: normalizadores (`@usuario`, URL pegadas, numeros con espacios),
   armado de URL por proveedor y `enlacesNegocioSchema`.
5. **Formulario** `/perfil/editar`: cuatro campos dentro del bloque Modo Vendedor.
6. **Ficha** `/vendedor/[id]` y **perfil propio**: fila de botones bajo la zona; la
   resena de Google solo para quien tiene una venta completada con el negocio.
7. **`/seller/analytics`**: clics por canal en 30 dias, con la aclaracion de que un clic
   no es un mensaje ni una venta.

## Non-goals

Bandeja de mensajes, lectura de resenas, Facebook, boton de WhatsApp en la ficha de
producto, atribucion por persona, codigos QR impresos.

## Decisiones que firma Pedro (y revisa Alejandro)

| # | Decision tomada en la rama | Si se cambia |
| --- | --- | --- |
| D1 | Disponible para todo vendedor, casual y negocio. | Filtrar por `seller_type` en el formulario y en los RPC. |
| D2 | Resena de Google solo tras una compra completada; el dueno la ve para probar. | Quitar la consulta a `sale_confirmations` en la ficha. |
| D3 | Clics sin identidad (solo `con_sesion`). | Anadir `visitante_id`; implica aviso de privacidad. |
| D4 | `<a target=_blank>`; sin plugin nativo nuevo (no obliga a un AAB). | `@capacitor/app-launcher` + AAB. |
| D5 | Texto prellenado fijo en WhatsApp, sin datos de la persona. | Pasar producto o contexto. |
| D6 | WhatsApp: 10-15 digitos, sin anteponer la lada. | Anteponer 52 a los de 10 (inventa un dato). |
| D7 | Diseno de los botones: clases de `ChipCategoria`, sin cambios en el resto de la cabecera. | Lo que diga Alejandro. |

## Criterio de paso (del pendiente)

Enlaces correctos con y sin app en Android y iOS; el negocio puede editar o retirar sus
datos; medicion del origen sin capturar el contenido de conversaciones. Antes de ampliar
a la fase dos: confirmar demanda y aislamiento entre negocios.
