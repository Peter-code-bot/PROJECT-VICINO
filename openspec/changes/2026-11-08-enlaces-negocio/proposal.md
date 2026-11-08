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
  en `legal-footer.tsx` y `seller-steps.tsx`; `@capacitor/browser` se usa para el pase de
  Google Wallet (`tarjetas/[id]/acciones-tarjeta.tsx`) y para el OAuth nativo
  (`lib/auth/native-oauth.ts`, `components/auth/oauth-url-listener.tsx`).
- `capacitor.config.ts` lleva `*.google.com` en `server.allowNavigation` (por el OAuth):
  en Android, esos hosts navegan DENTRO del WebView en vez de ir al sistema.
- No existe ninguna tabla de eventos o clics; solo `loyalty_events`.
- Todos los limitadores de `lib/rate-limit.ts` se crean con `analytics: true`, que
  persiste en Upstash el identificador de cada cubeta (IP o id) sin caducidad.

## What changes

1. **Cuatro columnas** en `profiles`: `instagram_usuario`, `whatsapp_numero`,
   `google_maps_url`, `google_resenas_url`, con CHECK de formato y SELECT publico.
2. **RPC `actualizar_enlaces_negocio`**: unico camino de escritura; poner un enlace exige
   modo vendedor, quitarlos se permite siempre.
3. **Tabla `clics_enlaces_negocio`** y **RPC `registrar_clic_enlace_negocio`**
   (ejecutable por `anon`): un clic por fila, sin identidad de quien toca; topes por
   negocio y globales, lock por negocio, purga a 90 dias.
4. **`@vicino/shared`**: normalizadores (`@usuario`, URL pegadas, numeros con espacios,
   host en minusculas), lista cerrada de hosts de Google, armado de URL por proveedor y
   `enlacesNegocioSchema`.
5. **Formulario** `/perfil/editar`: cuatro campos dentro del bloque Modo Vendedor; apagar
   el modo vendedor quita los enlaces (lo dice el aviso).
6. **Ficha** `/vendedor/[id]` y **perfil propio**: fila de botones bajo la zona; la
   resena de Google solo para quien tiene una venta completada con el negocio; en Android,
   `Browser.open` para los hosts `*.google.com` que `allowNavigation` dejaria dentro del
   WebView.
7. **`/seller/analytics`**: clics por canal en 30 dias (count), con la aclaracion de que
   un clic no es un mensaje ni una venta y de que el conteo es orientativo.
8. **Freno del clic** sin analitica de Upstash y con la IP solo como resumen con fecha.

## Non-goals

Bandeja de mensajes, lectura de resenas, Facebook, boton de WhatsApp en la ficha de
producto, atribucion por persona, codigos QR impresos.

## Decisiones que firma Pedro (y revisa Alejandro)

| # | Decision tomada en la rama | Si se cambia |
| --- | --- | --- |
| D1 | Disponible para todo vendedor, casual y negocio. | Filtrar por `seller_type` en el formulario y en los RPC. |
| D2 | Resena de Google solo tras una compra completada; el dueno la ve para probar. | Quitar la consulta a `sale_confirmations` en la ficha. |
| D3 | Clics sin identidad (solo `con_sesion`); IP solo como resumen con fecha en el freno, sin analitica; retencion 90 dias. | Anadir `visitante_id`; implica aviso de privacidad. |
| D4 | `<a target=_blank>`; sin plugin nativo nuevo (no obliga a un AAB). En Android, `Browser.open` solo para los hosts `*.google.com` de `allowNavigation`. | `@capacitor/app-launcher` + AAB, o quitar `*.google.com` de `allowNavigation` + AAB. |
| D5 | Texto prellenado fijo en WhatsApp, sin datos de la persona. | Pasar producto o contexto. |
| D6 | WhatsApp: 11-15 digitos; un numero local de 10 se rechaza con mensaje y no se le antepone la lada. | Aceptar 10 (enlace roto probable) o anteponer 52 (inventa un dato). |
| D7 | Apagar el modo vendedor quita los cuatro enlaces (son publicos); `nombre_negocio` y lo demas se conservan. | Conservarlos ocultos (quedan legibles por PostgREST sin via para retirarlos). |
| D8 | Diseno de los botones: clases de `ChipCategoria`; una fila nueva en el aviso de desactivacion. | Lo que diga Alejandro. |

## Criterio de paso (del pendiente)

Enlaces correctos con y sin app en Android y iOS; el negocio puede editar o retirar sus
datos; medicion del origen sin capturar el contenido de conversaciones. Antes de ampliar
a la fase dos: confirmar demanda y aislamiento entre negocios.
