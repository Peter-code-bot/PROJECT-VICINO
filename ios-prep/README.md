# ios-prep — Staging de archivos nativos iOS (preparados en Windows)

Estos archivos se generaron en la laptop Windows porque la carpeta `ios/` no existe
hasta correr `cap add ios` en la Mac. Aquí está el mapa de dónde va cada uno.

## Mapa archivo → destino (en la Mac, tras `npx cap add ios`)
| Archivo en ios-prep/            | Destino en la Mac                          | Acción |
|---------------------------------|--------------------------------------------|--------|
| `PrivacyInfo.xcprivacy`         | `ios/App/App/PrivacyInfo.xcprivacy`        | copiar + agregar al target en Xcode (Build Phases → Copy Bundle Resources) |
| `Info.plist.usage-strings.md`   | `ios/App/App/Info.plist`                   | pegar los bloques `<key>...</key>` dentro del `<dict>` raíz |

## Verificación en la Mac (tras pegar)
- `PrivacyInfo.xcprivacy` debe aparecer en target App → Build Phases → Copy Bundle Resources.
- Confirmar que los 6 usage strings están en Info.plist y `ITSAppUsesNonExemptEncryption=false`.

## Pendientes que se completan en fases posteriores (NO ahora)
- `apple-app-site-association` creado en `apps/web/public/.well-known/` (FASE 3).
  TODO: rellenar `TEAMID10X` con Team ID real de developer.apple.com cuando se habilite la cuenta.
- `assetlinks.json` arreglado (FASE 3, D5):
  - ✅ Upload key SHA-256 insertada: `2C:81:C7:8C:89:E1:0A:3B:68:F3:B5:B7:5F:DA:30:C1:E4:CA:F2:EE:5F:42:E8:33:6B:0B:F4:78:21:2A:E0:B3`
    (verificada vía .aab, CN=VICINO Upload).
  - 🟡 TODO: rellenar `<<<GOOGLE_APP_SIGNING_SHA256>>>` desde
    Play Console → Protegido con Play → Protección de Play Store → Firma de aplicaciones de Play →
    "App signing key certificate" → SHA-256
    (alternativa: Prueba y lanza → Pruebas → Prueba interna → "App signing key certificate").
- `vercel.json` actualizado con headers Content-Type: application/json para los dos archivos `.well-known`.
- Generación de iconos/splash (FASE 6 → corre en Mac): assets source PNG pendientes de Pedro.
- Sign in with Apple capability + provider Supabase (FASE 5/7) → docs para la Mac.

## Verificación post-deploy (cuando esté vivo en Vercel)
```
curl -s https://app-site-association.cdn-apple.com/a/v1/vicinomarket.com
curl -s https://vicinomarket.com/.well-known/assetlinks.json
```

## Color de marca nativo oficial: #0D0D1A
(usado en splash, status bar, background iOS — unificado en commit 7572a19)
