# Tarjetas de lealtad en Apple Wallet y Google Wallet — 20-oct-2026

Para Alejandro y Pedro. Implementación del plan «Tarjetas de lealtad en Apple Wallet y
Google Wallet» (PDF v1.0 del 20-oct-2026): motor de lealtad (fase B), panel del negocio,
perfil público y tarjeta del cliente (fase C) y los adaptadores de emisión y actualización
de las dos carteras (fases A/D), detrás de variables de entorno.

**Estado al 7-nov-2026.** La rama `feat/tarjetas-lealtad-wallet` entró a `master` con el
PR #76 (merge `547b9f3`, 21-oct-2026). Según el mensaje de `edcfce5`, la migración
`20261020120000` se aplicó en staging y después en producción el 21-oct-2026. Lo de staging
no se puede comprobar desde el repo; lo de producción sí, de forma indirecta:
`apps/web/types/database.types.ts` se genera desde el esquema de producción
(`scripts/gen-types.mjs`) y desde `edcfce5` y `a81e4b7` trae las 9 tablas y las RPC de
lealtad. Apple Wallet sigue **apagado**: responde 503 en producción, o sea que su
configuración está incompleta o es inválida (ver «Comprobado en producción»). Google Wallet
está **sin comprobar**: su estado no se ve con un GET. Que siga apagado es hipótesis; la
cerraría que Pedro confirme en Vercel que no hay ninguna variable `GOOGLE_WALLET_*` en
Production. Encender cualquiera de las dos exige las credenciales de «Lo que exige acción
externa». Sin credenciales, el programa, las tarjetas, los sellos y los canjes no dependen de
Wallet; solo faltan los botones «Añadir a Wallet». Eso está probado en PGlite, pero en
producción todavía no se ha observado ningún flujo con sesión.

El «NO APLICADA» de la cabecera de la migración es histórico: un archivo ya aplicado no se
edita.

## 1. Qué quedó hecho

**Base de datos — `supabase/migrations/20261020120000_tarjetas_de_lealtad.sql`.**
Nueve tablas con RLS: `loyalty_programs` (un programa vivo por negocio; estados borrador →
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
- Perfil público (`/vendedor/[id]`): sección «Junta N sellos y recibe X» con «Unirme»,
  «Mi tarjeta» o «Administrar». `/vendedor/[id]` está detrás del muro de sesión
  (`apps/web/lib/supabase/middleware.ts:87-91` con `requiereSesion` de
  `apps/web/lib/auth/acceso-invitado.ts`): un invitado va a `/login?next=/vendedor/<id>` antes
  de ver el perfil, y es ese `next=` el que lo regresa al mismo programa tras entrar. Por eso
  la rama «sin sesión → login» de `components/lealtad/oferta-lealtad.tsx` no la alcanza
  ningún invitado (inferido del código).
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
  `*/10` haría fallar el despliegue), así que el cron es diario (`15 9 * * *`, 09:15 UTC) y de
  respaldo. Lo que mueve los pases de verdad es `drenarColaWallet()` con `after()` justo
  después de cada evento: confirmar una venta (`chat/actions.ts`), confirmar un canje,
  revertir y registrar un sello a mano (`apps/web/app/seller/lealtad/actions.ts`). La cola es
  global: cualquier drenado toma los trabajos más antiguos, sean de quien sean. Si el
  proyecto pasa a Pro, se puede volver a un cron frecuente; otra opción es `pg_cron` +
  `pg_net` como ya hace el repo para otros trabajos.
- **Editar o pausar el programa no drena la cola.** Guardar un programa publicado con otras
  reglas u otro color encola los pases existentes (`loyalty_programa_guardar`), pero
  `guardarPrograma` (`apps/web/app/seller/lealtad/actions.ts:33-69`) no llama a
  `drenarColaWallet()`: ese cambio llega a los pases con el cron de las 09:15 UTC o cuando
  otro evento drene la cola. Pausar o reanudar (`loyalty_programa_estado`,
  `cambiarEstadoPrograma` en `actions.ts:71-89`) no encola nada: el estado del programa no
  se pinta en ningún pase.

## 2. Cómo se activa

1. **Aplicar la migración — hecho** el 21-oct-2026, primero en staging y después en
   producción, con `scripts/apply-migration.mjs` (según el mensaje de `edcfce5`). No se
   repite: el script consulta el ledger y se niega si la versión ya está registrada
   (candado 3 de `scripts/apply-migration.mjs`).
2. **Regenerar los tipos — hecho** en `edcfce5` y `a81e4b7`. `apps/web/types/loyalty.types.ts`
   ya no declara tablas ni RPC a mano: solo conserva `conLealtad` (hoy una identidad) y los
   alias `ClienteLealtad`, `WalletPassRow` y `MembresiaPropia`, sacados de
   `database.types.ts`. Ojo: el codegen tipa como `string` las columnas con CHECK (`status`,
   `proveedor`), no como uniones.
3. **Desplegar `master` — hecho.** Las rutas de Wallet responden en producción con sus
   propios cuerpos JSON (ver «Comprobado en producción»); las páginas con sesión no se han
   visto por dentro.
4. **Pendiente: encender cada cartera** poniendo sus variables en Vercel (Production) y
   redesplegando. Que Apple sigue apagado está comprobado; que Google también, es hipótesis
   (ver el estado al inicio). Las variables la encienden para todos los vendedores a la vez:
   la entrada «Lealtad» del panel no tiene condición
   (`apps/web/components/layout/seller-sidebar.tsx:33`) y `loyalty_programa_guardar` solo
   exige `es_vendedor`. No hay lista de negocios del piloto ni bandera global; dónde y cómo
   encenderlo primero lo deciden Pedro y Javier.

## 3. Variables de entorno (Vercel, nunca en el repo)

| Variable | Qué es |
|---|---|
| `APPLE_WALLET_PASS_TYPE_ID` | p. ej. `pass.com.vicinomarket.lealtad` |
| `APPLE_WALLET_TEAM_ID` | Team ID de la cuenta de Apple Developer |
| `APPLE_WALLET_SIGNER_CERT` / `APPLE_WALLET_SIGNER_KEY` | certificado del Pass Type ID y su clave privada (PEM; vale en base64) |
| `APPLE_WALLET_SIGNER_KEY_PASSPHRASE` | opcional |
| `APPLE_WALLET_WWDR_CERT` | certificado intermedio Apple WWDR G4 (PEM) |
| `GOOGLE_WALLET_ISSUER_ID` | número de emisor de Pay & Wallet Console (solo dígitos) |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL` / `GOOGLE_WALLET_PRIVATE_KEY` | cuenta de servicio autorizada en la consola, con la Wallet API habilitada |

Las cinco de Apple tienen que estar completas para que Apple se encienda; las tres de
Google, para Google (`apps/web/lib/wallet/config.ts:62-90`). Documentadas en
`apps/web/.env.example`. El web service de Apple y el cron usan además
`SUPABASE_SERVICE_ROLE_KEY` (la de `createAdminClient`) y `CRON_SECRET` (puesto: ver
«Comprobado en producción»).

## 4. Comprobado en producción

GET sin sesión a `https://vicinomarket.com`, el 7-nov-2026 (hora de México):

| Petición | Respuesta |
|---|---|
| `/api/wallet/apple/pase/00000000-0000-0000-0000-000000000000` | `503` `{"ok":false,"error":"apple_wallet_no_configurado"}` |
| `/api/cron/wallet-sync` sin `Authorization` | `401` `{"ok":false,"error":"unauthorized"}` |
| `/tarjetas` | `307` a `/login?next=%2Ftarjetas` |
| `/seller/lealtad` | `307` a `/login?next=%2Fseller%2Flealtad` |
| `/seller/lealtad/editar` | `307` a `/login?next=%2Fseller%2Flealtad%2Feditar` |
| `/vendedor/00000000-0000-0000-0000-000000000001` | `307` a `/login?next=%2Fvendedor%2F00000000-0000-0000-0000-000000000001` |

Cómo se leen:
- El 503 de Apple dice que la configuración de Apple está **incompleta o es inválida**, no
  que no haya ninguna variable: basta que falte una de las cinco o que un PEM no se pueda
  normalizar (`apps/web/lib/wallet/config.ts:65-80`). Hace falta un UUID bien formado: con
  otro id la ruta responde 404 antes de mirar la configuración
  (`apps/web/app/api/wallet/apple/pase/[membershipId]/route.ts:27`). Cuando Apple se
  encienda, un invitado recibirá `401` `{"ok":false}` (`route.ts:41`).
- El 401 del cron dice que `CRON_SECRET` está puesto: sin él la ruta respondería 500
  (`apps/web/app/api/cron/wallet-sync/route.ts:22-25`).
- Los 307 son el muro de sesión, con el destino en `next=`.
- Google Wallet no se puede comprobar con un GET: su estado solo se ve dentro de la acción
  `enlaceGoogleWallet` o en `/tarjetas/[id]` con sesión.
- Nada de esto prueba que el cron corra cada día ni que los flujos con sesión funcionen en
  producción: ninguna de las dos cosas se ha observado.

`scripts/smoke-produccion.mjs` repite las cuatro primeras en su bloque «Wallet» y exige el
código de estado además del cuerpo o del destino.

## 5. Lo que exige acción externa (no se puede hacer desde el código)

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
- **Vercel:** `CRON_SECRET` comprobado: el cron responde 401 sin cabecera el 7-nov-2026.
  `maxDuration = 60` en `/api/cron/wallet-sync` se da por aceptado porque la ruta está
  desplegada y responde (INFERIDO: no se ha visto una ejecución real del cron).

## 6. Decisiones tomadas (para que Javier y Alejandro las revisen)

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
- **Datos que viajan al pase:** el **primer nombre** del cliente (`profiles.nombre` trae el
  nombre completo de Google y una tarjeta se fotografía), el nombre visible del negocio, las
  reglas del programa y el `public_id` opaco del QR. Ni correo ni teléfono. **Sí viajan ids
  internos:** el serial del pase de Apple es `vicino-` más el UUID de la membresía
  (`wallet_pase_preparar` en la migración; `SERIAL_VALIDO` en
  `apps/web/lib/wallet/apple/web-service.ts:15`), y el `classId` y el `objectId` de Google
  llevan los UUID del programa y de la membresía (`apps/web/lib/wallet/google/api.ts:26-31`).
  Por sí solos no abren nada: las rutas exigen sesión o el token del pase. El título de la
  prueba de `apps/web/lib/wallet/google/api.test.ts` («…nada de correo ni ids internos»)
  tampoco es exacto: lo que comprueba es que no viaja el id del perfil. El negocio también ve
  solo el primer nombre en su actividad.
- **Subir la meta no quita derechos.** A cada tarjeta se le cobra la meta vigente o la de la
  versión que aceptó, la menor (`loyalty_meta_canje`); al canjear, la tarjeta pasa a las
  reglas vigentes. Un cliente con 5 de 5 puede canjear aunque el negocio suba la meta a 10.
- **Topes anti-abuso en la base:** 10 cambios de reglas por día y por programa; 5
  dispositivos de Apple por pase; cuota propia (5/min por cuenta) para emitir pases y
  cuota por IP (60/min) en el web service de Apple. Un cambio visible del programa (nombre,
  premio, meta, condiciones, color) encola todos los pases existentes.
- **Log de Apple** (`/v1/log`) solo a la consola de Vercel: es un endpoint sin
  autenticación por diseño de Apple y mandarlo a Sentry regalaría cuota.

## 7. Decisiones abiertas

De la sección 11 del PDF, siguen abiertas:

1. Confirmar la modalidad: aquí va **sellos por venta completada**; visitas validadas por
   empleado y puntos por importe necesitan reglas distintas.
2. Si todos los canjes se confirman en VICINO y quién atiende caja (hoy: la cuenta del
   negocio; no hay roles de empleado).
3. Identidad emisora y autorización de marca por comercio; alta y publicación en Google.
4. Modificaciones de programas publicados, cancelaciones, vencimientos, datos visibles y
   retención (hoy: sin vencimiento, versiones inmutables, cascada al borrar cuenta).
5. Prioridad, calendario y presupuesto después de la prueba técnica.

Fuera de la sección 11:

6. Serial opaco: que el serial de Apple y los ids de Google no lleven UUID internos (ver
   «Datos que viajan al pase»). No implementado. Conviene decidirlo antes del primer pase
   emitido, porque cambiar el serial después rompe las actualizaciones de los pases ya
   guardados.

## 8. Cómo probar en local

```bash
node node_modules/tsx/dist/cli.mjs scripts/test-lealtad-sql.ts
```
Motor completo en PostgreSQL por WASM (PGlite) con las migraciones reales de
`sale_confirmations` y del nombre público: 18 casos (alta idempotente, un sello por venta,
RLS por rol, canje atómico y doble lectura, código vencido, pausa, reversa, outbox, cola,
tope de versiones, ventas sin sello, tope de dispositivos y funciones sin duplicar).

```bash
node node_modules/tsx/dist/cli.mjs scripts/test-lealtad-validadores.ts
cd apps/web && node --import tsx --test lib/wallet/google/jwt.test.ts lib/wallet/google/api.test.ts lib/wallet/config.test.ts lib/wallet/apple/pase.test.ts
```
Validadores (4 casos) y, en `lib/wallet`, 10 casos en 4 archivos: JWT de Google
verificable, configuración desde el entorno y estructura del `.pkpass` firmado con una
cadena autofirmada creada con `openssl` al vuelo. Sin `openssl` en el PATH la prueba de
firma se omite (`skip`) en vez de fallar (`lib/wallet/apple/pase.test.ts`); en Windows,
correrla desde Git Bash, que trae `openssl`. Con poca memoria, añadir
`--test-concurrency=1`.

En CI, el job `type-check` de `.github/workflows/security.yml` corre los dos scripts de
lealtad y la suite unitaria completa de `apps/web` (los `*.test.ts` que lista
`git ls-files`), que incluye `lib/wallet`. El paso no le pasa a Node las rutas tal cual:
Node 22 lee cada argumento de `--test` como glob y descarta sin avisar el que no coincide
(una prueba bajo una carpeta `[id]`, por ejemplo). Por eso escapa los metacaracteres de
glob y, antes de correr, comprueba con `fs.globSync` que cada patrón da exactamente un
archivo.

## 9. NO VERIFICADO

- La migración en staging: solo lo afirma el mensaje de `edcfce5`; no se puede comprobar
  desde el repo. En producción la evidencia es indirecta: los tipos generados traen las
  tablas y las RPC. Las rutas sondeadas no cuentan: el 503 de Apple y el 401 del cron salen
  antes de tocar la base (`pase/[membershipId]/route.ts:29-32`, `wallet-sync/route.ts:22-30`)
  y los 307 son el muro de sesión. Lo cerraría, en staging y en producción, una consulta de
  solo lectura que solo Pedro puede hacer:
  `select version from supabase_migrations.schema_migrations where version = '20261020120000'`
  (el mismo ledger que consulta `scripts/apply-migration.mjs`), o
  `node scripts/gen-types.mjs --check` contra producción.
- Google Wallet apagado en producción: hipótesis (ver el estado al inicio). Lo cerraría
  confirmar en Vercel que no hay ninguna variable `GOOGLE_WALLET_*` en Production.
- El cron diario (`15 9 * * *` en `apps/web/vercel.json`): la ruta responde 401 sin cabecera,
  pero no se ha observado ninguna ejecución real.
- Flujos con sesión: crear y publicar un programa, unirse, sello tras una venta, canje y
  reversa no se han probado con cuentas reales, ni en staging ni en producción.
- Venta → sello con las RPC actuales: ninguna prueba lo cubre. `scripts/test-lealtad-sql.ts`
  aplica solo `20260320000007_sale_confirmations.sql` junto a la migración de lealtad, y
  `scripts/test-venta-chat-sql.ts` aplica las de venta del 23 y 24-oct pero no la de
  lealtad.
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

## 10. Archivos

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
- Vigilancia: `.github/workflows/security.yml` (job `type-check`) y
  `scripts/smoke-produccion.mjs` (bloque «Wallet»).
