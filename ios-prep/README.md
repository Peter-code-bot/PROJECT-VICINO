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
- `apple-app-site-association` (FASE 3) → necesita Team ID real de developer.apple.com.
- `assetlinks.json` fix Android (FASE 3, D5) → SHA256 de la clave final de Google.
- Generación de iconos/splash (FASE 6 → corre en Mac): assets source PNG pendientes de Pedro.
- Sign in with Apple capability + provider Supabase (FASE 5/7) → docs para la Mac.

## Color de marca nativo oficial: #0D0D1A
(usado en splash, status bar, background iOS — unificado en commit 7572a19)
