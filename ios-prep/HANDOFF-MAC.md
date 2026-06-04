# HANDOFF-MAC · VICINO iOS · runbook para la fase Xcode + App Store

> **Para:** Pedro, en la Mac, una vez habilitada la cuenta Apple Developer.
> **De:** MP#09 (FASE 1-3, 5) ejecutada en Windows.
> **Cuándo:** después de instalar Xcode 26 y de tener la cuenta Apple Developer activa.
> Este documento es la receta. Síguela en orden. Lo que está hecho NO se rehace.

---

## 0. Estado actual y qué NO hay que rehacer

Estos commits ya están en `master` y vivos en producción (`https://vicinomarket.com`):

| Commit | Fase | Qué hace |
|---|---|---|
| `dfbbbae` | FASE 1 | Bloque `ios` en `apps/web/capacitor.config.ts`, `iosScheme: 'https'`, `viewportFit: 'cover'` en `app/layout.tsx`, color unificado `#0D0D1A`. |
| `1668396` | FASE 2 | `ios-prep/PrivacyInfo.xcprivacy`, `ios-prep/Info.plist.usage-strings.md`, `ios-prep/README.md`. |
| `0dd3df6` | FASE 3 | `apps/web/public/.well-known/apple-app-site-association` (AASA, Team ID placeholder), reparado `assetlinks.json` con upload key real + Google placeholder, `vercel.json` headers `Content-Type: application/json`. |
| `316faa4` | FASE 5 | `signInWithApple()` en `lib/auth/native-oauth.ts` (espejo de Google, OAuth web vía Custom Tab + deep link), botón "Continuar con Apple" en `login-form.tsx` y `register-form.tsx`, consent text actualizado. |

**FASE 4 (Supabase WKWebView hardening) es N/A** porque la decisión D1 fue Camino A (mantener `server.url: 'https://vicinomarket.com'`). El WebView carga el origen canónico, las cookies de `@supabase/ssr` funcionan sin storage adapter custom.

NO reimplementes nada de lo de arriba. Si Xcode o `cap add ios` te ofrece una opción que parece contradecirlo, NO la aceptes.

**Pendientes documentados que NO requieren Mac** (Pedro puede hacerlos en paralelo): Sección 5 (Supabase Apple provider) y Sección 10 (placeholders Team ID + Google SHA).

---

## 1. Pre-requisitos de la Mac (una vez por máquina)

- **macOS Sonoma o Sequoia.**
- **Xcode 26+** desde App Store (~12 GB descarga, ~40 GB tras setup). Obligatorio desde 28-abr-2026 para nuevas subidas a App Store Connect.
- **`xcode-select --install`** (Command Line Tools).
- **Node 22** (`nvm install 22` o Homebrew) + **pnpm** (`npm i -g pnpm@9.15.0` para coincidir con `packageManager` del root).
- **Xcode → Settings → Accounts → +** con tu Apple ID asociado al Apple Developer Program.
- **Verificación:** abre developer.apple.com con tu Apple ID. Si ves "Certificates, Identifiers & Profiles" en el menú lateral, la cuenta está activa.

Si la cuenta Apple Developer aún no está habilitada, espera el correo "Welcome to the Apple Developer Program". Sin esa cuenta, NO puedes firmar ni subir builds.

---

## 2. Crear la plataforma iOS (una vez en la vida del proyecto)

Capacitor 8 usa **Swift Package Manager** por defecto en iOS (no CocoaPods). `cap add ios` ya lo deja configurado SPM.

```bash
cd ~/path/a/startup-marketplace
git pull origin master
pnpm install
pnpm build                          # genera apps/web/.next + dist (Capacitor copia desde apps/web/dist o el webDir definido)
cd apps/web                         # capacitor.config.ts vive aquí
pnpm add @capacitor/ios
npx cap add ios                     # crea apps/web/ios/
npx cap sync ios                    # resuelve SPM + copia el bundle web
npx cap open ios                    # abre Xcode con apps/web/ios/App.xcworkspace
```

Si `cap sync ios` pregunta por CocoaPods, ignora (Cap 8 usa SPM por default). Si por alguna razón el proyecto se generó con Podfile, **NO lo migres ahora** — el plan ya asume SPM, abre un ticket aparte.

**Archivos que SÍ van a git** (Capacitor crea `.gitignore` correcto automáticamente — verifica que respete esto):

| Archivo / carpeta | Git |
|---|---|
| `ios/App/App.xcworkspace/`, `App.xcodeproj/project.pbxproj` | ✅ |
| `ios/App/App/AppDelegate.swift` | ✅ |
| `ios/App/App/Info.plist`, `App.entitlements` | ✅ |
| `ios/App/App/PrivacyInfo.xcprivacy` | ✅ |
| `ios/App/App/Assets.xcassets/` (sin iconos generados) | ✅ |
| `ios/App/App/Base.lproj/LaunchScreen.storyboard` | ✅ |
| `ios/App/App/public/` (bundle web copiado) | ❌ ignore |
| `ios/build/`, `DerivedData/`, `xcuserdata/`, `*.xcuserstate` | ❌ ignore |
| `.DS_Store` | ❌ ignore |

---

## 3. Aplicar los archivos de `ios-prep/` (mapa archivo → destino)

| `ios-prep/` (fuente) | Destino en Mac | Acción |
|---|---|---|
| `PrivacyInfo.xcprivacy` | `apps/web/ios/App/App/PrivacyInfo.xcprivacy` | `cp` + en Xcode: target App → Build Phases → Copy Bundle Resources → arrastrar el archivo → confirmar Target Membership = App ✅. |
| `Info.plist.usage-strings.md` | `apps/web/ios/App/App/Info.plist` | Pegar los 6 bloques `<key>...<string>...` dentro del `<dict>` raíz, antes de `</dict>`. |

**Recordatorios críticos al pegar los usage strings:**

- `NSLocationAlwaysAndWhenInUseUsageDescription` es OBLIGATORIO incluirlo aunque NO uses background. El linker de `ion-ios-geolocation` (transitiva de `@capacitor/geolocation`) lo exige; sin el string, falla la subida con **ITMS-90683**. El texto puede ser idéntico al de `WhenInUse`.
- **NO añadas** `NSUserTrackingUsageDescription` ni el framework `AppTrackingTransparency`. VICINO no hace tracking cross-app (sin IDFA). Si se incluye, dispara la prompt ATT obligatoria y rechazo por Guideline 5.1.2.
- `ITSAppUsesNonExemptEncryption = false` evita el prompt "Missing Compliance" en cada upload.

**Verificación post-pegar:**
- Xcode → seleccionar `Info.plist` → confirmar las 6 keys de usage + `ITSAppUsesNonExemptEncryption`.
- Xcode → seleccionar `PrivacyInfo.xcprivacy` → File inspector → Target Membership: App ✅.
- Build a Simulator (Product → Build). Si compila sin warning de "missing usage description", todo bien.

---

## 4. Config en Xcode

### 4.1 Signing & Capabilities

- **Target App → Signing & Capabilities:**
  - Team: el de VICINO (Organization) o tu Apple ID Individual (lo que decidieron al enrolar).
  - ✅ "Automatically manage signing" (recomendado para equipo de 1-3 devs).
  - Bundle Identifier: `com.vicino.mx` (INMUTABLE post-publish; ya está fijado por `appId` en `capacitor.config.ts`).

### 4.2 Capabilities a añadir (botón `+ Capability`)

| Capability | Para qué | Notas |
|---|---|---|
| **Push Notifications** | APNs (mensajes vendedor↔comprador, nuevas ofertas). FCM ya está del lado web/Android; iOS necesita APNs como capa de entrega. | Ver Sección 6. |
| **Background Modes** → check "Remote notifications" | Permite que iOS entregue push en background. | Solo "Remote notifications", no añadas Audio/Location background. |
| **Associated Domains** | Universal Links a `vicinomarket.com/listing/...` abren la app. | Añadir `applinks:vicinomarket.com` y `applinks:www.vicinomarket.com`. |
| **Sign In with Apple** | Recomendada por future-proofing aunque el flujo actual (commit `316faa4`) es OAuth web reusado. | NO es estrictamente requerida con OAuth web; si se añade hoy, no rompe nada y queda lista por si se migra a `ASAuthorizationController` nativo. |

### 4.3 `Info.plist` extra

- `ITSAppUsesNonExemptEncryption = false` (Boolean).

### 4.4 Generar assets (iconos + splash)

Requiere los PNG source que provee Pedro (FASE 6):
- `apps/web/assets/icon-only.png` ≥ 1024×1024, sin transparencia ni esquinas redondeadas (iOS las máscara).
- `apps/web/assets/splash.png` ≥ 2732×2732, logo centrado con márgenes amplios, fondo `#0D0D1A`.

Comando (desde `apps/web/`):
```bash
pnpm add -D @capacitor/assets
npx capacitor-assets generate --ios --iconBackgroundColor '#0D0D1A' --splashBackgroundColor '#0D0D1A'
```

Genera todos los tamaños del `AppIcon.appiconset` para iOS 26 (1024, 180, 167, 152, 120, 87, 80, 76, 60, 58, 40, 29) + variantes dark/tinted que iOS 18+ pide.

### 4.5 Verificar el bloque iOS de `capacitor.config.ts` se aplicó

Tras `cap sync ios`, abrir `ios/App/App/capacitor.config.json` (regenerado) y confirmar que contiene `ios.contentInset: 'never'`, `ios.backgroundColor: '#0D0D1Aff'`, `ios.appendUserAgent: 'VICINO-iOS'`, `server.iosScheme: 'https'`. Si NO está, algo salió mal en el copy — re-corre `npx cap sync ios`.

---

## 5. Config en Supabase Dashboard (NO requiere Mac — se puede hacer antes)

Esto activa el botón "Continuar con Apple" que ya existe en código (commit `316faa4`). Sin esto, el botón se muestra pero el login falla con error de provider — **esperado, NO bug**.

### 5.1 Apple provider en Supabase

**Dashboard → Authentication → Providers → Apple → Enable.**

Datos requeridos:
- **Service ID** (Apple Services ID): se crea en developer.apple.com → Identifiers → `+` → Services IDs. Es un identifier DISTINTO del Bundle ID `com.vicino.mx` (puede ser `com.vicino.mx.signin` o similar). Se asocia al primary App ID `com.vicino.mx`.
- **Sign in with Apple Key (.p8)**: developer.apple.com → Keys → `+` → Sign In with Apple. Se descarga UNA vez (Apple no la regenera). Guarda en 1Password con su Key ID y Team ID.
- **Team ID**: top-right de developer.apple.com.

Supabase genera el client secret del .p8 automáticamente cuando lo subes.

### 5.2 Redirect URLs

**Dashboard → Authentication → URL Configuration → Redirect URLs.** Confirmar que están allowlisted:
- `vicino://auth/callback` (deep link Capacitor; ya debería estar por Google).
- `https://vicinomarket.com/auth/callback-server` (web; ya debería estar por Google).

### 5.3 Documentar (para el handoff de iOS al equipo)

Si se migra a Camino C en el futuro (static export `output: 'export'`), añadir a CORS allowed origins: `capacitor://localhost` y `https://localhost`. **N/A hoy** porque el WebView carga `vicinomarket.com` y el origin runtime ES vicinomarket.com.

---

## 6. Push notifications iOS (APNs)

Javier ya implementó FCM end-to-end para web + Android (commits `3b72435`, `7f1134e`). Para iOS, APNs es la capa nativa que entrega las push; FCM puede actuar como router unificado, pero APNs es el transporte real en iOS.

### 6.1 Crear APNs Auth Key (.p8)

- developer.apple.com → **Keys** → `+` → check "Apple Push Notifications service (APNs)".
- Genera y **descarga el .p8 UNA VEZ** (Apple no permite re-descargar). Guarda con Key ID + Team ID.
- Esta key NO expira y reemplaza los antiguos certificados APNs (por device).

### 6.2 Conectar APNs a FCM (si usan FCM como router)

- Firebase Console → Project Settings → Cloud Messaging → Apple app configuration → upload `.p8` + Key ID + Team ID.
- Esto deja a FCM enviar push a iOS vía APNs sin código adicional del lado del servidor.

### 6.3 Capacitor + iOS

- Capability Push Notifications + Background Modes (Remote notifications) ya añadidas en sección 4.2.
- `@capacitor/push-notifications` ya está instalado (`apps/web/package.json:26`, viene del rebase de FASE 1-3).
- El hook `apps/web/hooks/usePushNotifications.ts` (de Javier) maneja el registro de token y los listeners de plugin. En iOS funcionará sin cambios de código.

### 6.4 Testing

- **Push NO funciona en Simulator iOS.** Solo en device físico real (iPhone/iPad).
- Local notifications sí funcionan en Simulator (no relacionado con APNs).

---

## 7. App Store Connect (metadata)

### 7.1 Crear app record

**App Store Connect → My Apps → `+` → New App:**
- Platform: iOS.
- Name: **VICINO**.
- Primary Language: **Spanish (Mexico) es-MX**.
- Bundle ID: `com.vicino.mx` (debe aparecer en el dropdown tras crear el App ID en developer.apple.com).
- SKU: `VICINO-IOS-001` (interno, no visible al usuario).

### 7.2 App Information

- **Privacy Policy URL:** `https://vicinomarket.com/privacidad`.
- **Support URL:** `https://vicinomarket.com/ayuda` o `mailto:admin@vicinomarket.com`.
- **Primary Category:** Shopping (mejor ASO en MX que Lifestyle).
- **Secondary Category:** Social Networking (por el componente UGC + chat).
- **Content Rights:** Yes, third-party content (fotos subidas por vendedores).
- **Age Rating questionnaire:** User-Generated Content = "Yes, Infrequent/Mild" → resulta en 12+ con moderación activa (que sí tenemos).

### 7.3 App Privacy (Nutrition Label)

**Crítico:** debe ser consistente con `PrivacyInfo.xcprivacy` (sección 3) y con la Privacy Policy. Apple cruza los tres.

| Data type | Linked | Tracking | Purpose | Origen |
|---|---|---|---|---|
| Email Addresses | Yes | No | App Functionality | Supabase auth |
| Name | Yes | No | App Functionality | Registro / perfil |
| User ID | Yes | No | App Functionality | Supabase user UUID |
| Precise Location | Yes | No | App Functionality | `@capacitor/geolocation` + PostGIS |
| Photos or Videos | Yes | No | App Functionality | `@capacitor/camera` + Storage |
| **Crash Data** | **No** | **No** | **App Functionality** | **Sentry (H2)** |
| **Performance Data** | **No** | **No** | **Analytics** | **Sentry (H2)** |

NSPrivacyTracking = false. Tracking Domains = vacío.

### 7.4 Screenshots

- **iPhone 6.9" (1320 × 2868 px)**: obligatorio. Generar en Simulator con iPhone 17 Pro Max o 16 Pro Max.
- **iPad 13" (2064 × 2752 px)**: solo si la app está habilitada para iPad. Para v1, decidir si entrega iPad (mínimo 3 screenshots si sí).
- PNG sin alpha. Mínimo 3, ideal 6-8. Las primeras 3 son las que se ven en search results.
- Sugerencias de capturas: home con listings cercanos, vista de listing con fotos+precio, chat vendedor↔comprador, perfil de vendedor con rankings, geolocalización en mapa, flujo de creación de listing.

---

## 8. Archive, TestFlight, Submit

### 8.1 Pre-archive checklist

- En Xcode → target App → General:
  - Version: `1.0.0`.
  - Build: `1` (incrementar en CADA subida).
- Compila en Simulator + device físico al menos 30 min seguidos, en LTE lento, en airplane mode (graceful), con permisos denegados (graceful).
- Demo account `apple.review@vicinomarket.com` (password fija que no expira) seedeada con: 10+ listings, 3+ chats, perfil completo, geo spoofed a Puebla Centro o listings visibles desde cualquier ubicación.

### 8.2 Archive

- Scheme toolbar → destination = **Any iOS Device (arm64)**.
- **Product → Archive** (2-10 min).
- Organizer → seleccionar archive → **Distribute App → App Store Connect → Upload**.
- Xcode genera certs Distribution + profile App Store automáticamente (Automatic signing).
- Upload (~5 min) + procesamiento Apple (10-60 min). Llega email cuando esté listo.

### 8.3 TestFlight

- **Internal Testing** (hasta 100 testers en el equipo de App Store Connect): instalación instant, sin review. Equipo fundador + devs + QA.
- **External Testing** (hasta 10,000 testers cualquier email o public link): requiere Beta App Review (24-48h) para el primer build de cada versión. Builds expiran a 90 días.

Para VICINO: beta externa con vendedores piloto en Puebla via public link compartido por WhatsApp.

### 8.4 Submit to App Store Review

En App Store Connect → versión 1.0.0 → "App Review Information": ver Sección 9 abajo.

**Version Release:** elegir **Manual** para v1.0.0 (controlas el timing del lanzamiento marketing). Para v1.1.0+, usar **Phased Release** (rollout 7 días: 1%/2%/5%/10%/20%/50%/100%, pausable).

**Tiempos:** 90% en <24h, promedio 24-48h. Evitar diciembre 23-27 (Apple cierra App Store). Submit martes-jueves AM para velocidad. Primera submission tiene scrutiny extra: buffer 5-7 días.

### 8.5 Si rechazan

**Resolution Center** dentro de App Store Connect. Tres opciones:
1. Responder con clarificación (24-72h).
2. Arreglar el código → resubmit (re-review 12-24h).
3. Apelar a un comité distinto (5-10 días, ~50% de éxito si bien fundamentado).

**Nunca resubmitir sin arreglar**. Apple trackea esto y penaliza future reviews.

---

## 9. App Review Notes (texto listo para pegar)

Pegar TAL CUAL en **App Store Connect → versión 1.0.0 → App Review Information → Notes:**

```
VICINO es un marketplace hiperlocal P2P que conecta vendedores informales
("nenis", emprendedores, PyMEs) con compradores cercanos en Puebla, México.

CAPABILITIES NATIVAS iOS (Guideline 4.2 minimum functionality):
- Core Location / GPS: listings filtrados por distancia real del usuario en
  tiempo real. Sin GPS, la app pierde su valor central.
- AVFoundation Camera: vendedores toman fotos in-app de productos a vender.
- APNs Push Notifications: mensajes vendedor↔comprador en tiempo real,
  notificaciones de ofertas, citas, ventas y reseñas.
- Haptic feedback en interacciones clave (tap en tabs, bloqueo de usuario).
- Native Share Sheet del sistema para compartir listings.
- Universal Links: vicinomarket.com/listing/{id} abre la app cuando está
  instalada; cae al sitio web si no.

PAGOS (Guideline 3.1.3(e) physical goods):
VICINO solo conecta partes; las transacciones de bienes físicos se procesan
FUERA de la app vía Stripe / MercadoPago / efectivo. NO usamos In-App
Purchase porque la guideline 3.1.3(e) lo prohíbe para bienes físicos
consumidos fuera de la app. Sin transacciones digitales en v1.

ELIMINAR CUENTA (Guideline 5.1.1(v)):
Cumplido in-app en /configuracion (botón rojo → escribir "ELIMINAR" → confirmar).
También accesible via URL pública: https://vicinomarket.com/eliminar-cuenta
(bilingüe, declarada en Google Play Data Safety). Implementado vía Edge Function
y RPC `delete_user_data(uuid)` que borra listings, mensajes, reportes, bloqueos
y el row de auth.users.

SIGN IN WITH APPLE (Guideline 4.8):
Habilitado side-by-side con Google. Ambos botones aparecen en /login y /register.
Implementación: Supabase OAuth web flow vía Capacitor Browser (Custom Tab) +
deep link callback vicino://auth/callback. Email relay @privaterelay.appleid.com
tratado como email válido.

UGC (Guideline 1.2):
- Filtro de contenido objetable antes de publicar.
- Reportar contenido: botón en cada listing/mensaje/perfil, categorías
  (spam, sexual, violencia, fraude, suplantación).
- Bloquear usuarios: bidireccional via RLS Supabase (si A bloquea a B,
  ni A ve a B ni B ve a A en queries de profiles, productos, reviews,
  mensajes).
- Panel admin de moderación con SLA <24h revisar / <48h actuar.
- EULA: Apple Standard EULA + Términos del Marketplace propios en
  https://vicinomarket.com/terminos.

DEMO ACCOUNT (para el reviewer):
Username: apple.review@vicinomarket.com
Password: [PASSWORD_FIJA_QUE_NO_EXPIRA]

La cuenta demo viene con ~30 listings, 3+ chats activos, perfil completo,
y está geo-spoofed para que aparezcan vendedores desde cualquier ubicación.

Para probar geolocalización real desde Cupertino:
1. iOS Simulator > Features > Location > Custom Location.
2. Coordenadas Puebla Centro: 19.0414, -98.2063.
3. Cierra y vuelve a abrir la app — verás los listings reales de Puebla.

CONTACTO URGENTE: admin@vicinomarket.com
```

Reemplazar `[PASSWORD_FIJA_QUE_NO_EXPIRA]` con una password real fija (no rotada entre reviews, no expirable, no requiere OTP).

---

## 10. TODOs con placeholder (rellenar cuando haya los datos)

| TODO | Origen | Dónde rellenar | Cómo |
|---|---|---|---|
| `TEAMID10X` en AASA | FASE 3, AASA placeholder | `apps/web/public/.well-known/apple-app-site-association` | developer.apple.com → top-right (al lado del nombre) muestra el Team ID. Reemplazar `TEAMID10X` por el real. Commit + push → Vercel redeploy. Después en Mac: `swcutil dl -d vicinomarket.com` para forzar refresh del CDN de Apple. |
| `<<<GOOGLE_APP_SIGNING_SHA256>>>` en assetlinks | FASE 3, D5 | `apps/web/public/.well-known/assetlinks.json` | Play Console → VICINO → Test and release → App integrity → Play app signing → "App signing key certificate" → SHA-256. Reemplazo de 1 línea + redeploy. **NO requiere re-submit del APK** — `assetlinks` se actualiza sin tocar el binario. |
| Apple `name` first-login (P3-1 Codex) | FASE 5 self-review | `app/(auth)/perfil/editar` o trigger `profiles` | Apple solo manda `name` en el primer login y solo si el usuario lo permite. Si el trigger Supabase crea row en `profiles.nombre` desde `raw_user_meta_data.full_name`, Apple-first-login podría dejar el campo vacío. Mitigación post-MVP: fallback "completa tu nombre" en `/perfil/editar` o en el callback del registro. NO bloquea v1. |
| Demo account real | FASE 7 | App Store Connect | Crear cuenta `apple.review@vicinomarket.com` con password fija, seedear datos en Supabase. |
| Screenshots iPhone 6.9" + iPad 13" | FASE 7 | App Store Connect | Generar en Simulator con device físico virtual correcto. |
| Password fija en App Review Notes | FASE 7 | Sección 9 arriba | Reemplazar `[PASSWORD_FIJA_QUE_NO_EXPIRA]` antes de submit. |

---

## 11. Loop de desarrollo Windows ↔ Mac

### Día a día (Windows, Claude Code)

```bash
git pull
# editar código TS/Next/Tailwind
pnpm build
cd apps/web && npx cap copy ios     # solo copia out/ → ios/App/App/public/
                                     # OK en Windows (NO requiere CocoaPods/SPM resolve)
cd ../..
git add . && git commit -m "..." && git push
```

`npx cap sync` en Windows falla porque no puede resolver SPM. Usar `npx cap copy ios` que solo copia archivos.

### Release / testing en Mac

```bash
git pull
pnpm install
pnpm build
cd apps/web
npx cap sync ios                     # resuelve SPM + copia bundle
npx cap open ios                     # abre Xcode → ▶️ Simulator o device
# para release: Product → Archive (sección 8.2)
```

---

## 12. Errores comunes de upload (ITMS-9xxxx) y fixes

| Error | Causa | Fix |
|---|---|---|
| **ITMS-91053** | Falta declarar Required Reason API en privacy manifest | Verificar que `PrivacyInfo.xcprivacy` está en target App + Copy Bundle Resources (Sección 3). |
| **ITMS-90683** | Falta `NSLocationAlwaysAndWhenInUseUsageDescription` (linker `ion-ios-geolocation`) | Verificar Info.plist tiene los 6 strings (Sección 3). |
| **ITMS-90078** | Push capability sin profile válido | Regenerar profile con capability Push Notifications habilitada en developer.apple.com → Identifiers → App ID. |
| **ITMS-90504** | Entitlements no matchean App ID capabilities | Sincronizar Xcode con Developer Portal (Xcode → Signing & Capabilities → click "Try Again"). |
| **Missing Compliance prompt recurrente** | No declaraste encryption | Setear `ITSAppUsesNonExemptEncryption = false` en Info.plist (Sección 3). |
| **Missing icons** | `AppIcon.appiconset` incompleto | Correr `@capacitor/assets generate --ios` (Sección 4.4). |

---

## Cierre

Esta documentación cubre el camino completo desde "abrir Xcode por primera vez" hasta "submission a App Review". Si encuentras algo no documentado, anótalo y agréga aquí mismo — este archivo es la fuente de verdad para la fase Mac de VICINO iOS.

Color oficial: `#0D0D1A`. Bundle: `com.vicino.mx`. Dominio: `vicinomarket.com`. Supabase project ref: `oxxdkwywprkfghhbnoto`.

Buena suerte con la submission.
