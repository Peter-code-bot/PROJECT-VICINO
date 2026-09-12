# Pruebas locales de fluidez en la Mac

Este laboratorio usa los componentes reales `PageSwipeWrapper`,
`PullToRefreshWrapper`, `HomeCategoryOrder` y `SkeletonLista` de la rama.
El router, las publicaciones, el perfil y el chat son simulados. No carga `.env`,
no necesita cuentas y no ejecuta Server Actions ni consultas a Supabase.

Permite revisar gestos, categorías, conservación de borradores al reordenar,
temas y navegación con una demora de 100, 800 o 2500 ms. No representa una
medición del servidor Next/RSC, del backend, de haptics en hardware ni de la
aplicación completa. Liquid Glass y las nuevas transiciones siguen pendientes.

## Navegador

Desde la raíz del repositorio:

```sh
node scripts/ios-local/lab.mjs serve
```

Abrir http://127.0.0.1:4173. El servidor escucha solo en esta Mac.
Después de editar componentes, reiniciar el comando para regenerar el bundle.
Para verificar carga, categorías, borrador, Atrás, tema, navegación y chat:

```sh
node scripts/ios-local/verify.mjs
```

La comprobación usa Chrome instalado con un perfil temporal y comprueba que no
haya errores JavaScript ni solicitudes a orígenes externos.

## Preparar el proyecto iOS existente

```sh
node scripts/ios-local/lab.mjs prepare-ios
```

El comando regenera la muestra, ejecuta `cap sync ios` sobre `apps/web/ios` y
copia los recursos a `apps/web/ios/App/App/public`. Después sustituye el bloque
`server` **únicamente en el JSON generado e ignorado por Git**, para cargar
`capacitor://localhost` sin una URL remota. `capacitor.config.ts` conserva su
configuración de producción. No se usa `cap add ios` ni CocoaPods.

Capacitor advierte que `dist` no existe: este proyecto usa una web remota y
`next build` no genera ese directorio. El laboratorio copia sus recursos
directamente después del sync. No hay que crear un export estático de Next.

**Un `cap sync` o `cap copy` posterior restaura la URL de producción en el JSON.**
Ejecutar de nuevo `prepare-ios` antes de compilar otra muestra y comprobar:

```sh
node -e 'const c=require("./apps/web/ios/App/App/capacitor.config.json"); if(c.server.url || c.server.iosScheme!=="capacitor") process.exit(1); console.log(c.server)'
```

Los bundles y capturas del laboratorio se guardan en
`node_modules/.cache/vicino-ios-lab`; los recursos iOS y DerivedData también
están ignorados. El único archivo iOS versionado que `cap sync` cambió al
preparar esta Mac fue `CapApp-SPM/Package.swift`: regeneró diez rutas de Windows
como rutas relativas de macOS, manteniendo las versiones.

## Dependencias y compilación de simulador

Se usó Node 24.21.0, pnpm 9.15.0, Xcode 26.0.1 y el runtime iOS 26.0 instalado.
Para reinstalar dependencias sin instalar pnpm globalmente:

```sh
npm exec --cache /private/tmp/vicino-npm-cache --yes --package pnpm@9.15.0 -- pnpm install --frozen-lockfile --store-dir .pnpm-store
```

Resolver las versiones Swift fijadas por el proyecto:

```sh
xcodebuild -resolvePackageDependencies \
  -project apps/web/ios/App/App.xcodeproj -scheme App \
  -clonedSourcePackagesDirPath /private/tmp/vicino-spm \
  -onlyUsePackageVersionsFromResolvedFile
```

Compilar para simulador, sin credenciales de Apple ni firma de distribución:

```sh
xcodebuild -project apps/web/ios/App/App.xcodeproj -scheme App \
  -configuration Debug -sdk iphonesimulator \
  -destination 'generic/platform=iOS Simulator' \
  -derivedDataPath apps/web/ios/DerivedData \
  -clonedSourcePackagesDirPath /private/tmp/vicino-spm \
  -disableAutomaticPackageResolution CODE_SIGNING_ALLOWED=NO build
```

El resultado esperado está en
`apps/web/ios/DerivedData/Build/Products/Debug-iphonesimulator/App.app`.
No es un archivo para App Store ni para instalar en un iPhone físico.

## Pruebas existentes

Desde `apps/web`:

```sh
node node_modules/@playwright/test/cli.js test --config playwright.gestures.config.ts --output /private/tmp/vicino-gesture-results
NODE_PATH="$PWD/../../node_modules/.pnpm/node_modules" node node_modules/@playwright/test/cli.js test --config playwright.frontend.config.ts --output /private/tmp/vicino-frontend-results
```

`NODE_PATH` permite a la prueba antigua resolver su dependencia transitiva
PostCSS con la instalación estricta de pnpm, sin modificar el lockfile.
El laboratorio resuelve PostCSS desde `@tailwindcss/postcss` y limita el escaneo
de Tailwind a `apps/web` para evitar interpretar documentos del repositorio como CSS.

## Lo que sigue pendiente

- Probar la aplicación Next completa requiere un backend de desarrollo y sus
  variables de entorno; la muestra actual no necesita esa autenticación.
- La firma para un iPhone y distribución todavía debe comprobarse con la cuenta
  Apple y los perfiles correspondientes. Esta preparación no los valida.
- El splash claro, Sentry iOS, Universal Links, OAuth Apple/correo y los controles
  nativos nuevos siguen pendientes. No se han dado por resueltos al compilar.
- `HANDOFF-MAC.md` es histórico: no recrear iOS, no hacer pull de master, no
  cambiar las versiones y no seguir sus pasos de publicación en esta fase.

No se hizo commit, push, despliegue ni publicación en App Store.
