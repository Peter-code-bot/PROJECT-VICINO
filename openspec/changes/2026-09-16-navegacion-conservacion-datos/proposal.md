# Proposal — Navegación y conservación de datos (Fase 3)

## Why

Referencia: plan de optimización del 15-sep-2026, sección 7 / solicitud 4
(«Volver a una pestaña sin empezar desde cero»). Al ir y venir entre Inicio,
Chats y Perfil la aplicación esperaba de 1 a 2 segundos y volvía a enseñar el
esqueleto de carga, aunque acabara de pintar exactamente lo mismo. La causa es
estructural: cada pestaña es una página dinámica del App Router, y cada
navegación volvía a pedir su payload al servidor (`getUser` en el proxy +
`getUser` en la página + sus consultas) sin reutilizar nada de la visita
anterior.

Alejandro entregó la Fase 3 en la rama `feat/frontend-fases-f1-f5-vicino`
(commit `02390e5`, sobre un master del 13-sep). Esta propuesta integra esa
rama con master y corrige lo que la revisión encontró antes de que toque
producción.

## What

1. **Integrar la rama de Alejandro** (rutas ligeras + `SessionCache` en memoria
   + `GET /api/session/{chats|home|profile}` + minimapa de la ficha +
   `LocationPicker` compartido), resolviendo los conflictos a favor de master
   en el contrato de chat (`iniciarConversacion`), la ficha de producto
   (SELECT explícito) y comunidades.
2. **Devolver el render de servidor a la primera visita.** Las páginas de
   Chats, Perfil e Inicio vuelven a traer sus datos en el HTML y los siembran
   en la memoria de sesión (`SessionCache.seed`). La hidratación no vuelve a
   pedirlos. Sin esto el inicio —público e indexable— habría pasado a ser un
   «Cargando publicaciones…» hasta que el JS descargara, hidratara y pidiera
   JSON: el LCP y el SEO del home retrocedían, y el arranque en frío de la app
   Capacitor mostraba una pantalla vacía tras el splash.
3. **Frenar `/api/session/*`.** El matcher del proxy excluye `/api`, así que el
   freno por IP del home y `/buscar` (`269b926`) no cubría estas rutas, que
   ejecutan las mismas consultas pesadas.
4. **Coordinar con el enrutador.** `staleTimes.dynamic: 30` para que el ir y
   venir rápido no vuelva a pedir el RSC; precarga `FULL` solo en las pestañas
   baratas (Chats, Perfil) y `AUTO` en Inicio y Buscar; `loading.tsx` de las
   tres pestañas pinta lo que hay en memoria y sólo un esqueleto con forma si
   no hay nada utilizable.
5. **Restauración explícita de interfaz** (scroll y pestaña activa del perfil)
   aislada por cuenta y ruta, y sólo en navegaciones de pestaña (barra
   inferior, barra lateral, deslizar), que ahora navegan con `scroll: false`.
6. **Salvaguardas.** Los enlaces a `/chat?seller=…` llevan `prefetch={false}`:
   esa URL abre una conversación (y puede registrar una intención de compra) al
   renderizarse en el servidor. Las conversaciones sólo se marcan leídas desde
   la ventana visible (`useVisibleChatRead`), nunca por precarga ni por
   revalidación.
7. **Sesión.** El proveedor deja de recargar la página ante un
   `INITIAL_SESSION` que difiera del servidor (durante una caída de Auth eso
   era un bucle de recargas) y sólo reacciona a cambios reales de sesión:
   salir, entrar, otra cuenta en otra pestaña.

## Fuera de alcance

- Persistir nada en `localStorage` ni en el service worker (decisión del
  plan; `/api/session/*` y el minimapa quedan `NetworkOnly`).
- Contenedores ocultos con CSS para mantener montadas las pestañas.
- Cambios de producto en el minimapa y el `LocationPicker` más allá de lo que
  la revisión señala como corrección.
