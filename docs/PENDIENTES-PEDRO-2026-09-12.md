# Lo que necesita tus manos — 12 de septiembre de 2026

Todo lo que Claude no puede hacer por ti porque implica crear cuentas, pegar credenciales o subir a una tienda. Cada punto trae el orden, los comandos y cómo comprobar que quedó.

## 1. Upstash: el freno de peticiones (antes que el SMTP)

Hoy Vercel **no tiene** `UPSTASH_REDIS_REST_URL` ni `UPSTASH_REDIS_REST_TOKEN` en Production (comprobado con `vercel env ls production` el 12-sep). Sin ellas, todos los limitadores de `apps/web/lib/rate-limit.ts` son un no-op: login, escrituras, búsqueda, reportes, códigos de verificación. Medido el mismo día: 48 de 48 peticiones a `/auth/callback-server` pasaron sin freno (`node scripts/verificar-rate-limit.mjs`).

1. En [console.upstash.com](https://console.upstash.com) crea una base **Redis**, región **us-west-1** (la base y las funciones ya viven en us-west; el Redis se consulta antes de responder). Tipo regional, sin TLS extra: el cliente usa la API REST.
2. Copia **UPSTASH_REDIS_REST_URL** y **UPSTASH_REDIS_REST_TOKEN** de la pestaña *REST API* de esa base. Los nombres los fija `Redis.fromEnv()`: no se renombran.
3. En Vercel → proyecto `vicinomarket` → *Settings* → *Environment Variables* → añade las dos con alcance **Production** (y Preview si quieres que los previews también frenen).
4. **Redeploy** del último deployment de producción (las variables solo entran en despliegues nuevos).
5. Verifica por comportamiento, no por configuración:

```bash
node scripts/verificar-rate-limit.mjs
```

Debe decir «FRENO VIVO» y que la primera frenada fue la #21. Si dice «SIN FRENO», falta el redeploy o las credenciales no son las de esa base.

## 2. SMTP propio con Resend (después de Upstash)

Sin SMTP propio Supabase capa **todo el proyecto a 2 correos por hora**: la tercera persona que se registra en una hora no recibe su código. Va después de Upstash porque subir el techo de correos sin freno abre el mail bombing por el botón de reenviar.

Requisitos: dominio verificado en Resend (el mismo desde el que ya envías con `RESEND_FROM_*`) y una API key de Resend con permiso de envío. La contraseña SMTP de Resend **es** una API key.

En **PowerShell** (la clave nunca se teclea en la línea de comandos: PSReadLine guarda cada línea en `ConsoleHost_history.txt`):

```powershell
node scripts/aplicar-config-otp.mjs --ver
$s = Read-Host "Clave de Resend" -AsSecureString
$env:RESEND_SMTP_PASS = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($s))
node scripts/aplicar-config-otp.mjs
Remove-Item Env:\RESEND_SMTP_PASS
```

El `--ver` primero solo lee y compara. El segundo aplica código de 6 dígitos + plantilla + SMTP (`smtp.resend.com`, puerto 465, usuario `resend`). Comprobación: regístrate con tres correos distintos en la misma hora; los tres deben recibir código.

## 3. Google Play: subir el AAB a la pista interna

Generado y firmado el 12-sep-2026 con la upload key `C:\Users\pedro\keystores\vicino-upload.jks` (alias `vicino-upload`, CN=VICINO Upload; **no** con `apps/web/android/app/vicino-release.keystore`, que el build no usa):

| Dato | Valor |
|---|---|
| Archivo | `apps/web/android/app/build/outputs/bundle/release/app-release.aab` (copia en el Escritorio: `VICINO-1.6-versionCode7.aab`) |
| versionCode / versionName | 7 / 1.6 (`apps/web/android/app/build.gradle`) |
| Tamaño | 8,449,903 bytes |
| SHA-256 | `c8eac0a7d36ec30db5bc4a09ec8b1c9da841374527390422badf38f7abefae69` |
| applicationId | `com.vicino.mx`, minSdk 24, targetSdk 36 |

Es el build de las **13:30**, regenerado a petición de la sesión de Play Store: el manifest ya **no** declara `READ_MEDIA_IMAGES` ni `READ_MEDIA_VIDEO` (la Play Console exigía la declaración de permisos de fotos y videos, y la app no los necesita: todas las subidas usan `<input type="file">`, que abre el selector del sistema; `CAMERA` sigue declarado para la selfie de verificación). Un AAB anterior de las 13:09 (SHA-256 `f51db069…8e4b39`) **no se debe subir**. Al probar en un dispositivo, comprueba que «subir foto de producto», la foto del chat y la selfie de verificación siguen abriendo galería y cámara.

La sesión de Play Store ya dejó guardado en la consola (12-sep): declaración de ID de publicidad = No, Seguridad de los datos (ubicación precisa + registros de fallas y diagnóstico por Sentry), 12 listas de verificadores seleccionadas y el sitio web en Configuración de la tienda. El bump 6→7 y el cambio del manifest están commiteados juntos (`ef721b9`).

Lo que queda es tuyo, en [Play Console](https://play.google.com/console) → `com.vicino.mx`:

1. *Testing* → *Closed testing* → el borrador de la versión: **quita el AAB 6**, sube `VICINO-1.6-versionCode7.aab`, notas de la versión, *Review release* y envía a revisión. La declaración de permisos de fotos y videos desaparece sola cuando el AAB 6 deje de estar en la versión. Si ya lo hiciste, salta este punto.
2. **Verificadores**: la cuenta es personal y Google exige **12 verificadores que acepten el enlace de participación y sigan 14 días seguidos** antes de poder pedir acceso a producción. Hoy hay exactamente 12 listas seleccionadas, cero margen: consigue 15-20 correos y confirma en *Panel* → *Prueba cerrada* cuántos han aceptado. El calendario real es de ~3 semanas desde que envíes la prueba.
3. **Verificación de desarrolladores de Android** (aviso de Google): registra el paquete `com.vicino.mx` antes del **30-sep-2026**. La página ya muestra 1 paquete registrado; confirma que sea ese.
4. **Deep links («dominios no verificados»)**, no bloquea la revisión, pero conviene cerrarlo en el siguiente AAB (versionCode 8):
   - `www.vicinomarket.com` responde 308 al apex y el verificador de Google no sigue redirecciones; con www dentro del filtro `autoVerify` fallaba la verificación entera. Ya lo moví al filtro manual en `AndroidManifest.xml` (entra con el próximo build; el AAB 7 lo lleva como antes).
   - `apps/web/public/.well-known/assetlinks.json` solo trae la huella de la **upload key** (`2C:81:C7…`). Play firma la app con **otra** clave: copia la huella SHA-256 de *Configuración* → *Integridad de la app* → *Firma de apps* → *Certificado de clave de firma de apps* y pásamela (o añádela tú como segundo elemento del arreglo `sha256_cert_fingerprints`). Sin eso, los enlaces `https://vicinomarket.com/...` no abrirán la app instalada desde Play.

## 4. Decisión: el secreto JWT del proyecto salió en una transcripción

Al leer la configuración de PostgREST por la Management API (`GET /v1/projects/<ref>/postgrest`) la respuesta incluye `jwt_secret` y se imprimió en la sesión de Claude del 12-sep. No se usó para nada. Con ese secreto se pueden firmar JWT válidos para cualquier usuario mientras esté vigente.

Opciones: (a) rotarlo en Supabase → *Settings* → *API* → *JWT Settings* → *Generate a new JWT secret*: invalida todas las sesiones activas y las claves `anon`/`service_role` legacy (hay que actualizar `NEXT_PUBLIC_SUPABASE_ANON_KEY` en Vercel y `.env.local`, y el vault `service_role_key` que usan los triggers de push); (b) no rotar, asumiendo que la transcripción es privada. Es tu llamada; si rotas, hazlo fuera de horario y con el runbook de claves filtradas (`docs/RUNBOOK-claves-filtradas.md`) a mano.

## 5. Proyecto Supabase de pruebas

`vicino-pruebas-2026-09-12` (ref `eubrewrdayqpruponkkd`, org Pro, micro: ~1 centavo por hora). Tiene las 158 migraciones replicadas, comunidades, el contrato de chat y usuarios de prueba. Claude lo borra al cerrar la jornada; si lo ves vivo después, bórralo desde el Dashboard (*Settings* → *General* → *Delete project*).

## 6. Lo que Alejandro tiene que integrar (no necesita tus manos)

- **Contrato de chat** (`feat/chat-intencion-idempotente`, sin desplegar): `docs/CONTRATO-iniciar-conversacion.md`. Cuando lo apruebe, aplicar con `node scripts/apply-migration.mjs 20260912300000_iniciar_conversacion_idempotente.sql` y regenerar tipos.
- **Liquid Glass**: los puntos candidatos en la página de comunidades están en `openspec/changes/2026-09-05-comunidades/LIQUID-GLASS-PUNTOS.md`, pendientes de tu plan.
