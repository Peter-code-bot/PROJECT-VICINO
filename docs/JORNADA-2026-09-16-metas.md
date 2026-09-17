# Jornada 16-sep-2026 — bitácora de metas

Seguimiento vivo de todo lo pedido hoy. Cada meta tiene pasos, revisión y
estado. Se actualiza al cerrar cada paso; el push a `master` va al final de
cada meta verificada.

Nota de Pedro: si se agota Fable 5.1, los pendientes siguen con Opus 4.5.

## Meta 0 — Fase 3: navegación y conservación de datos (rama de Alejandro)

Estado: **en cierre**. Rama local `feat/fase3-navegacion-integracion`.

- [x] Leer la rama `feat/frontend-fases-f1-f5-vicino` (60 archivos) y compararla con master.
- [x] Revisión adversarial por cinco lentes (parte de los verificadores cayó por límite de sesión; los hallazgos de los buscadores se evaluaron a mano).
- [x] Merge sobre master, tres conflictos resueltos a favor de master (`f172eab`).
- [x] Semilla del servidor en chats, perfil e inicio (`SessionCache.seed`, `useSessionData(key, seed)`), `loading.tsx` con esqueleto sólo sin datos.
- [x] Freno por IP en `/api/session/*`; `staleTimes.dynamic: 30`; precarga AUTO en `/` y `/buscar`.
- [x] Restauración de scroll sólo en navegaciones de pestaña; `prefetch={false}` en `/chat?seller=`.
- [x] Proveedor sin bucle de recarga ante `INITIAL_SESSION`; `detail` nulo del evento de invalidación.
- [ ] Correcciones de la revisión: Auth transitorio en `/api/session` (503, no 401), Sentry en la API, mutaciones fuera del envoltorio (`citas`, `favoritos`, `notificaciones`, `admin`, `cupones`, `createProduct`), X del buscador de ubicación, aviso de categoría y título de «Tiendas que sigues», minimapa (Sentry, caché privada, limitador propio, consulta en paralelo), `FundarDrawer` con la ubicación conocida.
- [ ] Documento de revisión para Pedro: `docs/REVISION-fase3-rama-alejandro-2026-09-16.md`.
- [ ] CODEX loop sobre el diff final; lint; pruebas node; Playwright (`playwright.phases.config.ts` + `navigation-return`); `pnpm build`.
- [ ] Avance de master y push; smoke en vicinomarket.com.

## Meta 1 — Comunidades (plan integral, área I)

Estado: pendiente.

- [ ] 1.1 Quitar cuota de 24 h para fundar (migración `comunidad_fundacion_estado`; `fundar-drawer.tsx`).
- [ ] 1.2 Quitar «archivar» del panel de administración; texto «Salir» en `join-button.tsx`.
- [ ] 1.3 Restaurar «Nenis Anáhuac» (`7c7ca723-…`) con Javier (`7db68a49-…`) como owner (SQL en producción: READ → WRITE → VERIFY).
- [ ] 1.4 Badges: «admin», globo negro sin borde, sin etiqueta «Archivada» (`comunidad-card.tsx`, `detalle-cabecera.tsx`).
- [ ] 1.5 Mapa «Cambiar ubicación» interactivo en iPad (`change-location-map.tsx`).
- [ ] 1.6 Barra lateral iPad: scroll contenido (`sidebar.tsx`, `use-body-scroll-lock.ts`).
- [ ] 1.7 Mover centro sin límite de 1 km ni cuota (migración `editar_centro_comunidad`; `mover-centro-sheet.tsx`, `centro-map.tsx`).
- [ ] 1.8 Cabecera con tríada de iconos y drawer de miembros/solicitudes.
- [ ] 1.9 Publicaciones con imágenes (columna `imagenes`, bucket, composer, card) y botón de chat directo con el autor.
- [ ] Revisión adversarial + pruebas + build + push.

## Meta 2 — Panel de administración (área II)

- [ ] 2.1 Corregir el nombre corrupto de Javier en `profiles` y normalizar NFC en las acciones de perfil.
- [ ] 2.2 Contraseña de seguridad para cambios de rol (`ADMIN_SECURITY_PASSWORD`, sin literal en el repo público).
- [ ] Revisión + build + push.

## Meta 3 — Verificación de identidad (área III)

- [ ] 3.1 Bloqueo/confirmación al cambiar tipo o universidad con fotos subidas.
- [ ] 3.2 Aviso de privacidad en modal interno.
- [ ] 3.3 Motor de IA con las tres imágenes (selfie + frente + reverso) y proveedor real en el admin.
- [ ] 3.4 Miniaturas y visor interno en verificaciones pendientes.
- [ ] 3.5 `reject_verification_atomic` (migración) y acción de rechazo sin `permission denied`.
- [ ] Revisión + build + push.

## Meta 4 — Notificaciones y onboarding (área IV)

- [ ] 4.1 Preferencias de notificaciones en configuración (columna + GRANT por columna + página).
- [ ] 4.2 Paso de permisos de notificaciones en el onboarding.
- [ ] 4.3 Auditoría de push (`send-push`, triggers) y matriz de prioridades.
- [ ] Revisión + build + push.

## Meta 5 — Solicitudes: detalle y filtros unificados

- [ ] Detalle `/solicitudes/[id]`: categoría sobre la imagen, presupuesto como texto.
- [ ] Filtros unificados en `/buscar` y `/solicitudes`: botón + drawer con cuadrícula de categorías.
- [ ] Revisión + build + push.
