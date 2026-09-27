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
- [ ] Reproducir; separar geocodificación / radio de productos / cobertura operativa
      (`NEXT_PUBLIC_COVERAGE_RADIUS_KM`, `vicino_cobertura`, `exigir_cobertura_operacion`).
- [ ] Regla de producto acordada y coherente entre cliente y servidor.

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

## PT07 — iOS y notificaciones
- [ ] Conciliar `feat/bb03-piloto-regreso` (Liquid Glass piloto, log de token FCM, 1.1 (6) en TestFlight).
- [ ] Push por tipo y preferencias. `send-push` desplegada es la del 28-ago:
      no respeta preferencias (repo 16-sep).

## PT08 — Publicación web y App Store
- [x] Retención retirada por Alejandro (`6ee06be`, 23:26 UTC) antes de
      aplicar S04; producción alineada tras aplicar las migraciones. La
      reversión conjunta está en `docs/rollback/` + Instant Rollback a 4b6be86.
- [ ] Verificar `assetlinks.json` servido (Digital Asset Links API).

## PT09 — Seguridad/backend heredado (conciliar, no reabrir por antigüedad)
- [ ] Rate limiting: Vercel sin `UPSTASH_*` (todos los limitadores son no-op).
- [ ] Repo PÚBLICO + claves legacy encendidas (service_role de `8416eee` viva). Decisión del titular.
- [ ] `delete-account` desplegada es la del 16-jul (sin los arreglos del 26-ago).
- [ ] Dos 401 de pg_net el 26-sep 04:19 UTC.
- [ ] `ADMIN_SECURITY_PASSWORD` sin definir en Vercel.

## PT10 — Posterior (no bloquea)
- [ ] S09 Estudiantes, S10 Negocios en mapa: solo contrato, sin implementar.

## Fuera de código, en manos de Pedro
- [ ] Verificación de desarrolladores de Android antes del 30-sep (confirmar `com.vicino.mx`).
- [ ] Reclutar 15-20 verificadores reales; 14 días seguidos.
