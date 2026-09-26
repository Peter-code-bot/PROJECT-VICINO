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
- [ ] Estado inicial inequívoco: master, ramas remotas (`feat/bb03-piloto-regreso`
      de la Mac), producción, ledger, Edge Functions.
- [ ] Acceso de administración a Supabase comprobado sin imprimir credenciales.
- [ ] Entorno de staging y cuentas sintéticas dedicadas.

## PT01 — CI rojo de Favoritos
- [ ] Quitar los 3 `any` de `favoritos/remove-favorite-core.ts`
      (`FavoriteClient = Awaited<ReturnType<typeof createClient>>`).
- [ ] lint, tipos, Favoritos 17/17, build; push; Security Audit verde en el SHA nuevo.

## PT02 — Fixtures sintéticos (mínimo para PT03)
- [ ] Dos participantes de chat, un tercero sin permisos, productos
      disponible/pausado/eliminado, ventas pendiente/completada/cancelada,
      favoritos activo/inactivo. Carga y limpieza por IDs sintéticos.
- [ ] (Después) Rankings, Mis Ventas, Mis Reseñas, Estadísticas.

## PT03 — Migración S04 y chat/ventas
- [ ] Revalidar que falta `chats.producto_revision` en producción.
- [ ] Revisar dependencias vivas (`20260912300000`, `20260912310000`, `20260925010000`).
- [ ] Probar migración, GRANT, RLS e idempotencia/concurrencia en staging.
- [ ] Compatibilidad cliente viejo/nuevo y plan de reversión.
- [ ] Aplicar en producción, verificar chat/ventas, retirar la retención (PT08).

## PT04 — Auth y correo
- [ ] Cuenta nueva/existente, OTP incorrecto/vencido, reenvío, recuperación, sesión activa.
- [ ] SMTP/Resend y límites de Auth (hoy `smtp_host` null, 2 correos/h, sin captcha).
- [ ] Matriz de acceso S02-B (solo lo funcional).

## PT05 — Ubicación fuera de Puebla (Villahermosa)
- [ ] Reproducir; separar geocodificación / radio de productos / cobertura operativa
      (`NEXT_PUBLIC_COVERAGE_RADIUS_KM`, `vicino_cobertura`, `exigir_cobertura_operacion`).
- [ ] Regla de producto acordada y coherente entre cliente y servidor.

## PT06 — Regresiones S01/S03/S06/S07 (sin rediseñar)
- [ ] Matriz de recorridos reales con roles dedicados.

## PT07 — iOS y notificaciones
- [ ] Conciliar `feat/bb03-piloto-regreso` (Liquid Glass piloto, log de token FCM, 1.1 (6) en TestFlight).
- [ ] Push por tipo y preferencias. `send-push` desplegada es la del 28-ago:
      no respeta preferencias (repo 16-sep).

## PT08 — Publicación web y App Store
- [ ] Retirar la retención en un commit revisado, comprobar despliegue, plan de reversión.
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
