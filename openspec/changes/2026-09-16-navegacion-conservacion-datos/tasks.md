# Tasks — Navegación y conservación de datos (Fase 3)

> Integración de `feat/frontend-fases-f1-f5-vicino` (Alejandro, `02390e5`) con
> master, más las correcciones de la revisión. Todo en la rama
> `feat/fase3-navegacion-integracion`, que se avanza a master al cerrar.

## FASE A — Revisión de la rama

- [x] T-01 — Leer la rama entera (60 archivos) y el diff contra master.
- [x] T-02 — Revisión adversarial por cinco lentes (aislamiento de datos,
      render de servidor y primera visita, corrección de la cache, integración
      con master, minimapa/picker) con refutación por pares. Resultado en
      `docs/REVISION-fase3-rama-alejandro-2026-09-16.md`.
- [x] T-03 — Comprobar en Vercel que `SUPABASE_SERVICE_ROLE_KEY` y
      `APPLE_MAPKIT_*` existen en Production (el minimapa depende de ambas).

## FASE B — Integración

- [x] T-04 — `git merge --no-ff` de la rama sobre master en
      `feat/fase3-navegacion-integracion`.
- [x] T-05 — Conflictos: `chat/page.tsx` (flujo idempotente de master +
      `<ChatList/>`; banner `chatError` movido a `chat-list.tsx`),
      `[categoria]/[slug]/page.tsx` (SELECT explícito de `d8b2b4b` +
      `publicProduct`), `comunidades/actions.ts` (`headers()` + `revalidatePath`
      envuelto).
- [x] T-06 — `tsc` en verde sobre el merge (tras limpiar `.next/types` viejos).

## FASE C — Correcciones

- [x] T-07 — `SessionCache.seed(key, value, renderId)` y `useSessionData(key,
      seed)`: la semilla del servidor se pinta en el HTML y no dispara lectura
      tras hidratar; un `renderId` repetido (payload reentregado por el
      router) nunca pisa la memoria.
- [x] T-08 — `lib/session-scope.ts`: una sola función de clave de zona para
      servidor y cliente.
- [x] T-09 — Proveedor: sin recarga ante `INITIAL_SESSION`; `SessionScroll`
      restaura sólo con navegación de pestaña pendiente y en efecto de layout.
- [x] T-10 — `lib/navigation/restauracion-ui.ts` (+ pruebas node:test).
- [x] T-11 — Chats: `getChatList(ctx)`, semilla en `chat/page.tsx`, esqueleto
      con forma en `chat-list.tsx`, sin `router.refresh()` tras ocultar.
- [x] T-12 — Perfil: `getProfileSession(part, ctx)`, semillas por parte en
      `perfil/page.tsx`, `SkeletonPerfil` cuando no hay nada.
- [x] T-13 — Inicio: `getHomeSession(params, ctx)`, semilla con clave de zona en
      `(home)/page.tsx`, `(home)/loading.tsx` instantáneo, `SkeletonRejilla`;
      el feed caído viaja en el valor (CatalogQueryState) y la API lo vuelve 503.
- [x] T-14 — Transversal: freno por IP en `/api/session/*`; precarga
      `FULL`/`AUTO` por ruta; `staleTimes.dynamic: 30`; `scroll={false}` +
      marca pendiente en barra inferior, lateral y deslizar; `prefetch={false}`
      en los enlaces a `/chat?seller=`.
- [x] T-15 — Pruebas: `scripts/test-vicino-phases.ts` (semilla),
      `tests/phases-session.spec.ts` (semilla sin lectura),
      `tests/navigation-return.spec.ts` (veinte regresos sin esqueleto, p95);
      arnés `test-frontend-routes.ts` con `usuarioOInvitado` y `zod` real;
      `test-navigation-critical.ts` reparado (fallaba ya en master).
- [x] T-15b — Correcciones de la revisión: `lib/session-auth.ts` (401 vs 503),
      Sentry en `/api/session` y en el minimapa, envoltorio de revalidación en
      todas las acciones, X del buscador, aviso de categoría, «Tiendas que
      sigues», `FundarDrawer`, `LocationBanner`, `productMapRateLimit`.

## FASE D — Cierre

- [x] T-16 — CODEX Adversarial Review Loop sobre el diff final: dos rondas
      (rama y árbol integrado), cuatro/cinco lentes con refutación por pares.
      Confirmados y corregidos: semilla que tapaba un aviso de Realtime, cambio
      de zona bajo la clave vieja, `SUBSCRIBED` invalidando la semilla, refresh
      token muerto tratado como Auth caído, doble consulta por vuelta,
      `/chat/[id]` sin fallback propio, `/perfil` esperando cuatro partes,
      restauración caducada, contadores sin reintento, minimapa sin freno sin
      Upstash, clave del inicio sin normalizar, cookie sin `secure`.
- [x] T-17 — `pnpm type-check` y `pnpm build` en verde; `pnpm lint` sin errores;
      node: 8/8, 19/19, 14/14, 3/3, 5/5; Playwright `phases` desktop 33/33.
- [x] T-17b — `navigation-return.spec.ts` en escritorio y móvil contra el
      servidor real con sesión: 20 regresos, cero esqueletos de pantalla
      completa. Playwright `phases`: 64/64 (escritorio y móvil).
- [ ] T-18 — Avance de master, push y smoke en `vicinomarket.com`.
