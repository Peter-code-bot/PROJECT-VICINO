# Tasks — Android APK release pipeline

> Checklist ejecutable para `/opsx:apply`. Cada item enlaza el archivo concreto que se tocará en la implementación.
> Las tareas en `[NEEDS D-CI]` cambian de archivo dependiendo de qué tool de CI se elija (ver `design.md` §1).
> No se empieza la ejecución hasta que `[NEEDS CLARIFICATION: D-CI]` esté firmado por Pedro.

## Pre-implementación (Pedro manual)

- [ ] **T-00 · Resolver `[NEEDS CLARIFICATION: D-CI]`** — Pedro elige A (GitHub Actions), B (Codemagic) o C (Capawesome Cloud) y lo escribe en `design.md`.
- [ ] **T-01 · Generar keystore de release** — Pedro corre `keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 -validity 25000 -alias vicino-release` localmente, guarda el `.jks` en un password manager seguro y anota los 3 passwords. Archivo: NO ENTRA AL REPO.
- [ ] **T-02 · Crear Play Console Service Account** — Pedro va a Google Cloud Console, crea un service account, le da rol `Internal Release Manager` en Play Console, descarga el JSON. Archivo: NO ENTRA AL REPO.

## Configuración del CI elegido (`[NEEDS D-CI]`)

- [ ] **T-03 · Configurar secrets en el dashboard del CI** — subir `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`, `PLAY_SERVICE_ACCOUNT_JSON`. Archivo: NO ENTRA AL REPO (dashboard del CI elegido).
- [ ] **T-04 · `[NEEDS D-CI]` Crear archivo de workflow del CI** — depende de la opción:
  - Si A (GitHub Actions): `.github/workflows/android-release.yml`
  - Si B (Codemagic): `apps/web/codemagic.yaml`
  - Si C (Capawesome Cloud): configuración en su dashboard, no archivo en repo
- [ ] **T-05 · Trigger por tag** — el workflow filtra por regex `v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(beta|rc)\.[0-9]+)?` y rechaza tags fuera de `master`. Archivo: el mismo de T-04.

## Scripts del monorepo (siempre van al repo)

- [ ] **T-06 · Script de sync de versión desde tag** — lee `$GIT_TAG`, parsea, actualiza `versionCode` + `versionName` en `apps/web/android/app/build.gradle` antes del build. Archivos: `apps/web/scripts/sync-android-version.mjs` (nuevo).
- [ ] **T-07 · Script de build Android** — orquesta `pnpm build → cap sync android → gradlew bundleRelease`. Archivo: `apps/web/scripts/build-android.sh` (nuevo). PowerShell equivalente solo si Pedro corre el pipeline local; el CI usa el `.sh`.
- [ ] **T-08 · Validación bundletool** — añade `bundletool validate --bundle=...` antes del upload. Archivo: incorporado a T-07.
- [ ] **T-09 · Upload a Play Console Internal Track** — usa `fastlane supply --track internal` o action equivalente per T-04. Si fastlane: archivos `apps/web/android/fastlane/Fastfile`, `apps/web/android/fastlane/Appfile`, `apps/web/android/Gemfile`.
- [ ] **T-10 · GitHub Release con `.aab` + changelog** — incorporado al workflow de T-04. Auto-genera changelog vía `git log <prev-tag>..<tag> --pretty="* %h %s"`.

## Documentación

- [ ] **T-11 · Documentar el procedimiento release en CLAUDE.md** — añadir una sección corta a `CLAUDE.md` raíz (~10 líneas) con el comando completo: `git tag v0.1.0-beta.1 -m "release: beta 1" && git push origin v0.1.0-beta.1`. Archivo: `CLAUDE.md` (sección nueva al final).
- [ ] **T-12 · Actualizar áreas críticas en CLAUDE.md** — añadir `apps/web/android/` y workflow del CI a la lista de áreas críticas. Archivo: `CLAUDE.md`.

## Validación end-to-end (V1-V6)

- [ ] **V-1 · `pnpm build` local verde** antes del primer tag (Lección institucional #1).
- [ ] **V-2 · Cross-viewport check** — la PWA cargada por el WebView del APK debe renderizar en `375x812` y `1280x800` sin regresión visual.
- [ ] **V-3 · Primer tag dry-run en rama** — desde `feat/openspec-2026-06-android-apk-release` (rama de implementación, futura): `git tag v0.1.0-rc.1`. Confirmar que el workflow del CI dispara y produce un `.aab` con `versionName="0.1.0-rc.1"`, sin uploadear (gate manual).
- [ ] **V-4 · Upload a Internal Track** — con un tag real `v0.1.0-beta.1` en `master`, el `.aab` aparece en Play Console Internal Track con `versionCode` esperado y `bundletool validate` exit 0.
- [ ] **V-5 · Beta testers reciben update <30min** — Pedro enrola 1 device de prueba al Internal Track de Play Console; tras V-4 confirma que ese device recibe la notificación de update en menos de 30 minutos.
- [ ] **V-6 · Crash-free rate >99% en 24h** — Pedro revisa Play Console Vitals 24h después de V-5; reporta el rate y cualquier ANR.

## Cierre

- [ ] **T-13 · Lección institucional nueva** — si V-1 a V-6 revelan un patrón nuevo (ej. "el tag debe ser sobre commit con `pnpm build` verde local", "Play Service Account expira cada 90 días"), añadirla a `CLAUDE.md` sección "Lecciones institucionales".
- [ ] **T-14 · `/opsx:archive 2026-06-01-android-apk-release-pipeline`** — tras V-6 verde, archivar el change: deltas de `specs/android-build/spec.md` se mergean a `openspec/specs/android-build/spec.md` (creando ese archivo si no existe) y la carpeta del change se mueve a `openspec/changes/archive/2026-06-01-android-apk-release-pipeline/`.
