# Comunidades — puntos candidatos para Liquid Glass

**Estado: PENDIENTES DEL PLAN DE PEDRO.** Aqui NO se implemento nada de
Liquid Glass. Este archivo solo deja apuntados, con ruta y nombre de
componente, los controles del frontend de comunidades donde esos botones
entrarian cuando llegue el plan aparte. Hoy todos usan los tokens y clases
normales de `apps/web/app/globals.css` (`--card-2`, `--sidebar-bg`,
`--brand`, sombras `inset` del sistema).

Referencia viva del efecto que ya existe en la app: la barra inferior
(`.liquid-nav`, `.liquid-nav-fab` en `globals.css`; spec en
`openspec/changes/2026-08-27-liquid-navigation`). Cualquier punto de abajo
deberia reutilizar ESA receta, no inventar otra.

| # | Control | Archivo | Componente / elemento | Nota |
|---|---------|---------|------------------------|------|
| 1 | Tabs del home (fila de cuatro: Para ti, Siguiendo, Solicitudes, Comunidades) | `apps/web/components/home/home-tabs.tsx` | `HomeTabs` — cada `HapticLink` de `TABS` | Hoy son texto extrabold 19 px con `overflow-x-auto` (decision 2). Si el plan los convierte en pildoras, el scroll horizontal se conserva. |
| 2 | Sub-pestanas del feed de comunidades (Muro / Mis comunidades / Descubrir) | `apps/web/components/comunidades/sub-tabs.tsx` | `SubTabs` — contenedor `role="tablist"` y cada `button[role=tab]` | Selector segmentado con pildora deslizante sobre `--sidebar-bg`. Es el candidato mas natural a "glass" porque ya es una pildora flotante (decision 9: debe seguir siendo visualmente distinto de los tabs del home). |
| 3 | FAB de fundar comunidad | `apps/web/components/comunidades/comunidades-feed.tsx` | `ComunidadesFeed` — `button` fijo `bottom-[calc(env(safe-area-inset-bottom)+5.5rem)] right-5` | Mismo sitio y tamano que el FAB de solicitudes (`components/solicitudes/solicitudes-feed.tsx`). Con la cuota agotada se alarga y muestra el tiempo que falta (decision 10): el estilo glass tiene que cubrir tambien ese estado deshabilitado. |
| 4 | Boton de fundar dentro de los estados vacios | `apps/web/components/comunidades/comunidades-feed.tsx` | `ComunidadesFeed` — `botonFundar` (JSX reutilizado en `EstadoVacio`) | Mismo componente logico que el FAB; si el FAB cambia, este va con el. |
| 5 | Acciones de la cabecera del detalle (Volver, Administrar) | `apps/web/components/comunidades/detalle-cabecera.tsx` | `DetalleCabecera` — `button[aria-label=Volver]` y `Link` "Administrar" | Circulos y pildora con `shadow-[inset_0_0_0_1px_var(--border)]` sobre `--card-2`. |
| 6 | Boton de relacion con la comunidad (Unete / Solicitar unirse / Solicitud enviada / Salir) | `apps/web/components/comunidades/join-button.tsx` | `JoinButton` — las cuatro ramas de render | Vive en la cabecera del detalle y en cada `ComunidadCard` de Descubrir. Cuatro estados visuales; el plan tiene que cubrir los cuatro. |
| 7 | Barra de reacciones de cada publicacion (Me gusta + Comentar) | `apps/web/components/comunidades/post-card.tsx` | `PostCard` — `div` con `button[aria-pressed]` (like) y `Link` (comentarios) | Like optimista con estado presionado (`--brand-tint-strong`). Tambien aparece en la cabecera del hilo (`esCabeceraDeHilo`). |
| 8 | Menu de tres puntos de la publicacion (Reportar / Borrar) | `apps/web/components/comunidades/post-card.tsx` | `PostCard` — `button[aria-haspopup=menu]` y el `div[role=menu]` | Desplegable flotante; candidato a panel glass como el de `components/moderation/report-menu-button.tsx`. |
| 9 | Boton de enviar del composer del muro y del hilo | `apps/web/components/comunidades/post-composer.tsx` | `PostComposer` — boton `Publicar` (modo normal) y boton circular `Send` (modo `compacto`) | El compacto va fijo abajo en `hilo-publicacion.tsx`, encima de la barra inferior liquid: conviene que compartan receta. |
| 10 | Composer fijo del hilo (contenedor) | `apps/web/components/comunidades/hilo-publicacion.tsx` | `HiloPublicacion` — `div.fixed` que envuelve a `PostComposer compacto` | Hoy es transparente en movil y con `backdrop-blur` solo en escritorio. Es el equivalente del composer del chat. |
| 11 | Tarjeta flotante sobre el muro difuminado (Comunidad privada) | `apps/web/components/comunidades/muro-difuminado.tsx` | `MuroDifuminado` — `div` absoluto con el candado | Ya vive sobre un blur (decision 3): es glass "de facto" y deberia pasar a la receta comun para no tener dos blurs distintos en pantalla. |
| 12 | Boton Volver y pildora "Cargar mas" del hilo | `apps/web/components/comunidades/hilo-publicacion.tsx` | `HiloPublicacion` — `button[aria-label=Volver]`, boton "Cargar mas comentarios" | Secundarios. |
| 13 | Botones Aceptar / Rechazar de la cola de solicitudes | `apps/web/components/comunidades/admin/solicitudes-cola.tsx` | `SolicitudesCola` — par de `button` circulares por fila | Solo para owner y moderadores. |
| 14 | Boton "Mover" y boton "Guardar nuevo centro" | `apps/web/components/comunidades/admin/admin-panel.tsx`, `apps/web/components/comunidades/admin/mover-centro-sheet.tsx` | `AdminPanel` (Mover), `MoverCentroSheet` (Guardar, Usar mi ubicacion) | El sheet ya usa el mismo molde que `components/home/change-location-sheet.tsx`; si aquel recibe glass, este va detras. |
| 15 | Interruptor "Comunidad privada" | `apps/web/components/comunidades/fundar-drawer.tsx`, `apps/web/components/comunidades/admin/admin-panel.tsx` | `FundarDrawer` y `AdminPanel` — `button[role=switch]` | Mismo markup en los dos sitios. |

Fuera de alcance de este listado (no son botones): las tarjetas
`ComunidadCard` y `PostCard` en si, los esqueletos de `loading.tsx`, y los
dialogos de confirmacion (`confirmar-dialog.tsx`, sobre Radix Dialog).
