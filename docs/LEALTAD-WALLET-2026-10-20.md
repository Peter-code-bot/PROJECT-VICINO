# Tarjetas de lealtad en Apple Wallet y Google Wallet — 20-oct-2026

Para Alejandro y Pedro. Implementación del plan «Tarjetas de lealtad en Apple Wallet y
Google Wallet» (PDF v1.0 del 20-oct-2026): motor de lealtad (fase B), panel del negocio,
perfil público y tarjeta del cliente (fase C) y los adaptadores de emisión y actualización
de las dos carteras (fases A/D), detrás de variables de entorno.

Rama: `feat/tarjetas-lealtad-wallet`. Estado: **código listo y probado en local; la
migración NO está aplicada en producción** (ni en staging) y las dos carteras quedan
apagadas hasta que existan las credenciales que solo Pedro puede sacar (ver «Lo que exige
acción externa»). Sin credenciales la función **sí sirve**: el programa, las tarjetas, los
sellos y los canjes funcionan dentro de VICINO; solo faltan los botones «Añadir a Wallet».

## 1. Qué quedó hecho

**Base de datos — `supabase/migrations/20261020120000_tarjetas_de_lealtad.sql`.**
Ocho tablas con RLS: `loyalty_programs` (un programa vivo por negocio; estados borrador →
activo ↔ pausado), `loyalty_program_versions` (foto inmutable de las reglas en cada
publicación), `loyalty_memberships` (la tarjeta de cada cliente, con `public_id` opaco para
el QR y saldo cacheado), `loyalty_events` (bitácora: earn / redeem / reverse / adjust, con
índice único por origen: una venta = un sello, una reversa por evento),
`loyalty_redemptions` (canjes con código de 6 dígitos de un solo uso y 15 minutos de vida),
`wallet_passes`, `wallet_update_jobs` (outbox, escrita en la misma transacción que el saldo),
`apple_device_registrations` (máximo 5 dispositivos por pase) y `loyalty_sellos_fallidos`
(ventas cuyo sello no pudo registrarse; el negocio las ve en su panel y las repite).

Ningún cliente escribe un saldo: `authenticated` solo tiene SELECT sobre programas
publicados, sus propias membresías y sus eventos; todo lo demás pasa por RPC `SECURITY
DEFINER` que toma la identidad de `auth.uid()`:

| RPC | Quién | Qué hace |
|---|---|---|
| `loyalty_programa_guardar` | negocio | crea el borrador o actualiza el programa; cambiar reglas de uno publicado crea versión |
| `loyalty_programa_estado` | negocio | publica (versión 1) o pausa / reanuda |
| `loyalty_canje_confirmar` | negocio | teclea el código del cliente: descuenta sellos y cierra el canje en una transacción |
| `loyalty_revertir_evento` | negocio | evento compensatorio (nunca borra); se bloquea si esos sellos ya se canjearon |
| `loyalty_sello_desde_venta` | negocio | recuperación manual del sello de una venta propia (lista «Ventas sin sello» del panel) |
| `loyalty_resumen_negocio` | negocio | programa + métricas + actividad para el panel |
| `loyalty_inscribirse` | cliente | alta idempotente (varios clics, una tarjeta) |
| `loyalty_mis_tarjetas`, `loyalty_mi_tarjeta` | cliente | lista y detalle (incluye el código del canje pendiente) |
| `loyalty_canje_iniciar`, `loyalty_canje_cancelar` | cliente | pide / cancela un código de canje |
| `wallet_pase_preparar` | cliente | registra el pase de Apple o Google de su tarjeta |
| `wallet_jobs_tomar`, `wallet_job_terminar`, `wallet_snapshot_membresia` | service_role | la cola de sincronización |

El sello se otorga con un trigger `AFTER UPDATE` sobre `sale_confirmations` cuando la venta
pasa a `completed` (misma señal que ya usa el repo para puntos de confianza). El trigger
nunca tumba la venta: si algo falla deja un WARNING, apunta la venta en
`loyalty_sellos_fallidos` y el negocio la ve en su panel con un botón «Registrar sello». Una
venta que se completa antes de que el cliente tenga tarjeta no da sello.

**Paquete compartido.** `packages/shared/src/validators/loyalty.ts` y
`constants/loyalty.ts`: límites del PDF (nombre 32, premio 60, meta 3-20, condiciones 500),
paleta cerrada de 8 colores y 3 plantillas.

**Web (apps/web).**
- Negocio: `/seller/lealtad` (resumen, publicar / pausar, confirmar canje con el código,
  actividad con reversa) y `/seller/lealtad/editar` (formulario limitado con vista previa
  Apple y Google en vivo). Entrada «Lealtad» en el menú del panel.
- Perfil público (`/vendedor/[id]`): sección «Junta N sellos y recibe X» con «Unirme»
  (sin sesión manda a login y vuelve al mismo perfil), «Mi tarjeta» o «Administrar».
- Cliente: `/tarjetas` (mis tarjetas) y `/tarjetas/[id]` (progreso «3 de 5», QR del
  identificador, condiciones, historial, botón de canje con el código y su cuenta atrás,
  botones de Wallet cuando el proveedor está configurado). Enlaces en Configuración y en el
  menú de cuenta.
- Wallet (`apps/web/lib/wallet/`): `config.ts` lee las variables; `apple/pase.ts` arma y
  firma el `.pkpass` (storeCard) con `passkit-generator@3.7.0` (MIT, versión fijada);
  `apple/apns.ts` avisa a los teléfonos por APNs (HTTP/2 con el certificado del pase);
  `google/api.ts` crea la LoyaltyClass por programa y el LoyaltyObject por membresía y
  firma el enlace «Add to Google Wallet» (JWT RS256 con `node:crypto`, sin dependencias);
  `sincronizar.ts` procesa la outbox.
- Rutas API: `/api/wallet/apple/pase/[membershipId]` (descarga del pase por su titular),
  el web service de Apple en `/api/wallet/apple/v1/...` (registrar / dar de baja
  dispositivos, listar seriales actualizados, descargar la versión nueva, log; con cuota por
  IP) y el cron `/api/cron/wallet-sync` (`apps/web/vercel.json`, mismo `CRON_SECRET` que
  `recompute-rankings`).
- **Cuándo se sincronizan los pases.** El plan Hobby de Vercel solo admite crons diarios (un
  `*/10` haría fallar el despliegue), así que el cron es diario y de respaldo. Lo que mueve
  los pases de verdad es `drenarColaWallet()` con `after()` justo después de cada evento:
  confirmar una venta (`chat/actions.ts`), confirmar un canje, revertir y registrar un sello
  a mano. Si el proyecto pasa a Pro, se puede volver a un cron frecuente; otra opción es
  `pg_cron` + `pg_net` como ya hace el repo para otros trabajos.

## 2. Cómo se activa

1. **Aplicar la migración** (decisión de Pedro; Javier pide staging antes de prod):
   ```bash
   node scripts/apply-migration.mjs supabase/migrations/20261020120000_tarjetas_de_lealtad.sql
   ```
   Requiere que estén aplicadas `20261003213000_identidad_publica_modo_tienda.sql`
   (`profile_public_name`) y `20260912120000_suspension_impide_escribir.sql`
   (`vicino_guard.cuenta_suspendida`), las dos ya en producción. El archivo termina con un
   bloque que comprueba grants y funciones duplicadas y falla si algo quedó abierto.
2. **Regenerar los tipos:** `node scripts/gen-types.mjs`. Mientras tanto,
   `apps/web/types/loyalty.types.ts` declara las tablas y RPC nuevas a mano con la misma
   forma del codegen; cuando el generado las traiga, ese archivo puede reducirse al helper
   `conLealtad`.
3. **Desplegar** `master`. Con la migración aplicada y sin credenciales de Wallet, todo lo
   interno funciona y los botones de Wallet no aparecen.
4. **Encender cada cartera** poniendo sus variables en Vercel (Production) y redesplegando.

## 3. Variables de entorno (Vercel, nunca en el repo)

| Variable | Qué es |
|---|---|
| `APPLE_WALLET_PASS_TYPE_ID` | p. ej. `pass.com.vicinomarket.lealtad` |
| `APPLE_WALLET_TEAM_ID` | Team ID de la cuenta de Apple Developer |
| `APPLE_WALLET_SIGNER_CERT` / `APPLE_WALLET_SIGNER_KEY` | certificado del Pass Type ID y su clave privada (PEM; vale en base64) |
| `APPLE_WALLET_SIGNER_KEY_PASSPHRASE` | opcional |
| `APPLE_WALLET_WWDR_CERT` | certificado intermedio Apple WWDR G4 (PEM) |
| `GOOGLE_WALLET_ISSUER_ID` | número de emisor de Pay & Wallet Console |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_WALLET_PRIVATE_KEY` | cuenta de servicio autorizada en la consola, con la Wallet API habilitada |

Las cinco de Apple tienen que estar completas para que Apple se encienda; las tres de
Google, para Google. Documentadas en `apps/web/.env.example`.

## 4. Lo que exige acción externa (no se puede hacer desde el código)

- **Apple:** crear el Pass Type ID y su certificado en developer.apple.com, bajar el WWDR
  G4 y decidir la identidad emisora (hoy el pase dice «VICINO» como organización y el nombre
  del negocio como logo text). El PDF deja abierta la autorización de marcas por comercio.
- **Google:** abrir la cuenta emisora en Pay & Wallet Console, crear la cuenta de servicio,
  habilitar la Wallet API y **pedir acceso de publicación**: una cuenta nueva nace en modo
  demo y solo las cuentas de prueba ven los pases. Google exige además un logo público: el
  adaptador usa `https://vicinomarket.com/vicino-logo.png`.
- **Pruebas físicas:** guardar, actualizar (tras un sello y tras un canje), retirar y volver
  a añadir en un iPhone y un Android reales, desde el navegador y desde la app Capacitor. En
  la app, el enlace de Apple descarga un `.pkpass` y el de Google se abre con
  `Browser.open` (Chrome Custom Tab); si el WebView no abre Wallet con la descarga, el plan
  prevé un puente PassKit / SDK en iOS y Android (no hecho).
- **Vercel:** verificar que `CRON_SECRET` sigue puesto (lo usa el cron nuevo) y que el plan
  permite `maxDuration = 60` en `/api/cron/wallet-sync`.

## 5. Decisiones tomadas (para que Javier y Alejandro las revisen)

- **Inscripción antes que compra.** El sello solo lo recibe quien ya tenía tarjeta cuando se
  completó la venta. Evita regalar sellos retroactivos y lecturas raras del historial.
- **Canje con código de 6 dígitos tecleado por el negocio.** Ni el QR ni el saldo del pase
  autorizan nada (PDF, secciones 4 y 6). El código vive 15 minutos y solo hay uno pendiente
  por tarjeta; teclearlo dos veces devuelve el mismo resultado (doble lectura en caja).
- **Pausa.** Un programa en pausa no acepta altas nuevas ni suma sellos, pero el negocio
  **sí puede confirmar** un canje que ya estaba pendiente. Reanudar vuelve a sumar.
- **Reversa.** Es un evento compensatorio; si los sellos ya se gastaron en un premio, la
  base se niega (`ya_canjeado`) y hay que resolverlo con el cliente. No se borra historial.
- **Cambiar reglas de un programa publicado** crea una versión nueva; las tarjetas conservan
  su saldo y la versión que aceptaron. La meta vigente es la actual (un cliente con más
  sellos que la meta nueva puede canjear).
- **Borrado de cuenta.** Las tablas cuelgan de `profiles` con `ON DELETE CASCADE`: borrar la
  cuenta del cliente borra sus tarjetas e historial; borrar la del negocio borra el programa
  completo. Retención es una decisión abierta del PDF.
- **Datos que viajan al pase:** solo el **primer nombre** del cliente (`profiles.nombre`
  trae el nombre completo de Google y una tarjeta se fotografía), el nombre visible del
  negocio, las reglas del programa y el `public_id` opaco. Ni correo, ni teléfono, ni ids
  internos. El negocio también ve solo el primer nombre en su actividad.
- **Subir la meta no quita derechos.** A cada tarjeta se le cobra la meta vigente o la de la
  versión que aceptó, la menor (`loyalty_meta_canje`); al canjear, la tarjeta pasa a las
  reglas vigentes. Un cliente con 5 de 5 puede canjear aunque el negocio suba la meta a 10.
- **Topes anti-abuso en la base:** 10 cambios de reglas por día y por programa; 5
  dispositivos de Apple por pase; cuota propia (5/min por cuenta) para emitir pases y
  cuota por IP (60/min) en el web service de Apple. Un cambio visible del programa (nombre,
  premio, meta, condiciones, color) encola todos los pases existentes.
- **Log de Apple** (`/v1/log`) solo a la consola de Vercel: es un endpoint sin
  autenticación por diseño de Apple y mandarlo a Sentry regalaría cuota.

## 6. Decisiones abiertas (sección 11 del PDF, siguen abiertas)

1. Confirmar la modalidad: aquí va **sellos por venta completada**; visitas validadas por
   empleado y puntos por importe necesitan reglas distintas.
2. Si todos los canjes se confirman en VICINO y quién atiende caja (hoy: la cuenta del
   negocio; no hay roles de empleado).
3. Identidad emisora y autorización de marca por comercio; alta y publicación en Google.
4. Modificaciones de programas publicados, cancelaciones, vencimientos, datos visibles y
   retención (hoy: sin vencimiento, versiones inmutables, cascada al borrar cuenta).
5. Prioridad, calendario y presupuesto después de la prueba técnica.

## 7. Cómo probar en local

```bash
node node_modules/tsx/dist/cli.mjs scripts/test-lealtad-sql.ts
```
Motor completo en PostgreSQL por WASM (PGlite) con las migraciones reales de
`sale_confirmations` y del nombre público: 14 casos (alta idempotente, un sello por venta,
RLS por rol, canje atómico y doble lectura, código vencido, pausa, reversa, outbox y cola).

```bash
node node_modules/tsx/dist/cli.mjs scripts/test-lealtad-validadores.ts
cd apps/web && node --import tsx --test lib/wallet/google/jwt.test.ts lib/wallet/google/api.test.ts lib/wallet/config.test.ts lib/wallet/apple/pase.test.ts
```
Validadores, JWT de Google verificable, configuración desde el entorno y estructura del
`.pkpass` firmado con una cadena autofirmada creada con `openssl` al vuelo.

## 8. NO VERIFICADO

- La migración contra producción o staging (solo PGlite). Ledger y `gen-types` pendientes.
- Emisión real: ningún pase se ha abierto en un iPhone ni en un Android. La firma de Apple
  se probó solo con certificados autofirmados; la cadena WWDR real y la aceptación de iOS
  no. La API de Google no se ha llamado con credenciales reales (modo demo incluido).
- APNs: el aviso usa certificado del pase y cuerpo `{}` según la documentación; no se ha
  comprobado contra `api.push.apple.com`.
- La descarga del `.pkpass` y la apertura de Google Wallet **desde la app Capacitor**
  (WebView de Android e iOS).
- Concurrencia real: PGlite tiene una conexión; el orden de bloqueo (membresía → canje) y
  los índices únicos están pensados para dos conexiones, pero no ejercitados.
- Diseño: las pantallas reutilizan los tokens y componentes del repo, sin rediseño; quedan
  bajo revisión de Javier y Alejandro.
- `after()` de Next para drenar la cola tras cada evento: compila y pasa el build, pero no
  se ha observado en Vercel (sin credenciales no hace nada).
- Auditoría: `passkit-generator` trae `node-forge` con un aviso HIGH sin parche que afecta
  a VERIFICAR firmas (aquí solo se firma); queda ignorado y documentado en el
  `package.json` raíz. `joi` se fijó en 17.13.8 (parcheado).

## 9. Archivos

- `supabase/migrations/20261020120000_tarjetas_de_lealtad.sql`
- `scripts/test-lealtad-sql.ts`, `scripts/test-lealtad-validadores.ts`
- `packages/shared/src/{constants,validators}/loyalty.ts`, `packages/shared/src/index.ts`
- `apps/web/types/loyalty.types.ts`, `apps/web/lib/lealtad/*`, `apps/web/lib/wallet/**`
- `apps/web/app/api/wallet/**`, `apps/web/app/api/cron/wallet-sync/route.ts`, `apps/web/vercel.json`
- `apps/web/app/seller/lealtad/**`, `apps/web/app/(marketplace)/tarjetas/**`,
  `apps/web/components/lealtad/*`, `apps/web/app/(marketplace)/vendedor/[id]/page.tsx`,
  `apps/web/app/(marketplace)/chat/actions.ts` (drena la cola tras confirmar una venta),
  `apps/web/lib/rate-limit.ts` (dos limitadores nuevos), `package.json` raíz (joi + audit)
- `apps/web/components/layout/seller-sidebar.tsx`, `apps/web/components/profile/account-menu-drawer.tsx`,
  `apps/web/app/(marketplace)/configuracion/page.tsx`, `apps/web/.env.example`, `apps/web/package.json`
