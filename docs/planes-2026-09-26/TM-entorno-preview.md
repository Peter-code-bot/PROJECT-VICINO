# Plan TM-entorno-preview

**Pendiente:** Acordar un entorno de preview para probar la app nativa y el front contra staging o ramas sin fusionar

**Fuentes en Notion:** C l.474 (TM-entorno-preview-nativo); H l.35 (H35, nota sobre la auditoría visual de Javier)

**Estado conciliado (26-sep ~23:30):** decision. capacitor.config.ts tiene fija la URL https://vicinomarket.com y el override local está comentado. Prod ya despliega master; el hueco afecta a ramas sin fusionar (diseño de Javier) y a que Javier vea los datos de staging (hoy solo en :3100 local).

**Qué falta:** Elegir: server.url por variable solo en builds Debug, apuntando a una preview de Vercel o a dev-contra-staging por LAN, o probar ramas en el Simulator contra la preview. Claude lo implementa cuando se decida; configurar la preview en Vercel es de Pedro.

## Objetivo

Que Javier pueda abrir la app nativa (iOS Simulator o un iPhone con build Debug) y el front web contra una rama sin fusionar, siempre con datos de STAGING. Producción y los binarios de tienda no se tocan, y queda imposible subir a TestFlight o a Play un binario que apunte a la preview. Propuesta por defecto (opción A): una preview de Vercel conectada a staging, con server.url tomado de una variable al hacer `cap sync`. Hay que hacerlo así porque Capacitor fija la URL en el JSON que genera durante el sync; una configuración Debug de Xcode no la cambia. Además, guardas que bloqueen las builds Release. Opción B, de respaldo: dev-contra-staging por LAN. No se recomienda porque obliga a usar http en claro, MapKit solo acepta localhost:3000 (route.ts:162) y depende de que el PC de Pedro esté encendido y en la misma red.

## Pasos

1. 0. Verificación previa, solo lectura (Pedro, o Claude con su permiso): `vercel env ls preview` en el proyecto vicinomarket. RUNBOOK-claves-filtradas.md dice que NEXT_PUBLIC_SUPABASE_ANON_KEY tiene alcance Production, Preview y Development. Si también están la URL y la SUPABASE_SERVICE_ROLE_KEY de producción, HOY cada preview de rama lee y escribe en la base de prod. No se comparte ninguna URL de preview con Javier hasta terminar el paso 2.
2. 1. Decisión de Pedro y Javier (15-20 min), sobre cuatro puntos. (a) Opción A o B. (b) Deployment Protection de Vercel en Preview: token de bypass en la URL de la build Debug, o quitar la protección solo en Preview (staging solo tiene datos sintéticos). (c) URL: fija (rama `preview` con dominio preview.vicinomarket.com asignado a esa rama) o el alias de cada rama, `vicinomarket-git-<rama>-peters-projects-b65496a9.vercel.app`. (d) Qué ramas de Javier entran. Hoy feat/ios-design-handoff-20260926 y feat/bb03-piloto-regreso ya están fusionadas en master (0 commits por delante).
3. 2. Pedro en Vercel (30-45 min). Variables SOLO con alcance Preview y apuntando a staging: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY y SUPABASE_SERVICE_ROLE_KEY (se toman de .staging/staging.json y se pasan por canal seguro), NEXT_PUBLIC_SITE_URL con la URL elegida y VICINO_ENTORNO=staging. En Preview quedan vacías RESEND_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN(_MOBILE) y UPSTASH_*, igual que en scripts/staging/dev-contra-staging.mjs. Production no se toca. Aplicar lo decidido en 1b/1c y volver a desplegar la preview: las NEXT_PUBLIC_ se fijan al compilar.
4. 3. Claude, en staging, con assertNoProd de scripts/staging/lib.mjs. Añadir la URL de preview y vicino://auth/callback a las redirecciones de Auth del staging por la Management API. Crear 2-3 cuentas sintéticas persistentes @staging.vicino.test para Javier (comprador, vendedor, estudiante) con email_confirm, en un script nuevo scripts/staging/cuentas-revision.mjs. La contraseña se entrega por canal seguro y nunca va a Notion ni a Git.
5. 4. Claude, código del resolver. Archivo nuevo apps/web/capacitor.server-url.ts, sin imports ni alias `@/` porque el CLI de Capacitor transpila la configuración con su propio cargador. Exporta resolverServidor(env): sin VICINO_CAP_SERVER_URL devuelve https://vicinomarket.com. Solo acepta https cuyo host sea un alias del proyecto `vicinomarket-*-peters-projects-b65496a9.vercel.app` o el dominio de preview acordado. Cualquier otra cosa lanza un error.
6. 5. Claude: en apps/web/capacitor.config.ts, server.url y cleartext pasan a salir del resolver y se borra el override comentado `http://localhost:3000`. allowNavigation, plugins y el resto quedan igual.
7. 6. Claude: script nuevo scripts/native/sincronizar-preview.mjs con `--plataforma ios|android` y `--url <preview>` o `--prod`. Ejecuta `pnpm exec cap sync` con la variable solo en el proceso hijo. Después lee el JSON generado (ios/App/App/capacitor.config.json o android/app/src/main/assets/capacitor.config.json, los dos ignorados por Git) e imprime server.url.
8. 7. Claude, guarda de Release en iOS: una fase Run Script en apps/web/ios/App/App.xcodeproj/project.pbxproj (hoy no tiene ninguna). Con CONFIGURATION=Release falla si App/App/capacitor.config.json no contiene `"url": "https://vicinomarket.com"`. Eso también atrapa el JSON del laboratorio scripts/ios-local, que hoy borra la url.
9. 8. Claude, guarda de Release en Android: en apps/web/android/app/build.gradle, una tarea colgada de preReleaseBuild que lee src/main/assets/capacitor.config.json con JsonSlurper y falla si server.url no es https://vicinomarket.com.
10. 9. Claude: script nuevo scripts/staging/check-preview-aislado.mjs, solo lectura. Descarga el HTML y los chunks de /_next/static de la preview y falla si aparece el ref de prod oxxdkwywprkfghhbnoto o si falta el ref de staging.
11. 10. Claude, documentación: sección 'Preview contra staging' en scripts/ios-local/README.md y en apps/web/BUILD-ANDROID.md (cómo sincronizar, cómo volver con `--prod` y qué no funciona en la preview), y registro en docs/PENDIENTES-2026-09-26.md.
12. 11. Javier en la Mac: `node scripts/native/sincronizar-preview.mjs --plataforma ios --url <preview>`, Debug en el Simulator con la cuenta sintética y revisión del front. Al terminar, `--prod`.
13. 12. Cierre: evidencia (SHA, URL de la preview, resultados) en Notion D01 'Entorno y conciliación' y en la página del 26-sep. El pendiente queda cerrado solo con las pruebas 1-7 en verde.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/apps/web/capacitor.config.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/capacitor.server-url.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/test-cap-server-url.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/native/sincronizar-preview.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/ios/App/App.xcodeproj/project.pbxproj (Run Script de Release)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/android/app/build.gradle (tarea en preReleaseBuild)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/check-preview-aislado.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/cuentas-revision.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/ios-local/README.md
- C:/Users/pedro/Projects/startup-marketplace/apps/web/BUILD-ANDROID.md
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md
- Ya compatibles, sin cambios: apps/web/next.config.ts:289 (la CSP permite *.supabase.co) y apps/web/app/api/mapkit/token/route.ts:148-157 (acepta https *.vercel.app con VERCEL_ENV=preview)

## Pruebas

- Unitaria con jiti: `apps/web/node_modules/.bin/jiti scripts/test-cap-server-url.ts` (archivo nuevo). Sin variable devuelve prod. Se aceptan el alias de rama válido y el dominio de preview acordado. Se rechazan http://…, https://vicinomarket.com.evil.com, https://otro-proyecto.vercel.app, https://user:pass@alias…, una URL vacía o con espacios, y lo que no sea URL.
- Integración en Windows: con VICINO_CAP_SERVER_URL=<preview>, `pnpm exec cap copy android` escribe la preview en android/app/src/main/assets/capacitor.config.json. Sin la variable, `cap copy android` vuelve a https://vicinomarket.com. `git status` no muestra ningún JSON generado.
- Guarda Android: con el JSON de la preview, `gradlew.bat bundleRelease` falla en preReleaseBuild. Con el JSON de prod, `assembleDebug` y `bundleRelease` pasan (el AAB no se sube).
- Guarda iOS en la Mac: `xcodebuild -configuration Release` con el JSON de la preview falla en el Run Script. La build Debug de simulador del README de ios-local pasa y la app abre la preview.
- Aislamiento: `node scripts/staging/check-preview-aislado.mjs <preview>` da 0 apariciones del ref de prod.
- E2E contra staging a través de la preview: `E2E_BASE=<preview> node scripts/staging/e2e-campus-home.mjs` 11/11. El login con @staging.vicino.test solo funciona si la preview usa staging, así que esto demuestra el aislamiento. También `E2E_BASE=<preview> node scripts/staging/e2e-header-fijo.mjs`. Si hay protección, se manda la cabecera x-vercel-protection-bypass.
- Prod sin cambios, solo lectura: `node scripts/smoke-produccion.mjs` y `E2E_BASE=https://vicinomarket.com node scripts/staging/e2e-header-fijo.mjs` 3/3. En la web, tsc, lint (0 errores) y `pnpm build` en verde.

## Riesgos

- Probable ya hoy: las previews de Vercel heredan las claves de la base de PRODUCCIÓN (el RUNBOOK lista la anon con alcance Preview), así que una rama de diseño leería y escribiría datos reales. Lo cierran los pasos 0 y 2.
- Mandar a TestFlight o a Play un binario con server.url de la preview, o con el JSON sin url del laboratorio ios-local. Hoy nada lo impide; lo mitigan las guardas de Release de los pasos 7 y 8.
- Con Deployment Protection activa, el WebView enseña el login de Vercel. Si se usa el token de bypass, queda dentro del binario Debug: no se versiona y se puede rotar.
- OAuth de Google/Apple y los enlaces universales están ligados a vicinomarket.com (AASA, capacitor-init.tsx:158/183, oauth-url-listener.tsx:43). En la preview solo se entra con correo y contraseña/OTP usando cuentas sintéticas.
- El staging no tiene SMTP propio (2 correos/hora): registrarse desde la preview se topará con el límite. Hay que usar las cuentas del paso 3.
- El push no funciona en la preview porque send-push no está desplegado en staging. Queda fuera de alcance.
- Una rama de Javier que traiga migraciones nuevas exige aplicarlas antes en staging con scripts/staging/*. No aplica a producción.
- El cargador TS del CLI de Capacitor podría no resolver el helper: sin imports ni alias, y se comprueba con `cap copy`.
- Los alias de Vercel de más de 63 caracteres se truncan: usar la URL que muestra Vercel o el dominio fijo.

## Requiere antes

- Decisión de Pedro y Javier sobre los puntos 1a-1d: opción, Deployment Protection, URL fija o por rama, ramas que entran
- Resultado del paso 0 (alcance real de las variables Preview en Vercel) antes de compartir cualquier URL de preview
- Acceso de Pedro al panel de Vercel para las variables Preview y el dominio opcional preview.vicinomarket.com (DNS)
- OK de Pedro para tocar el proyecto nativo (project.pbxproj, build.gradle) y para escribir en la configuración de Auth del staging
- Mac con Xcode 26 y Simulator (Javier) para validar la guarda de iOS; Android SDK en el equipo de Pedro para la guarda de Gradle

**Responsable:** Decisión: Pedro y Javier. Vercel (variables Preview, protección, dominio): Pedro. Resolver, guardas, scripts, cuentas de staging y pruebas: Claude. Validación en la Mac/Simulator: Javier.

**Estimación:** Unas 6-7 h de trabajo, repartidas en 1-2 días naturales porque dependen de Vercel y de la Mac. Decisión: 15-20 min. Pedro en Vercel: 30-45 min. Claude con código y pruebas (pasos 4-10): 4-5 h. Auth del staging y cuentas: unos 45 min. Validación en la Mac: 45-60 min.

**Ejecutable por Claude ahora:** no
