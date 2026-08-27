# Compilar APK de VICINO en Windows

## Requisitos

| Herramienta | Versión | Instalación |
|---|---|---|
| Node.js | 20+ | winget / nodejs.org |
| pnpm | 9+ | `npm install -g pnpm` |
| JDK | 21 (Temurin) | `winget install EclipseAdoptium.Temurin.21.JDK` |
| Android Studio | 2025.x | `winget install Google.AndroidStudio` |
| Android SDK | API 36 + build-tools 36.x | SDK Manager en Android Studio |

## Variables de entorno (configurar una vez)

```powershell
# Usuario — no requiere admin
[System.Environment]::SetEnvironmentVariable('JAVA_HOME', 'C:\Program Files\Eclipse Adoptium\jdk-21.0.10.7-hotspot', 'User')
[System.Environment]::SetEnvironmentVariable('ANDROID_HOME', 'C:\Users\pc\AppData\Local\Android\Sdk', 'User')
[System.Environment]::SetEnvironmentVariable('ANDROID_SDK_ROOT', 'C:\Users\pc\AppData\Local\Android\Sdk', 'User')
```

## Build rápido (debug)

```powershell
cd apps\web

# Sincronizar config de Capacitor al proyecto Android nativo
npx cap sync android

# Compilar APK debug
cd android
.\gradlew.bat assembleDebug
```

APK resultante:
```
apps\web\android\app\build\outputs\apk\debug\app-debug.apk
```

## Build release (Play Store)

```powershell
cd apps\web\android
.\gradlew.bat bundleRelease
```

AAB resultante:
```
apps\web\android\app\build\outputs\bundle\release\app-release.aab
```

Requiere keystore configurado en `android\app\build.gradle` (sección `signingConfigs`).

## Instalar en celular (USB debugging activado)

```powershell
cd apps\web\android
adb devices          # verificar que el celular aparece
.\gradlew.bat installDebug
```

## Notas

- El APK es un **WebView wrapper** que carga `vicinomarket.com`, el dominio
  canónico (ver `capacitor.config.ts`). El host legado
  `startup-marketplace-web.vercel.app` sigue en `allowNavigation` porque la
  Data Safety URL de Google Play lo referencia. Comprobado el 26-ago-2026:
  ese host responde **200 con la app completa**, no un 308
- No requiere build del frontend local para el APK debug
- Primera compilación descarga Gradle (~200 MB) + dependencias — tarda 10-20 min
- Compilaciones posteriores son rápidas (~1-2 min con cache)
- `local.properties` (sdk.dir) se genera automáticamente, no commitear
