# App Links con www: diagnóstico y orden de operaciones (7-nov-2026)

Rama `fix/app-links-www-20261107`, cortada de `192876f` (lo que corre en producción). Next 16.4.1
(`apps/web/package.json`). Pendiente 01 del PDF de pendientes técnicos del 7-nov: que un enlace
`https://www.vicinomarket.com/...` abra la pantalla correspondiente en Android con VICINO
instalado.

## Diagnóstico

- **El 308 de www lo pone Vercel a nivel de dominio**, no el código: el dominio
  `www.vicinomarket.com` está configurado como "Redirect to vicinomarket.com (308)". Esa
  respuesta no pasa por la app: no trae `X-Frame-Options` ni `X-Matched-Path`, y su HSTS no es el
  de `next.config.ts`. Alcanza también a los archivos de asociación. GET del 7-nov, 22:20 hora del
  centro de México:

  ```
  www  /.well-known/assetlinks.json              308  Location: https://vicinomarket.com/.well-known/assetlinks.json  Content-Type: text/plain
  apex /.well-known/assetlinks.json              200  application/json; charset=utf-8  X-Frame-Options: DENY
  www  /.well-known/apple-app-site-association   308  Location: https://vicinomarket.com/.well-known/apple-app-site-association
  apex /.well-known/apple-app-site-association   200  application/json  X-Frame-Options: DENY
  ```

  Según el diagnóstico de ese mismo día (no repetido al escribir esto), la API de Digital Asset
  Links rechazaba www con `ERROR_CODE_REDIRECT`, y el apex y `startup-marketplace-web.vercel.app`
  pasaban con las dos huellas de `assetlinks.json`.
- **El AAB 9 (1.8) tiene www fuera de `autoVerify`**, igual que `192876f`: el filtro verificado
  solo lleva `vicinomarket.com`; www y vercel.app van en un filtro manual. Con targetSdk 36, Android
  12 o posterior nunca verifica un host de un filtro sin `autoVerify`. **Arreglar el alojamiento no
  basta: hace falta el AAB 10 con www en el filtro verificado.**
- **Android 7 a 11 es todo o nada** sobre todos los hosts web del manifiesto, filtro manual
  incluido. Mientras www redirija, en esos teléfonos probablemente tampoco el apex abre la app sin
  preguntar (inferido de la documentación de Android y de AOSP; falta confirmarlo en un equipo con
  Android 11 o anterior). Por lo mismo, una vez que www sirva el archivo (paso 3), en esos
  teléfonos basta una instalación o actualización, incluso del AAB 9, para que pasen los tres
  hosts (también inferido).
- iOS no necesita binario nuevo: `App.entitlements` ya declara `applinks:www.vicinomarket.com`.

## Qué cambia en esta rama

| Archivo | Cambio | Cuándo surte efecto |
|---|---|---|
| `apps/web/next.config.ts` | `redirects()`: www → apex con 308, conservando ruta y query, **salvo `/.well-known/assetlinks.json` y `/.well-known/apple-app-site-association`** | Inerte hasta el paso 2 |
| `apps/web/proxy.ts` | Esos dos archivos fuera del matcher; el resto de `/.well-known/` sigue pasando | Con el deploy |
| `apps/web/android/app/src/main/AndroidManifest.xml` | www al filtro `autoVerify`; vercel.app sigue en el manual. No toca `versionCode` | Con el AAB que lo lleve |
| `apps/web/components/capacitor-init.tsx` + `lib/navigation/destino-enlace.ts` | El destino del enlace es ruta + query + hash completos; `//otro-host` no navega | Con el deploy, en Android **e iOS**, AAB 9 incluido |

La excepción es solo para esos dos archivos, exactos, y no para todo `/.well-known/`: lo demás no
es estático, lo atiende `[categoria]/[slug]` (GET del 7-nov, 23:30 hora del centro:
`https://vicinomarket.com/.well-known/no-existe-revision` → `200` con
`X-Matched-Path: /[categoria]/[slug]`). Por eso lo demás, en www, se redirige como cualquier ruta,
y en todos los hosts sigue pasando por el proxy, que refresca la sesión y sanea las cabeceras en
las que confía `(marketplace)/layout.tsx`.

Pruebas, desde la raíz (ninguna está todavía en CI):

```bash
pnpm exec tsx scripts/test-redirect-www.mjs                          # regla de next.config.ts
node scripts/test-matcher-proxy.mjs                                  # matcher de proxy.ts
node --import tsx --test apps/web/lib/navigation/destino-enlace.test.ts
```

Las dos primeras usan API de Next inestable o interna; sus cabeceras dicen qué modelan y qué no.
La prueba que vale es la del paso 3.

## Orden de operaciones

Comandos para Git Bash, desde la raíz del repo. En PowerShell, `curl.exe` (no `curl`, que es
`Invoke-WebRequest`).

**0. Revisión del PR — Javier.**

**1. Merge y deploy — Javier hace el merge; Pedro confirma.** En Vercel, el despliegue de
Production tiene que ser el commit del merge. Justo después:

```bash
curl -sS -o /dev/null -w '%{http_code} %{redirect_url}\n' https://vicinomarket.com/terminos
```

Debe dar `200 ` (sin URL detrás). Si da `308`, la regla perdió su condición de host y el apex se
redirige a sí mismo: **Instant Rollback** en el acto.

Este mismo deploy saca los dos archivos de asociación del proxy, así que se miden también, antes de
tocar Vercel, en los dos hosts que ya los sirven:

```bash
for h in vicinomarket.com startup-marketplace-web.vercel.app; do
  for p in /.well-known/assetlinks.json /.well-known/apple-app-site-association; do
    curl -sS -o /dev/null -w "$h$p %{http_code} %{content_type} %{redirect_url}\n" "https://$h$p"
  done
done
```

Los cuatro: `200`, `application/json` y sin URL de redirección. Si alguno falla, **Instant
Rollback** antes del paso 2.

**2. Pedro cambia www en Vercel.** Solo con el paso 1 bien. Settings → Domains →
`www.vicinomarket.com` → Edit: de "Redirect to vicinomarket.com (308)" a "Connect to an
environment: Production".

**3. Verificar — Pedro, en cuanto guarde el paso 2.**

```bash
curl -sS -D - -o /dev/null 'https://www.vicinomarket.com/terminos?a=1'
```

Debe dar `308`, `Location: https://vicinomarket.com/terminos?a=1` y `X-Frame-Options: DENY`. Esa
cabecera es la señal de que contestó el despliegue y no el dominio. **Si da 200, volver a poner la
redirección del paso 2 de inmediato**: www estaría sirviendo la app completa.

```bash
for h in www.vicinomarket.com vicinomarket.com startup-marketplace-web.vercel.app; do
  for p in /.well-known/assetlinks.json /.well-known/apple-app-site-association; do
    curl -sS -o /dev/null -w "$h$p %{http_code} %{content_type} %{redirect_url}\n" "https://$h$p"
  done
done
```

Los seis: `200`, `application/json` y sin URL de redirección.

```bash
API=https://digitalassetlinks.googleapis.com/v1
REL=delegate_permission/common.handle_all_urls
curl -sS "$API/statements:list?source.web.site=https://www.vicinomarket.com&relation=$REL"
for huella in $(node -p "require('./apps/web/public/.well-known/assetlinks.json')[0].target.sha256_cert_fingerprints.join(' ')"); do
  curl -sS "$API/assetlinks:check?source.web.site=https://www.vicinomarket.com&relation=$REL&target.android_app.package_name=com.vicino.mx&target.android_app.certificate.sha256_fingerprint=$huella"
done
curl -sS -D - -o /dev/null https://app-site-association.cdn-apple.com/a/v1/www.vicinomarket.com
```

`statements:list` sin `errorCode` y `"linked": true` con las dos huellas. Si sigue
`ERROR_CODE_REDIRECT`, es la caché: esperar unos 10 min y repetir. En el CDN de Apple, `Apple-From`
debe acabar listando solo la URL de www; puede tardar hasta 6 h. Con esto también se cierra el
pendiente de `docs/PENDIENTES-2026-09-26.md` ("Verificar `assetlinks.json` y AASA servidos").

**4. AAB 10 — Pedro.** Ya está construido. `release/android-aab10-20261107` (versionCode 10 / 1.9)
lleva el mismo cambio de `AndroidManifest.xml` que esta rama, idéntico byte por byte, y el AAB se
compiló con él el 7-nov-2026; todavía no se sube a Play. Como el cambio es igual en las dos ramas,
las dos se fusionan en master sin conflicto y en cualquier orden. Si hay que volver a construirlo,
antes de subirlo comprobar que www quedó en el filtro verificado:

```bash
java -jar bundletool.jar dump manifest --bundle=app-release.aab
```

`www.vicinomarket.com` tiene que estar dentro de `<intent-filter android:autoVerify="true">`. Sirve
también `aapt2 dump xmltree` sobre `base/manifest/AndroidManifest.xml`, como en el diagnóstico.
**Distribuir (o hacer la prueba del paso 5 con una instalación nueva) solo después del paso 3.**

**5. Prueba en un Android físico — Pedro / Javier.** Instalado desde Play (prueba interna o
cerrada: firma de Play), no un APK local.

```bash
adb shell pm get-app-links com.vicino.mx            # Android 12+: los dos hosts "verified"
adb shell pm get-app-link com.vicino.mx             # Android 11 o anterior: "always"
adb shell am force-stop com.vicino.mx               # para la prueba en frío
adb shell 'am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://www.vicinomarket.com/terminos"'
adb shell 'am start -W -a android.intent.action.VIEW -c android.intent.category.BROWSABLE -d "https://vicinomarket.com/terminos"'
```

Repetir los `am start` con la app abierta. Con la app en `/perfil`, el enlace
`https://vicinomarket.com/?feed=solicitudes` debe dejarla en `/?feed=solicitudes`. Además, tocar el
enlace desde otra app (Notas, WhatsApp), no desde la barra de Chrome. Si el equipo instaló el
AAB 10 antes del paso 3: `adb shell pm verify-app-links --re-verify com.vicino.mx` (Android 12+).

Para cerrar el pendiente: versionCode, salida de `pm get-app-links` (o `pm get-app-link`), URL
exacta, si fue en frío o con la app abierta, modelo y versión de Android, y captura. Sin VICINO, www
abre el navegador y acaba en el apex: una ruta pública muestra la página y una privada pide sesión.

## Cómo deshacer (en orden inverso)

1. **Vercel primero**: volver www a "Redirect to vicinomarket.com (308)". Un clic.
2. **Después el código**: revertir el commit de la regla o hacer Instant Rollback. Al revés, www
   serviría la app completa con 200 mientras tanto.
3. `proxy.ts` y `capacitor-init.tsx` se revierten solos; no dependen de los demás pasos.
4. Un AAB publicado no se retira; si hiciera falta, va otro. Los teléfonos con el AAB 10 siguen
   bien mientras los tres hosts sirvan `assetlinks.json` con 200.

## Riesgos

- **Android 7 a 11, todo o nada**: también cuenta vercel.app. Si algún día pasa a 308 sin excluir
  los archivos de asociación, dejan de verificarse los tres hosts en esos teléfonos.
- **Archivo de asociación nuevo** (por ejemplo, el de Apple Pay): si hay que servirlo en www, se
  agrega a la excepción de `next.config.ts`, al matcher de `proxy.ts` y a las dos pruebas. Si no,
  en www recibe el 308 al apex como cualquier otra ruta.
- **`/_next/` en www no se redirige**: Next antepone `(?!/_next)` a toda redirección propia, así
  que con el paso 2 `www/_next/static/*` y `www/_next/image` se atienden en www, sin redirección.
  Inocuo: nadie los enlaza con www y las páginas sí se redirigen.
- **Antes de Android 15 no hay reverificación periódica**: `assetlinks.json` se lee al instalar o
  actualizar. Si el AAB 10 llega antes del paso 3, en Android 12 a 14 www queda sin verificar hasta
  la siguiente actualización. Android 15+ reverifica en segundo plano (según la documentación de
  Android; no comprobado aquí).
- **Cachés** (según documentación, no comprobado aquí): unos 10 min la API de Google y hasta 6 h el
  CDN de Apple.
- **www en Production sin la regla desplegada** (deploy fallido, rollback o PR sin mergear): www
  serviría la app entera en un origen aparte, con contenido duplicado y su propia sesión,
  almacenamiento y service worker. OAuth y los enlaces de correo fallarían ahí: la lista de
  redirecciones de Supabase Auth no incluye www (`docs/MP01-MP03C-2026-10-03.md`, MP02).
- **La regla sin su condición de host** (`has: []` también compila) redirige el apex a sí mismo:
  bucle 308 y sitio caído. Lo detectan la prueba y el curl del paso 1.
- **Barra final**: `www/foo/` da dos saltos (Next quita la barra y luego aplica la regla). Inocuo.
- **El arreglo de `capacitor-init.tsx` llega a todos con el deploy**, no solo al AAB 10. Además,
  un enlace `https://vicinomarket.com//otro.example/...` ya no saca el WebView a otro host.
- Las guardas del callback de auth solo reconocen `https://vicinomarket.com/auth/callback`. Hoy no
  se genera ningún callback con www (los correos usan `NEXT_PUBLIC_SITE_URL`); no se tocan.
- Con www verificado, toda ruta de www abre la app, como ya pasa con el apex.

## Decisiones abiertas

- ¿`startup-marketplace-web.vercel.app` se queda en el manifiesto? En Android 11 o anterior ata la
  verificación de los tres hosts a que ese dominio sirva `assetlinks.json` con 200. Se puede quitar
  en el AAB 10, o dejar escrito que cualquier 308 de ese host excluya los dos archivos de asociación,
  como la regla de www (Pedro/Javier).
- ¿El AAB 10 va a prueba cerrada antes o después del paso 3? (Pedro/Javier, con la sesión del AAB 10).
- Con la app abierta, ¿un enlace a la raíz sin query (`https://vicinomarket.com/`) debe llevar al
  inicio? Hoy no navega y así se dejó (Javier).
- ¿Se agregan las tres pruebas a `.github/workflows/security.yml`? (Javier).
