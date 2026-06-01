# Proposal — Android APK release pipeline

## Why

VICINO requiere distribución a través de Google Play Store. La app web ya está estable en producción (`https://vicinomarket.com`). El proyecto Capacitor en `apps/web/android/` está configurado con `applicationId = com.vicino.mx`, `versionCode = 1`, `versionName = "1.0"`, signing config release referenciando `keystore.properties`, AndroidManifest con autoVerify para los hosts de producción, y plugins al día post E-bis-1.

Lo que falta es **automatizar la compilación firmada del Android App Bundle (`.aab`) y su subida a Play Console Internal Track** desde el monorepo, de forma reproducible y sin depender de que un humano corra Android Studio cada vez.

Sin este pipeline, Play Console closed testing (requisito de 12 testers × 14 días) no puede empezar, y la app móvil de VICINO queda bloqueada en el roadmap.

## What

Un pipeline de release que, al detectar un tag git de versión, produce un `.aab` firmado y lo sube a Google Play Console Internal Track.

## Scope

### IN (este change)
- Trigger del pipeline desde un tag git con formato `v<major>.<minor>.<patch>` (con sufijos pre-release `-beta.N` o `-rc.N` opcionales) creado sobre `master`.
- Compilación reproducible que produce un `.aab` firmado con la keystore de release.
- Upload del `.aab` al **Internal Track** del Play Console.
- Sincronización de `versionCode` y `versionName` con el tag (monotonicidad estricta de `versionCode`).
- Publicación de una GitHub Release con el `.aab` adjunto y changelog auto-extraído.
- Logs y artifacts observables (qué se construyó, qué se subió, hash del `.aab`).

### OUT (no es este change)
- Compilación iOS (requiere macOS, fuera del alcance del monorepo actual).
- Promoción del `.aab` desde Internal Track a Closed/Open/Production tracks.
- Creación de cuenta Play Console developer ni alta del Play Service Account.
- Producir los assets de Play Store listing (feature graphic, screenshots, copy es-MX).
- Reclutar los 12 beta testers.
- Cambios al runtime de la app (web o nativa).
- Migración de Capacitor a major version mayor.

## Stakeholders

| Rol | Persona | Responsabilidad en este change |
|---|---|---|
| Founder / único deployer | Pedro | Aprueba la spec, aporta los secrets (keystore, service account JSON), corre el primer `git tag`, confirma resultados en Play Console |
| Branding | Alejandro | No participa en este change (assets de listing van en change futuro) |

## Success criteria (objetivos, medibles)

1. **Pipeline produce `.aab` válido** — un `git tag v0.1.0-beta.1 && git push --tags` resulta en un `.aab` listo para Play Console, con `versionName = "0.1.0-beta.1"` y `versionCode` monotónico, sin intervención manual posterior.
2. **`.aab` aceptado por Play Console Internal Track** — el upload pasa la validación automática (`bundletool` + Play Console signature checks).
3. **Beta testers reciben el update** — los testers enrolados al Internal Track reciben la notificación de update en su dispositivo en menos de **30 minutos** desde que el pipeline termina.
4. **Crash-free rate >99% en el day-1 post-release** — medido por Play Console Vitals durante las primeras 24 horas tras el primer build distribuido a testers reales.
5. **Reproducibilidad** — un re-run del pipeline desde el mismo tag (con el mismo state del repo) produce un `.aab` byte-idéntico o, si no, con diff explicable (ej. timestamps de build solamente).

## Out-of-scope failure modes that the pipeline NEVER causes

- El push a `master` (que dispara el auto-deploy de la web en Vercel) no debe ser afectado por la existencia de este pipeline. Web release y APK release viven en eventos git distintos: push a master → Vercel; tag `v*` → APK pipeline.

## References

- `apps/web/capacitor.config.ts` — config Capacitor actual (URL live `vicinomarket.com`, plugins, splash `#0A0F0E`).
- `apps/web/android/app/build.gradle` — applicationId `com.vicino.mx`, versionCode 1, signingConfigs release.
- `apps/web/android/app/src/main/AndroidManifest.xml` — 9 permisos vivos, 4 intent-filters (autoVerify para hosts canonical), post E-bis-1.
- `.claude/skills/capgo-skills/skills/capgo-release-management/SKILL.md` y skills relacionados — referencia de patrones Capacitor + Play Store que ya están en el repo (third-party).
