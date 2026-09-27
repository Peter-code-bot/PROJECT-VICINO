# Pendientes técnicos — jornada 26-sep-2026

Lista viva. Fuente: plan técnico PT00–PT10 que Javier dejó en Notion
(`3de98e8a0cfa81cc812ef86a0ca65263`, exportado sin conexión) + lo encontrado en
la investigación del 26-sep. La conexión de Notion de Pedro no llega a esa
página: los resultados se registran aquí y en el informe para que Javier los
sincronice (D01/D02/A01–A05). No se afirma haber actualizado Notion.

**Reglas que manda el plan:**
- Todo el diseño queda bajo revisión de Javier (onboarding, layouts, márgenes,
  botones, brand book, Liquid Glass). Al corregir errores se conserva la
  apariencia aprobada.
- La retención de Vercel (`ignoreCommand` + `hold-production-for-s04.mjs`) se
  mantiene hasta validar S04 y los recorridos críticos.
- Nada de cuentas reales como fixtures ni del seed excluido de la entrega.
- Por bloque: diagnóstico → cambio acotado → pruebas → SHA/entorno → informe.
  Distinguir código / desplegado / probado en dispositivo.

**Orden:** PT00 → PT01 + preparación PT02 → PT03 → PT04/PT05/PT06 → PT07 → PT08.
PT09 es conciliación de antecedentes; PT10 no bloquea.

---

## Hecho antes de la lista (26-sep)

- [x] Play Store: la prueba cerrada tenía 0 verificadores porque las 12 listas
      estaban en el segmento «Alpha» (sin versión) y el AAB 7 en «VICINO» (sin
      verificadores). AAB 8 / 1.7 enviado a revisión en «VICINO» con el Grupo de
      Google `vicino-verificadores@googlegroups.com` (12 miembros).
- [x] `4352bba` versionCode 8 / 1.7 (solo `build.gradle`).
- [~] `9d03f7a` `assetlinks.json` con la huella de la clave de firma de Play.
      En código; llega a producción cuando se levante la retención.

## PT00 — Conciliar avances y preparar entorno
- [x] Estado inicial (26-sep): producción sirve `4b6be86` (16-sep); master
      `84e1dde` retenido por `ignoreCommand`. Ledger de prod = 175 versiones; la
      única migración del repo sin aplicar es `20260925010000` (S04).
      `20260912300000` y `20260912310000` sí están aplicadas.
- [x] Rama de la Mac `feat/bb03-piloto-regreso` (3 commits del 26-sep): piloto
      Liquid Glass nativo + familia Regreso (14 archivos web de diseño + Swift),
      token FCM fuera del log de AppDelegate, versión iOS 1.1 (6) subida a
      TestFlight. **No integrada a master**: es diseño bajo revisión de Javier.
- [x] Acceso de administración a Supabase: la Management API responde desde
      esta máquina (`scripts/db-query.mjs`, token del `.env`, sin imprimirlo).
      El 401 del plan fue de otra máquina.
- [x] Staging `vicino-staging` (ref `fautpkprtlspugbqhnfy`, micro, us-west-2),
      aprobado por Pedro. Herramientas en `scripts/staging/` (estado en
      `.staging/`, fuera de git):
      - `crear.mjs` / `borrar.mjs --si`
      - `replicar-esquema.mjs`: 175 migraciones de prod; pre-hooks para la
        deriva conocida (3 policies de `media_assets`, DROP de
        `search_nearby_products_v4`, `products_services.estado`) y
        desprograma los cron que llaman a producción.
      - `igualar-con-prod.mjs`: copia de prod 10 funciones que solo existen
        allí y 20 con otra versión; iguala policies, permisos de tabla/columna
        y publicación de Realtime; no copia lo que llama a producción por red.
      - `dev-contra-staging.mjs`: web local en :3100 contra staging, sin
        Sentry, correo ni IA.
- [x] Hallazgo: el repo concede muchos más permisos que prod (staging salió
      con 34 de tabla y 369 de columna de más): prod los revocó a mano.
      Reconstruir prod solo desde el repo abriría esos permisos.
- [x] Incidente contenido: al reproducir el esquema, 2 cron del staging
      llamaron a funciones de producción (26-sep 23:00 UTC) y prod respondió
      401 (sin credencial): sin efecto en datos. El replicador ya los
      desprograma al crearlos.

## PT01 — CI rojo de Favoritos
- [x] `96f3c21`: cliente tipado con `Awaited<ReturnType<typeof createClient>>`
      (import solo de tipo). eslint 0 errores (149 avisos previos), tsc 0,
      Favoritos 17/17, check-no-todo y check-rutas 0, `pnpm build` 0 (56/56).
- [x] Security Audit verde en `96f3c21` (run 36277229185): type check + lint,
      secretos, npm audit, deriva de tipos. Vercel: cancelado por la retención.

## PT02 — Fixtures sintéticos (mínimo para PT03)
- [x] `scripts/staging/fixtures.mjs`: usuarios `@staging.vicino.test` por
      GoTrue admin, productos `[FIXTURE]` disponible/pausado/eliminado/oculto,
      bloqueo, suspensión y onboarding completo. `limpiar()` retira todo por
      esas marcas (cada corrida termina con 0 restantes). Nunca cuentas reales
      ni el seed. Nota: `contadores_nacen_en_cero` fuerza `is_hidden=false`
      al INSERT; el oculto se aplica después.
- [ ] Favoritos activo/inactivo en fixtures (pendiente para PT06/S03).
- [ ] (Después) Rankings, Mis Ventas, Mis Reseñas, Estadísticas.

## PT03 — Migración S04 y chat/ventas
- [x] Revalidado (26-sep): faltan `chats.producto_revision`,
      `sale_confirmations.{clave_idempotencia,producto_revision}` y las
      funciones `seleccionar_producto_chat`, `iniciar_confirmacion_venta` y
      `confirmar_venta`.
- [x] Dependencias vivas (paso 0, solo lectura contra prod):
      - Las columnas, enums (`listing_status`, `sale_status`) y guardas
        (`vicino_guard.bloqueados_conmigo`, `cuenta_suspendida`) que usan las
        funciones existen.
      - `messages_unique_sale_confirmed` existe (lo necesita el `ON CONFLICT`
        de `confirmar_venta`); 0 duplicados que rompan el índice único nuevo.
      - Los triggers INVOKER que actualizan `chats` al llegar un mensaje
        (`increment_unread_count`, `unhide_chat_on_new_message`) solo tocan
        `no_leidos_*`, `oculto_para_*` y `updated_at`: S04 las vuelve a
        conceder, así que el envío de mensajes no se rompe.
      - Volumen: 7 chats, 2 ventas, 0 pendientes.
- [x] Compatibilidad: el cliente nuevo solo escribe directo `status/cancelled_*`
      (cancelar) y `oculto_para_*/deleted_at_*` (ocultar chat), que S04 conserva.
      El cliente viejo de producción inserta en `sale_confirmations` y
      actualiza `*_confirmed` directo: tras aplicar S04, iniciar/confirmar
      venta falla en el cliente viejo hasta desplegar el nuevo. Ventana =
      duración del despliegue.
- [x] Staging: S04 aplica limpia sobre copia fiel de prod y pasa su DO $verify$.
- [x] `scripts/staging/probar-s04.mjs`: **35/35** por HTTP real con
      peticiones concurrentes. Cubre CAS de revisión A→B→A, formulario
      obsoleto, idempotencia, doble envío simultáneo, pérdida de respuesta,
      conflicto de clave, venta pendiente, datos inválidos, tercero sin
      permisos, pausado/eliminado/oculto/ajeno, escrituras directas cerradas
      (42501), confirmación doble simultánea (una sola vez: puntos +10/+3,
      ventas +cantidad, 1 aviso), cancelación y guarda, roles invertidos,
      bloqueo, suspensión (confirma tratos previos) y el chat que sigue
      funcionando.
- [x] **P0 "Sincronización pendiente" — causa raíz encontrada.** Prod no
      publica `sale_confirmations` en Realtime (se retiró fuera de banda; la
      migración 20260517000001 la agrega). El canal `chat:<id>` de
      chat-window la escucha junto con messages/chats; Realtime rechaza el
      canal ENTERO ("Unable to subscribe ... table: sale_confirmations") y
      no llega ni un mensaje en vivo. Afecta también al cliente actual de
      prod (4b6be86). Arreglo: `20260926100000_realtime_vuelve_a_publicar_sale_confirmations.sql`.
- [x] `scripts/staging/e2e-chat-venta.mjs`: **9/9** con dos sesiones de
      navegador reales, web local + Realtime de staging. Cubre login, mensaje
      en vivo (1-2 s), cambio de producto visto por el otro, venta iniciada
      por el comprador y confirmada por el vendedor (completada una vez),
      pérdida y recuperación de red sin duplicados, respuesta tras
      reconectar y ningún aviso de sincronización pegado. Sin el arreglo de
      Realtime fallaban 3, 4 y 8.
- [x] Reversión sin pérdida de datos:
      `docs/rollback/20260925010000_chat_producto_y_venta_atomica_rollback.sql`
      (guarda + permisos del cliente viejo; conserva columnas, índices y
      RPC). Probada en staging: el cliente viejo vuelve a crear y confirmar
      ventas. Se usa junto con Instant Rollback de Vercel a 4b6be86.
- [x] **Aplicado en producción (26-sep ~23:45 UTC, autorizado por Pedro).**
      Motivo de la urgencia: a las 23:26 UTC Alejandro retiró la retención
      (`6ee06be`) y Vercel desplegó el cliente S04 sin la migración;
      `chat/[id]/page.tsx` pide `chats.producto_revision` (42703) y no abría
      ningún chat. Se aplicaron con `apply-migration.mjs`: primero
      `20260926100000` (Realtime) y después `20260925010000` (S04).
      Verificado en prod:
      - 3 columnas, 4 funciones y el trigger existen.
      - Escritura directa cerrada; no leídos y cancelación abiertos.
      - Realtime publica `chats`, `messages`, `notifications` y `sale_confirmations`.
      - El ledger tiene las 2 versiones.
      - `chats?select=producto_revision` responde 200 (antes 400); las RPC dan 401 sin sesión.
- [ ] Probar en producción con una cuenta de prueba dedicada (no real) el
      recorrido de chat y venta en la app.
- [ ] 🟡 Decisión de Pedro/Javier: (1) si A bloquea a B con una venta ya
      pendiente, B aún puede confirmarla; (2) confirmar no revisa si el
      producto se pausó o eliminó después de iniciar.

## PT04 — Auth y correo
- [ ] Cuenta nueva/existente, OTP incorrecto/vencido, reenvío, recuperación, sesión activa.
- [ ] SMTP/Resend y límites de Auth (hoy `smtp_host` null, 2 correos/h, sin captcha).
- [ ] Matriz de acceso S02-B (solo lo funcional).

## PT05 — Ubicación fuera de Puebla (Villahermosa)
- [x] Reproducido y separado (26-sep, inicio ~20:15 en otra sesión, cierre
      ~21:45 aquí). Causa: el buscador recortaba con
      `NEXT_PUBLIC_COVERAGE_RADIUS_KM` (200 km desde Puebla) y la base opera
      en todo México (`vicino_cobertura` 'operacion' = `pais`, leído en prod).
- [x] `cdc6f96`: los tres buscadores siguen la regla de la base
      (`lib/geo/cobertura-regla.ts` + `cobertura.ts`); en `radio` miden contra
      el centro de cobertura, como `dentro_de_cobertura()`.
- [x] `5e14267`: la primera búsqueda de la sesión volvía vacía y sin aviso
      (input usable a 46 ms, MapKit listo a ~820 ms): ahora espera a MapKit.
- [x] Producción: `e2e-villahermosa.mjs` **3/3** (Villahermosa 17.988,-92.920;
      Mérida; Monterrey), aparecen, se aplican y la cookie guarda el punto.
- [ ] Dispositivo: MapKit/GPS/tap/arrastre/pinch en iPhone/iPad (Javier/Pedro).

## Header móvil fijo (reporte de Pedro, 26-sep)
- [x] Inicio ~20:45, cierre ~21:50. Causa: `sticky` dentro de un
      `<div className="md:hidden">` de su misma altura; en iOS la cápsula
      nativa (CromoNativo) se desalineaba. `209caf7`.
- [x] Producción: `e2e-header-fijo.mjs` **3/3** (Home scroll 1200, ficha 700,
      listado de Solicitudes: header en top 0 con sus acciones). El detalle de
      una solicitud no se probó: el visitante no ve solicitudes abiertas.
- [x] Detalle de una solicitud probado en staging (27-sep 13:40,
      `scripts/staging/e2e-solicitudes.mjs` **9/9**): con visitante y con sesión, tras
      bajar 600 px el header queda en top 0 (56 px) y la barra de la solicitud en 56 px,
      visible. `e2e-header-fijo.mjs` ya no da OK sin datos: en prod dice «SIN DATOS»
      mientras no haya solicitudes abiertas en Puebla (2/3 el 27-sep, Home y ficha OK).
- [ ] iPhone: cápsula nativa, banners y safe areas en el build del candidato.

## S09-A — Modo campus exclusivo (definición de Javier)
- [x] `c337ef7`. Tres fallos: (1) Universidad + otra categoría mezclaba la
      fila GENERAL de esa categoría → ahora intersección dentro de la
      universidad; (2) la RLS de `seller_verification` solo deja leer la fila
      propia, así que para un no-admin los compañeros nunca llegaban (campus
      vacío) → se resuelven con el cliente de servicio en el módulo
      server-only, universidad siempre de la credencial propia, solo ids;
      (3) un fallo se veía como "sin publicaciones" → estado de error con
      Reintentar y aviso de vacío, nunca el catálogo general.
- [x] `e2e-campus-home.mjs` **11/11** contra staging (dos universidades,
      vendedor general, estudiante sin compañeros, visitante). Fixtures 0.
- [x] Producción (visitante): `/`, `/?cats=universidad`,
      `/buscar?category=universidad` 200; aviso "universidad verificada".
- [ ] 🟡 Capturas: en prod hay **1** credencial universitaria aprobada
      (Anáhuac). Faltan datos dedicados aptos para difusión — decisión de
      Pedro/Javier (sin cuentas reales ni el seed excluido).
- [ ] Más de 20 en Home: el carrusel enlaza "Ver todo" a
      `/buscar?category=universidad`, que pagina con el mismo ámbito.

## Reporte de Javier — chips de Home (26-sep)
- [x] Alejandro lo corrigió en `532143f` con estado local, pero dejó
      `setState` dentro de un `useEffect`: lint 1 error
      (`react-hooks/set-state-in-effect`) y **Security Audit rojo** otra vez.
- [x] Corregido sin cambiar comportamiento ni apariencia: la selección se
      re-sincroniza con `?cats=` durante el render. La doc de Next confirma
      que `replaceState` se integra con `useSearchParams`.
- [x] `scripts/staging/e2e-chips-home.mjs` 6/6 contra staging: tocar,
      destocar, ir a Buscar y volver (el reporte) y restaurar con atrás.

## PT06 — Regresiones S01/S03/S06/S07 (sin rediseñar)
- [ ] Matriz de recorridos reales con roles dedicados.
- [x] S01 «Volver» de /vender: `e2e-retorno-vender.mjs` **8/8** (27-sep, `29ba6ac`);
      arreglado que desde Mis publicaciones mandaba a la última pantalla del marketplace.
- [x] S01 paso 7 (filtro de categoría en Solicitudes): `e2e-solicitudes.mjs` **9/9**,
      con el RPC `feed_nearby_requests` contando la segunda categoría.
- [x] S03 Favoritos con roles reales: `e2e-favoritos.mjs` **7/7** (27-sep, `29ba6ac`).
      Hallazgo (decisión Pedro/Javier): la RLS oculta la pausada al comprador, así que
      sale «Publicación no disponible» sin título ni foto; «Pausado por el vendedor»
      nunca se ve. Mostrarlo exige exponer título/foto de la pausada a quien la guardó
      (RPC de solo lectura). La ficha pausada da 404 «suave» (200 con la pantalla 404).

## PT07 — iOS y notificaciones
- [x] `feat/bb03-piloto-regreso` integrada en master por `f2a3f04` (traspaso de Javier).
- [x] `cc385bc`: bucle de recargas al arrancar en frío desde un enlace
      (§3.5) y prefijos del token FCM en el log (§3.6/A1). Build 56/56.
      Falta dispositivo: app cerrada → enlace universal y toque de push.
- [x] Desplegada `send-push` **v21** el 27-sep (con autorización expresa de
      Pedro en el chat): código de `0a52205` (globo real + limpieza de tokens) y
      `verify_jwt=false` ya declarado en `config.toml`. Humo: sin credencial → 401
      `{"error":"unauthorized"}`. Texto original del bloqueo, como registro:
      Desplegar `send-push` (v20 del 28-ago → repo `9f1ab8d`, único cambio:
      consulta `acepta_notificacion`, falla abierto). Verificado en prod:
      `acepta_notificacion(uuid,text)` existe y service_role la ejecuta; v20
      tiene `verify_jwt=false` y `config.toml` NO declara send-push, así que
      hay que desplegar con `--no-verify-jwt`. **Bloqueado**: el clasificador
      de permisos de Claude rechazó el despliegue (26-sep ~22:10). Lo hace
      Pedro: `supabase functions deploy send-push --project-ref oxxdkwywprkfghhbnoto --no-verify-jwt`.
- [ ] Con firma de Pedro: DROP de `notify_push` y sus 2 triggers (§3.1).
- [ ] Entitlements del `.ipa` (`aps-environment=production`), badge fijo y tokens UNREGISTERED.

## PT00 — Inventario Git del equipo de Pedro (26-sep ~22:15)
- [x] `master` = `origin/master` = `4f5577b` (26-sep 22:15); sin cambios locales ni commits de hoy por subir.
- [x] 5 stashes históricos (1-may a 4-jul) y `security/eradicate-vercel-service-role-key`
      con 2 commits del 9-jul sin subir: respaldo histórico, se conservan, no son de hoy.
- [ ] Mac y worktrees de Javier: fuera de esta máquina (Javier).

## PT08 — Publicación web y App Store
- [x] Retención retirada por Alejandro (`6ee06be`, 23:26 UTC) antes de
      aplicar S04; producción alineada tras aplicar las migraciones. La
      reversión conjunta está en `docs/rollback/` + Instant Rollback a 4b6be86.
- [ ] Verificar `assetlinks.json` y AASA servidos (Digital Asset Links API).
      El clasificador de permisos bloqueó también esta lectura el 26-sep: Pedro.

## PT09 — Seguridad/backend heredado (conciliar, no reabrir por antigüedad)
- [ ] Rate limiting: Vercel sin `UPSTASH_*` (todos los limitadores son no-op).
- [ ] Repo PÚBLICO + claves legacy encendidas (service_role de `8416eee` viva). Decisión del titular.
- [x] `delete-account` desplegada **v14** el 27-sep (`5874496`, verify_jwt=true; humo 401
      sin sesión). Además la migración `20260927100000` (sin FK de `audit_log.actor_id`)
      aplicada en prod: borrar una cuenta que dejó filas en `audit_log` fallaba a medias.
- [ ] Dos 401 de pg_net el 26-sep 04:19 UTC.
- [ ] `ADMIN_SECURITY_PASSWORD` sin definir en Vercel.

## PT10 — Posterior (no bloquea)
- [ ] S09 Estudiantes, S10 Negocios en mapa: solo contrato, sin implementar.

## Tanda 1 de la revisión del 26-sep (Claude, inicio 26-sep ~23:45, cierre 27-sep ~01:30)
Revisión completa de pendientes y 26 planes: `docs/planes-2026-09-26/` y en Notion,
"Revisión de pendientes". DevLog: 01_DevLogs → `2026-09-26-noche-header-villahermosa-campus-y-pendientes`.
- [x] **FIX-cromo-modales (P0 iOS)**: el formulario + de Solicitudes, el agendador de
      citas, el lightbox de la galería y los dos recortadores se declaran modales
      (`data-modal-open`, `role=dialog`, `aria-modal`) y fijan el scroll con
      `useBodyScrollLock`. `e2e-cromo-modales.mjs` **5/5** en staging. Falta iPhone.
- [x] **FIX-S09A-mas-de-20**: pool de 150 (`lib/university-rows.ts`), filas por
      categoría desde el pool, «Ver todo» con `subcategory` y `/buscar` que solo
      estrecha dentro de la universidad. Unitarias 6/6; `e2e-campus-home.mjs`
      **14/14** (con 22 viejas + 22 nuevas); chips 6/6.
- [x] **PT07-badge-unregistered** (solo código; despliega Pedro): `send-push/avisos.ts`
      con globo real, limpieza compare-and-set de tokens UNREGISTERED y `deno check`
      en verde. Unitarias 7/7. Paso 0 en prod: service_role puede UPDATE `fcm_token`.
- [x] **FIX-request-card-cero**, **H50-constantes-topes**.
- [x] **LIMPIEZA-docs-retencion**: script de retención borrado; AGENTS.md y PROGRESS.md
      al día; `.gitignore` bloquea `supabase/seed-*.sql` nuevos (seed con cuentas en el
      equipo Windows de Javier); `config.toml` declara `send-push` (verify_jwt=false) y
      `delete-account` (true).
- [x] Ramas de la Mac (`feat/bb03-piloto-regreso`, `feat/ios-design-handoff-20260926`):
      0 commits fuera de master; `feat/frontend-fases-f1-f5-vicino` y
      `feat/comunidades-hiperlocales` con parche equivalente en master (`git cherry`).
- [x] **D02 reversión de Realtime** (tanda 2, 27-sep ~01:35): faltaba
      `docs/rollback/20260926100000_realtime_vuelve_a_publicar_sale_confirmations_rollback.sql`.
      Probada SOLO en staging: publicada 1 → 0, repetida 0 (idempotente),
      migración reaplicada → 1. Revertirla vuelve a romper el chat en vivo (ver cabecera).
- Verificación: tsc 0, lint 0 errores, build 56/56.

## Tanda 2 — reportes de Pedro del 27-sep (madrugada y mediodía)
Registro vivo en Notion (jornada 3de98e8a…) y DevLog `2026-09-26-noche-header-villahermosa-campus-y-pendientes`.
- [x] **Tarea 8 — «Cambiar ubicación»** (`6111f49`): la X de arriba pasa a palomita
      cuando hay cambios y aplica; fuera el botón «Aplicar ubicación» del fondo.
      Header fijo dentro de la hoja. `e2e-cambiar-ubicacion-palomita.mjs` en verde.
- [x] **Configuración** (`e8e02c9`): «Cerrar sesión» y «Eliminar cuenta» juntas en el
      grupo «Sesión».
- [x] **BUG-DEL-CUENTA** (`5874496` + migración `20260927100000` en prod): borrar una
      cuenta que dejó filas en `audit_log` fallaba a medias (FK con SET NULL contra una
      tabla inmutable). `delete-account` v14 desplegada.
      - [ ] Cuenta rota `0186140a`: terminar de borrarla desde el Dashboard o reintentando
            en la app, más sus 11 archivos (Pedro).
- [x] **Onboarding «Activa las notificaciones»** (`6b5fa5e`) con el diseño aprobado.
- [x] **BUG-VERIF-IA** (inicio 27-sep ~01:35, cierre 27-sep 12:47; `0aeb2a5` + `962e358`):
      la nota de la IA ya no se presenta como si fuera de las fotos nuevas y nadie
      aprueba ni rechaza su propia solicitud (VC403). Migración `20260927110000`
      aplicada en prod antes del push; tipos regenerados (`gen-types --check` en verde).
      Staging por la API real 15/15, unitarias 13/13, build 56/56, dos rondas de
      revisión adversarial (la segunda sin críticos).
      - [ ] Probar en el panel real con una cuenta de prueba (Pedro).

## Fuera de código, en manos de Pedro
- [ ] Verificación de desarrolladores de Android antes del 30-sep (confirmar `com.vicino.mx`).
- [ ] Reclutar 15-20 verificadores reales; 14 días seguidos.
