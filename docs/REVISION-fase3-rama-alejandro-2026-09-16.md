# Revisión de `feat/frontend-fases-f1-f5-vicino` (Alejandro, `02390e5`) — 16-sep-2026

Rama revisada contra `master` (`bab4991`). Base de la rama: `c5f2609` (13-sep),
o sea 17 commits por detrás de master. Revisión adversarial por cinco lentes
(aislamiento de datos, render de servidor y primera visita, corrección de la
cache, integración con master, minimapa y selector) con refutación por pares;
59 de 111 verificadores cayeron por límite de sesión, así que los hallazgos de
los buscadores se contrastaron a mano leyendo el código. Todo lo marcado
«corregido» está en la rama de integración `feat/fase3-navegacion-integracion`.

## Veredicto

La arquitectura es sólida y merece integrarse: rutas ligeras, `SessionCache`
por cuenta en memoria, `GET /api/session/*` con `private, no-store`, service
worker en `NetworkOnly`, respuestas de otra cuenta descartadas, cambio de
sesión con navegación dura, minimapa que no rebaja la privacidad de `c1a0150`.
Tiene tres defectos que no podían llegar a producción y varios importantes;
todos quedaron corregidos encima de su código, sin sustituirlo.

## Críticos (corregidos)

1. **La primera visita dejaba de pintarse en el servidor.** `/`, `/chat` y
   `/perfil` devolvían un cascarón con «Cargando…» y pedían JSON tras hidratar:
   el home público perdía su LCP y su SEO, y la app Capacitor mostraba una
   pantalla vacía tras el splash. Corrección: las páginas vuelven a consultar
   en el servidor y siembran la memoria (`SessionCache.seed` + `useSessionData(key, seed)`);
   un `renderId` por render evita que una copia reentregada por el router pise
   la memoria.
2. **`/api/session/*` esquivaba el freno de cuota.** El matcher del proxy
   excluye `/api`, así que el freno por IP de `269b926` protegía un cascarón y
   las consultas caras quedaban sin límite. Corrección: `enforce(readHeavyRateLimit, "sesion:<ip>")`
   antes de cualquier trabajo, 429 con `Retry-After`.
3. **La X del buscador de ubicación borraba la geo al editar.** Limpiar el
   texto emitía `onChange(null)`; guardar sin elegir sugerencia dejaba la
   publicación sin `ubicacion_geo`, `ubicacion` ni radio y fuera de «Cerca de
   ti». Corrección: la X sólo limpia el texto; «Quitar ubicación» sigue siendo
   el gesto explícito.

## Importantes (corregidos)

- Bucle de recarga cuando `INITIAL_SESSION` difería del servidor (caída
  transitoria de Auth): ahora sólo reaccionan `SIGNED_IN`/`SIGNED_OUT`/cambio
  de cuenta.
- Un fallo transitorio de Auth en `/api/session` se respondía como 401 y
  expulsaba a `/login`: `lib/session-auth.ts` distingue «sin sesión» (401) de
  «Auth no contestó» (503, se conserva lo que había).
- `catch` mudo en la API y en la ruta del minimapa: ahora reportan a Sentry con
  etiquetas (`api/session`, `productLocationMap`).
- El feed caído lanzaba y el cliente perdía el `CatalogQueryState` de master:
  el cargador devuelve el fallo dentro del valor; la API convierte ese estado
  en 503 sólo para la revalidación en segundo plano.
- `/chat` no comprobaba sesión en el servidor (200 + rebote por JS): vuelve el
  `redirect("/login?next=/chat")`.
- Conflictos con master resueltos a favor de master: contrato idempotente de
  chat (`iniciarConversacion`, `chatError`), SELECT explícito de la ficha,
  `headers()` de comunidades.
- Mutaciones fuera del envoltorio de revalidación (`citas`, `favoritos`,
  `notificaciones`, `admin/disputes`, `admin/moderation`, `cupones`,
  `createProduct`) dejaban datos viejos hasta 30 s: todas pasan por
  `@/lib/revalidate-session`.
- `PrefetchKind.FULL` en todas las pestañas hacía renderizar `/buscar` y `/`
  completos en cada intento: `AUTO` para `/` y `/buscar`, `FULL` sólo en
  `/chat` y `/perfil`.
- El evento `vicino:data-invalidated` sin prefijo llegaba como `detail: null`
  y no invalidaba nada (cuatro llamadas eran no-op): corregido en el proveedor.
- Minimapa: cubo de cuota propio y documentado (`productMapRateLimit`, 20/min),
  caché privada de un día en el navegador, y la consulta de presencia de la
  ficha en paralelo con reseñas y cupones en vez de en serie.
- `FundarDrawer` volvía a pedir GPS aunque la app ya conociera la zona:
  inicializa desde `readLocation()`.
- Regresiones de interfaz: vuelve el aviso «Elige al menos una categoría» en
  el formulario de venta y el título con contador de «Tiendas que sigues».
- `LocationBanner` pintaba dos líneas sin ubicación ni mapa; el provisional
  «Zona seleccionada» se guardaba como dirección.
- `SessionScroll` restauraba tras el scroll-al-inicio de Next (salto visible)
  y en cualquier navegación: ahora sólo con navegación de pestaña pendiente,
  en efecto de layout.
- Pruebas: `scripts/test-navigation-critical.ts` fallaba ya en master (faltaba
  `iniciarConversacionSchema` en el stub de `@vicino/shared`); arreglado. El
  arnés `scripts/test-frontend-routes.ts` conoce `usuarioOInvitado` y carga
  `zod` real.

## Importantes que quedan para decidir (no bloquean)

- `/perfil` sigue pidiendo cuatro partes a la API en cada revalidación (cuatro
  `getUser`). La primera visita ya va con un solo `getUser` por la semilla.
  Mejora futura: una parte compuesta o resolver la sesión una vez por petición.
- Al abrir `/perfil` desde `loading.tsx` sin memoria, el consumidor lanza sus
  lecturas mientras el servidor ya renderiza la página con las mismas partes
  (la semilla las aborta en el cliente, pero el servidor las paga). Igual en
  chats e inicio. Mitigación futura: no lanzar `load()` cuando hay una
  navegación en vuelo hacia la misma ruta.
- Iconos retirados en `comunidades-feed.tsx` y copy de `following-rail`: son
  decisiones de diseño de Alejandro; el título se restauró por accesibilidad,
  los iconos se dejaron como él los dejó.
- Snapshot de Apple por (producto, tema) sin caché de servidor: con la caché
  privada de un día por navegador queda acotado; si el coste sube, cachear por
  celda en el servidor.

## Qué hace bien la rama (conservar al tocarla)

- Respuestas en vuelo nunca repueblan otra cuenta (`generation` + `userId`).
- Service worker sin cache para `/api/session/` y el minimapa.
- `publicProduct` como allowlist de runtime: `ubicacion_geo` no cruza al RSC.
- `remove_location` arregla que «Quitar ubicación» fuera un no-op al editar.
- El menú de cuenta muestra `@username`, no el UUID.
- `LocationPicker` corrige fallos latentes del `DeliveryMap` (aborts, secuencia
  de búsqueda, cobertura).

---

## Segunda ronda: CODEX sobre la integración (el diff completo)

Cuatro lentes sobre el árbol integrado (corrección de React y de la cache,
seguridad, regresiones frente a master, coste de servidor) con refutación por
pares. 20 de 50 agentes completaron antes de agotar el modelo; los hallazgos de
los cuatro buscadores se evaluaron a mano. Confirmados y corregidos:

- **Una semilla podía tapar un aviso de Realtime.** La precarga `FULL`
  renderiza `/chat` al pasar el dedo por encima; si llega un mensaje en el
  hueco entre ese render y el toque, la semilla nacía «fresca» y bloqueaba la
  relectura durante los 30 s del TTL. Ahora `SessionCache` recuerda cuándo se
  avisó de cada prefijo (reloj del cliente) y una semilla posterior a un aviso
  sin servir nace caducada: se pinta al instante y dispara la lectura. El
  registro es por prefijo, no por clave, porque cuando Realtime avisa la
  pestaña puede no haberse abierto nunca en esa sesión.
- **Cambiar de zona guardaba el feed nuevo bajo la clave de la zona vieja.**
  `invalidate` relanzaba la clave anterior con la cookie ya cambiada: tres RPC
  pesadas y una entrada envenenada. Ahora se usa `drop`, que olvida esas
  entradas sin releerlas.
- **Realtime tiraba la semilla en cada carga de `/chat`.** El primer
  `debounce()` sale del `SUBSCRIBED`, que no es un cambio; invalidaba la lista
  300 ms después de hidratar. Sólo invalidan los `postgres_changes` reales.
- **Un refresh token muerto se clasificaba como «Auth caído»** (503 en bucle).
  `usuarioOInvitado` distingue el veredicto de GoTrue sobre la credencial
  (`AuthApiError` 4xx, salvo 408 y 429 → sin sesión, 401) del fallo de
  transporte (503).
- **Volver a una pestaña pagaba las consultas dos veces**: `loading.tsx` pedía
  la API mientras el servidor ya renderizaba la página. La lectura de montaje
  se demora 250 ms y la semilla del render la deja sin efecto; un reintento o
  un aviso siguen siendo inmediatos.
- **Abrir una conversación no daba feedback**: `/chat/[id]` heredaba el
  `loading.tsx` de la lista y repintaba la misma lista desde memoria. Ahora
  tiene su propio esqueleto con forma de conversación.
- **`/perfil` esperaba a las cuatro partes en el HTML.** Se siembran sólo la
  cabecera y las publicaciones (lo que se ve al abrir); reseñas y contadores
  los pide el cliente, como master los diferían con Suspense.
- **Una marca de restauración caducada dejaba el scroll de la pestaña
  anterior** (las navegaciones de pestaña van con `scroll: false`).
  `consumirRestauracion` ahora devuelve `restaurar` / `arriba` / `nada`.
- **Contadores del perfil en «…» para siempre** si su lectura fallaba: pasan a
  ofrecer reintento.
- **El minimapa no tenía freno real sin Upstash** y cada petición cuesta un
  snapshot de pago. Se añade un suelo en memoria por instancia
  (`lib/freno-en-memoria.ts`, 20/min por IP) delante del limitador compartido.
- **La clave del inicio no normalizaba el feed**: con `?feed=xyz` la semilla
  quedaba bajo una clave que nadie leía y el cliente pedía a la API un feed que
  ella rechaza con 400. `homeSessionKey` normaliza para las dos capas.
- **`vicino_data_revision` viajaba sin `secure`** en producción.

Quedan anotados, sin corregir por ser decisiones o coste acotado: `/perfil`
sigue pidiendo cuatro partes en las revalidaciones; el pull-to-refresh pide por
dos caminos (memoria y RSC) porque la persona pidió datos frescos; el snapshot
de Apple no se cachea en el servidor (sí un día en el navegador); los iconos
retirados en `comunidades-feed` son decisión de diseño de Alejandro.
