# Validación local — 12 de septiembre de 2026

## Repositorio

La carpeta estaba vacía antes del clon. Comando ejecutado:

```text
git clone --branch feat/transferencia-mac-ios --single-branch https://github.com/Peter-code-bot/PROJECT-VICINO.git /Users/alumnos/Documents/VICINO
Cloning into '/Users/alumnos/Documents/VICINO'...
```

Código de salida: `0` tras autorizar la ejecución fuera del sandbox.
Verificación inmediatamente después del clon:

```text
git rev-parse HEAD
c152b202878a0dcf066ccf19b99e437bc3b2c0c2

git branch --show-current
feat/transferencia-mac-ios

git status --short
```

`git status --short`: **sin salida**. El estado inicial estaba limpio.

## Herramientas y dependencias

```text
sw_vers -productVersion
15.7.5
uname -m
arm64
xcode-select -p
/Applications/Xcode.app/Contents/Developer
xcodebuild -version
Xcode 26.0.1
Build version 17A400
node --version
v24.21.0
npm --version
11.19.0
```

Instalación con pnpm 9.15.0 y `--frozen-lockfile`: código de salida `0`.
Extractos de la salida (omitidas líneas de progreso y aviso de nueva versión):

```text
Scope: all 3 workspace projects
Lockfile is up to date, resolution step is skipped
Packages: +1116
Done in 11.4s
```

El proyecto existente contiene `CapApp-SPM`, FirebaseCore y FirebaseMessaging.
`Package.swift` fija Capacitor 8.3.0; `Package.resolved` fija Firebase 12.14.0.
La resolución con `-onlyUsePackageVersionsFromResolvedFile` terminó con código
`0`. El log completo está en
`node_modules/.cache/vicino-ios-lab/logs/vicino-spm-resolve-authorized.log`.

`git diff --exit-code` de ambos lockfiles, `capacitor.config.ts` y
`project.pbxproj`: **sin salida, código 0**. Ninguna versión se actualizó.

## Validación web

```text
node node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
```

Sin salida, código `0`.

Desde `apps/web`:

```text
node node_modules/@playwright/test/cli.js test --config playwright.gestures.config.ts --output /private/tmp/vicino-gesture-results-authorized
```

Última línea de la salida; omitida la lista de pruebas individuales:

```text
  24 passed (45.5s)
```

Código `0`. Log completo: `logs/vicino-gestures-authorized.log` en la caché del laboratorio.

```text
NODE_PATH=/Users/alumnos/Documents/VICINO/node_modules/.pnpm/node_modules node node_modules/@playwright/test/cli.js test --config playwright.frontend.config.ts --output /private/tmp/vicino-frontend-results
```

Última línea; omitida la lista de pruebas y avisos de color de terminal:

```text
  6 passed (2.2m)
```

Código `0`. Log completo: `logs/vicino-frontend.log` en la caché del laboratorio.

```text
node scripts/ios-local/verify.mjs
PASS: carga, categorías, borrador, Atrás, tema, navegación y chat simulado.
Browser errors: 0. External requests: 0.
```

Código `0`. La ausencia de solicitudes externas corresponde a la muestra
verificada en Chrome; no es una auditoría de red de los SDK nativos de Firebase.
Captura: `node_modules/.cache/vicino-ios-lab/browser.png`.

## Build iOS

```sh
xcodebuild -project apps/web/ios/App/App.xcodeproj -scheme App -configuration Debug -sdk iphonesimulator -destination 'generic/platform=iOS Simulator' -derivedDataPath apps/web/ios/DerivedData -clonedSourcePackagesDirPath /private/tmp/vicino-spm -disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO build
```

Últimas líneas; omitidas las miles de líneas de compilación anteriores:

```text
Touch /Users/alumnos/Documents/VICINO/apps/web/ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app (in target 'App' from project 'App')
    cd /Users/alumnos/Documents/VICINO/apps/web/ios/App
    /usr/bin/touch -c /Users/alumnos/Documents/VICINO/apps/web/ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app

** BUILD SUCCEEDED **
```

**Código de salida: `0`.** Log íntegro: `logs/vicino-ios-build.log` en la caché del laboratorio.
Se comprobó dentro del `.app` que existen `public/index.html`, `lab.js`,
`lab.css`, y que `capacitor.config.json` tiene `iosScheme: capacitor` y no tiene
`server.url`. No es un build de distribución ni una validación de firma.

Avisos observados, pendientes del lote nativo:

```text
warning: The image set "Splash" has 3 unassigned children.
warning: Metadata extraction skipped. No AppIntents.framework dependency found.
```

## Incidencias durante la preparación

- Primer clon, código `1`: `/Users/alumnos/Documents/VICINO/.git: Operation not permitted`.
  Resuelto tras autorizar la ejecución de Git.
- npm restringido, código `1`: `npm error network request to https://registry.npmjs.org/pnpm failed, reason: getaddrinfo ENOTFOUND registry.npmjs.org`.
  Resuelto al autorizar la descarga. Log original en `/private/tmp/vicino-npm-cache/_logs/2026-09-12T19_14_28_395Z-debug-0.log`.
- Primera resolución Swift, código `74`: `fatal: unable to access 'https://github.com/firebase/firebase-ios-sdk/': Could not resolve host: github.com`.
  Mismo fallo para otros repositorios. Log íntegro: `logs/vicino-spm-resolve.log`.
  La ejecución autorizada resolvió los paquetes.
- CoreSimulator restringido: `CoreSimulatorService connection became invalid. Simulator services will no longer be available.`
  La consulta autorizada confirmó el runtime iOS 26.0 y los dispositivos disponibles.
- Chrome restringido: `Error: browserType.launch: Target page, context or browser has been closed` y `Error: kill EPERM`.
  Las 24 pruebas fallaron antes de ejecutarse por ese bloqueo. Log íntegro de
  ese intento: `logs/vicino-gestures.log`. Las ejecuciones autorizadas pasaron.
- Primer arranque del servidor: `Error: listen EPERM: operation not permitted 127.0.0.1:4173`.
  Resuelto al autorizar el puerto local.
- Dos errores del script nuevo del laboratorio, corregidos durante su creación:
  `Error: Cannot find module 'postcss'` y `RangeError: Invalid code point 7669380`.
  Se resolvió PostCSS desde su paquete dependiente y se limitó Tailwind a
  `apps/web`. No se alteró código de producción para corregirlos.

## Estado de Git después de preparar el entorno

```text
git status --short
 M apps/web/ios/App/CapApp-SPM/Package.swift
?? scripts/ios-local/
```

HEAD continúa en el commit solicitado. `git diff --check`: sin salida, código
`0`. Los cambios son la regeneración de rutas SPM para la Mac y los scripts y
documentación de prueba. No se modificó master ni se hizo commit, push,
despliegue o subida a App Store.
