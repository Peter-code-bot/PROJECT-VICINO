# Design — Android APK release pipeline

> Este documento describe **cómo** se construye el pipeline. El **qué** y el **por qué** viven en `proposal.md`.
> Decisiones con `[NEEDS CLARIFICATION]` requieren input de Pedro antes de avanzar a `/opsx:apply`.

## 1. Decisión pendiente: tool de CI (D-CI)

### `[NEEDS CLARIFICATION: tool de CI para la build firmada de Android]`

Tres opciones serias para VICINO. **No autodecidir**: cada una cambia los archivos a crear, los secrets que Pedro tiene que rotar y el costo operacional.

| Opción | Costo mensual estimado | Manejo del keystore | Compatible con Vercel Hobby | Fricción setup |
|---|---|---|---|---|
| **A · GitHub Actions** (runner ubuntu-latest hosted) | $0 (2000 min/mes incluidos en repos públicos; 3000 min/mes plan Free para privados) | `KEYSTORE_BASE64` + `KEYSTORE_PASSWORD` + `KEY_ALIAS` + `KEY_PASSWORD` como GitHub Actions Secrets; decode a `keystore.jks` en runtime | Sí — Vercel y GitHub Actions son sistemas independientes | Media. Hay que escribir el YAML del workflow + acción de upload a Play Console (fastlane o `r0adkll/upload-google-play`). Cache de gradle disponible. |
| **B · Codemagic** (CI mobile-specialized) | $0 (500 min build/mes free tier; $0.038/min después) | UI para subir keystore + secrets vía Codemagic dashboard; se inyecta en runtime | Sí — Codemagic es independiente | Baja. Codemagic tiene templates Capacitor + Play Store upload prebuilt; workflow definible vía `codemagic.yaml` en repo o UI. |
| **C · Capawesome Cloud** (CI Capacitor-native) | $19/mes plan Pro (no hay free tier productivo) | UI Capawesome para keystore + secrets | Sí | Muy baja para Capacitor specifically; UI muy alineada al stack. |

### Criterios de evaluación (firmados como obligatorios)

- **C-1 · Costo cero o casi cero pre-beta**: estamos pre-revenue. Una opción que cuesta $0/mes para los primeros 6 builds/mes es preferible.
- **C-2 · Manejo limpio del keystore**: el `.jks` y sus passwords **nunca** se commitean al repo (regla §4 de `openspec/project.md`). El tool debe ofrecer un mecanismo de secret-store auditado.
- **C-3 · Compatible con el deploy Vercel Hobby de la web sin interferir**: el pipeline NO debe correr en cada push a `master` (eso ya lo hace Vercel); debe correr solo en tag `v*`.
- **C-4 · Fricción de setup baja**: Pedro es solo dev. Templates listos o configuración mínima ganan.
- **C-5 · Visibilidad y debugability**: logs públicos del build, capacidad de re-correr con un click si falla, artifacts descargables.

### Recomendación que sigue siendo `[NEEDS CLARIFICATION]`

- Por C-1 y C-3: **A o B**, no C.
- Por C-4: B tiene templates mejor pulidos para Capacitor.
- Por C-5: A y B son comparables.
- Inclinación tentativa: **B (Codemagic)** o **A (GitHub Actions)** con preferencia ligera por B si el plan Free de 500 min/mes alcanza para 4-6 builds/mes (probable, dado que cada build Capacitor toma ~15-25 min).

Pedro confirma la opción antes de avanzar a `tasks.md`/`/opsx:apply`.

## 2. Arquitectura del flujo (independiente de la opción D-CI)

```
[Pedro local]                [git]              [CI elegido]            [Play Console]
     |                         |                    |                        |
     |  pnpm build local       |                    |                        |
     |  (verde, leccion #1)    |                    |                        |
     |                         |                    |                        |
     |  git tag v0.1.0-beta.1  |                    |                        |
     |  git push --tags        |--->  tag push  --->|                        |
     |                         |                    |                        |
     |                         |                    |  install deps          |
     |                         |                    |  pnpm install          |
     |                         |                    |  pnpm build (web)      |
     |                         |                    |  cap sync android      |
     |                         |                    |  sync version code/    |
     |                         |                    |    name desde tag      |
     |                         |                    |  decode keystore       |
     |                         |                    |  gradlew bundleRelease |
     |                         |                    |  bundletool validate   |
     |                         |                    |                        |
     |                         |                    |  upload via fastlane   |
     |                         |                    |  o accion equivalente  |
     |                         |                    |--> .aab subido al -----|
     |                         |                    |    Internal Track      |
     |                         |                    |                        |
     |                         |  github release    |                        |
     |                         |  + .aab artifact   |                        |
     |                         |  + changelog       |                        |
     |                         |  desde commits     |                        |
     |                         |  desde tag anterior|                        |
     |                         |                    |                        |
     |  observa Play Console   |                    |                        |
     |  testers reciben update |<--------------------------------------------+ <30min
```

## 3. Componentes técnicos

### 3.1 Trigger
- Evento git: tag con regex `^v(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(beta|rc)\.[0-9]+)?$`.
- Tag sobre commit en `master` (rechazar tags sobre otras ramas).
- **NO** se dispara por push a `master` (Vercel ya hace eso para la web).

### 3.2 Sync de version desde el tag
- Script preparatorio (a crear en `apps/web/scripts/`, lenguaje a decidir junto con D-CI) lee `$GIT_TAG`, parsea con regex, y escribe a `apps/web/android/app/build.gradle`:
  - `versionName` = tag sin prefijo `v` (ej. `"0.1.0-beta.1"`).
  - `versionCode` = monotonic. Estrategia más simple: `(major * 10000 + minor * 100 + patch) * 100 + preReleaseN`. Ej. `0.1.0-beta.1` → `100 * 100 + 1 = 10001`. `0.1.0` (final) → `100 * 100 + 99 = 10099` para garantizar >beta/rc.
  - Alternativa simpler: `versionCode = GITHUB_RUN_NUMBER` (entero estrictamente creciente). Decidir con Pedro.

### 3.3 Build
- `pnpm install --frozen-lockfile`
- `pnpm build` (turbo, type-check pasa, output en `apps/web/.next/`)
- `cd apps/web && pnpm exec cap sync android` (propaga config + plugins)
- `cd apps/web/android && ./gradlew :app:bundleRelease`

### 3.4 Validación post-build
- `bundletool validate --bundle=app/build/outputs/bundle/release/app-release.aab` debe exit 0.
- Hash SHA-256 del `.aab` se loguea y se persiste como output del job (para reproducibilidad audit).

### 3.5 Upload a Play Console
- Service Account JSON (con role `Internal Release Manager` o más amplio según permisos Play Console).
- Tool de upload: **fastlane supply** (estándar) o GitHub Action `r0adkll/upload-google-play@v1` (si D-CI = A).
- Track: `internal`. **Nunca** `production` ni `open` en este pipeline.

### 3.6 GitHub Release
- Crear release atado al tag.
- Adjuntar `.aab` (sin re-firmar; el mismo bytes que se subió a Play Console).
- Cuerpo del release = changelog auto-generado: `git log <previous-tag>..<this-tag> --pretty="* %h %s"` filtrado a commits no-noise (excluir `chore: bump version` automáticos).

## 4. Secrets handling (Secret Handoff Doctrine)

**`apps/web/android/keystore.properties` y el `.jks` de release NUNCA se commitean**. La regla §4 de `openspec/project.md` (Commits + git) es categórica.

| Secret | Cómo llega al pipeline |
|---|---|
| Keystore release `.jks` (binario) | Pedro lo codifica a base64 local (`base64 -w0 release.jks > keystore.b64`), lo pega como secret `ANDROID_KEYSTORE_BASE64` en el dashboard del CI elegido. El pipeline lo decodifica a `apps/web/android/app/release.jks` en runtime y lo borra del workspace al final. |
| `storePassword` | Secret `ANDROID_KEYSTORE_PASSWORD` |
| `keyAlias` | Secret `ANDROID_KEY_ALIAS` |
| `keyPassword` | Secret `ANDROID_KEY_PASSWORD` |
| Play Service Account JSON | Secret `PLAY_SERVICE_ACCOUNT_JSON` (contenido completo del JSON descargado de Google Cloud Console, no la ruta). El pipeline lo escribe a un tmpfile, se lo pasa a fastlane, lo borra al final. |

**Rotación**: si cualquier secret se filtra (commit accidental, log de CI sin redactar), Pedro rota el secret y revoca:
- `.jks`: requiere generar nuevo keystore + alta de fingerprint nuevo en Play Console + uploads futuros usan el nuevo (Play App Signing en Play Console mitiga esto si está activado).
- Service account JSON: revocar key en Google Cloud Console, generar nueva, actualizar secret CI.

**Verificación pre-merge**: cuando este change se mergee a `master`, Pedro corre `git log -p --all -S 'BEGIN PRIVATE KEY'` y `git log -p --all -S 'keystore'` para confirmar que ningún commit del repo contiene el material sensible.

## 5. Versionamiento del schema gradle

`apps/web/android/app/build.gradle` actualmente tiene `versionCode = 1`, `versionName = "1.0"`. Estos son los seeds. El primer tag `v0.1.0-beta.1` los sobreescribe en runtime; el archivo en `master` queda como base estática (no se commitea con cada build — el sync corre solo en CI).

Alternativa: mantener el archivo bajo control de version y commitear el bump como parte del pipeline (bot commit + push). **Decisión pendiente con D-CI**, pero la opción "sin commit del bump" es más limpia (un solo commit `release: v0.1.0-beta.1` que solo es el tag).

## 6. Failure modes documentados

| Failure | Síntoma esperado | Mitigación |
|---|---|---|
| Tag mal formado (`v0.1`, `1.0.0`) | Regex de trigger no matchea | Job no arranca; Pedro re-tagea con formato válido |
| Keystore corrupto / password incorrecto | `gradlew bundleRelease` falla con `Failed to read key from store` | Pipeline falla con exit code != 0; Pedro re-valida secret en dashboard CI |
| Service Account JSON expirado / sin permisos | `fastlane supply` falla con 401/403 | Pedro renueva JSON en Google Cloud Console |
| `versionCode` no monótono (regresión) | Play Console rechaza con `Version code 10001 has already been used` | Estrategia de versionCode debe garantizar monotonicidad (ver §3.2); alternativa: `GITHUB_RUN_NUMBER` |
| `bundletool validate` falla | Manifest merge produjo conflicto; o build incluyó plugins incompatibles | Build falla pre-upload; logs muestran el manifest merge report; Pedro corrige `AndroidManifest.xml` |
| Vercel auto-deploy fallido por el push de tag (no debería pasar) | Vercel ignora push de tags por default | Confirmar en Vercel dashboard que solo branches están en watched; si no, agregar regla en `vercel.json` |
| Pipeline corre dos veces para el mismo tag | Race condition raro | Idempotencia: Play Console rechaza el segundo upload con mismo versionCode; pipeline reporta "already uploaded" como success |

## 7. Observabilidad

- Logs del CI con artifacts (`.aab` + `bundletool report` + changelog generado) descargables 30 días.
- GitHub Release con `.aab` adjunto permanente.
- Play Console Vitals para crash rate y ANR (manual check 24h post-release).

## 8. References

- `apps/web/capacitor.config.ts`, `apps/web/android/app/build.gradle`, `apps/web/android/app/src/main/AndroidManifest.xml` — estado actual.
- `openspec/project.md` §4 Commits + git — regla de keystore NUNCA commiteada.
- `.claude/skills/capgo-skills/skills/capgo-ci-cd/SKILL.md`, `capacitor-ci-cd/SKILL.md`, `capgo-release-management/SKILL.md`, `capgo-native-builds/SKILL.md` — skills third-party con patrones reutilizables.
