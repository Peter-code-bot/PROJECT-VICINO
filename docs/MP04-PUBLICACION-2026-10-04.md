# MP04 — Publicación S02 en producción (04-oct-2026)

Responsable: Codex, familia GPT-6. Inicio real de sesión:04-oct-2026 14:16:42 America/Mexico_City. Fin real en la Bitácora de Notion; no confundir entrega técnica con aceptación física del mega plan.

## Autorización y resultado

Javier confirma que revocación/acceso Preview están resueltos y pide publicar: «te confirmo todo eso ... ya está todo eso publícalo». Confirmación humana registrada hoy; no se inventa fecha histórica de rotación ni se afirma que Codex usó la clave histórica. Los diagnósticos antes rechazados no se reintentaron ni eludieron. La instrucción nueva permite avanzar a producción; correo/OAuth completo/teléfonos se documentan según evidencia independiente.

PR52 integrado a master el04-oct-2026 14:20:26CDMX, commit6c3750dcafa022f174794c75a7a2186ca32dadcf. Árbol idéntico al candidato1205f72 validado. CI master37231717436 SUCCESS en secretos/audit/tipos-lint/deriva real; el log dice «Los tipos del repo coinciden con produccion.» y versiones legales aviso2.2/terminos1.1 coinciden. El texto del comando warning mostrado por bash no es una advertencia emitida; cache concurrente no pudo guardarse, sin fallo de job.

Producción Vercel4EJTjwR7dqdpykhmUGM4rge9WMYq SUCCESS:
https://vercel.com/peters-projects-b65496a9/vicinomarket/4EJTjwR7dqdpykhmUGM4rge9WMYq
Sitio https://vicinomarket.com muestra «Únete a VICINO», 4 solicitudes reales y tarjetas→login/next. Logo devuelve al feed de Solicitudes. Comunidades pública conserva vacío real; se detectó un fallo de sincronización de Descubrir durante el cierre y se documenta su corrección debajo. Acciones privadas siguen login. No se fabricaron comunidades ni se editó Alex.

## Evidencia literal de integración

```text
gh pr ready 52 --repo Peter-code-bot/PROJECT-VICINO
✓ Pull request Peter-code-bot/PROJECT-VICINO#52 is marked as "ready for review"
pr_ready_exit=0

gh pr merge 52 --repo Peter-code-bot/PROJECT-VICINO --merge --match-head-commit 1205f72a41acc0ebbe9448b87011e23483f7f5ba
pr_merge_exit=0
{"mergeCommit":{"oid":"6c3750dcafa022f174794c75a7a2186ca32dadcf"},"mergedAt":"2026-10-04T20:20:26Z","state":"MERGED","url":"https://github.com/Peter-code-bot/PROJECT-VICINO/pull/52"}
merge_read_exit=0

git diff --exit-code HEAD origin/master
sin salida
deployed_candidate_tree_match_exit=0

gh api repos/Peter-code-bot/PROJECT-VICINO/commits/6c3750dcafa022f174794c75a7a2186ca32dadcf/status
{"contexts":[{"context":"Vercel","state":"success","target_url":"https://vercel.com/peters-projects-b65496a9/vicinomarket/4EJTjwR7dqdpykhmUGM4rge9WMYq"}],"sha":"6c3750dcafa022f174794c75a7a2186ca32dadcf","state":"success"}

gh run view 37231717436 --repo Peter-code-bot/PROJECT-VICINO --json conclusion,jobs
{"conclusion":"success","jobs":[{"conclusion":"success","name":"npm audit"},{"conclusion":"success","name":"Escaneo de secretos"},{"conclusion":"success","name":"Deriva de tipos vs produccion"},{"conclusion":"success","name":"TypeScript type check"}]}
```

## Permisos de mapa: migración compensatoria posterior a app compatible

Lectura inicial confirmó ambas funciones con anon=true, authenticated/service_role=true, PUBLIC=false. Ledger20261002063000 histórico preservado. La migración nueva20261004202352 retira solo EXECUTE de PUBLIC/anon, después de verificar producción compatible. Funciones MD5bfddfb6b1eecc7584591da12ee57ac98 / b810ef6ed4605ad68944c40b7ae5ddd2 preservadas.

Preparador `scripts/prepare-map-permissions-sql.mjs`: un solo origen SQL, guardas de prerrequisitos/deriva, snapshot de dueño/definición/ACL privadas, límites de bloqueo/ejecución, restricciones y ledger en la misma transacción. Ensayo completo ROLLBACK primero; aplicación COMMIT después. No db push histórico, cambios de tablas/RLS ni perfiles.

```text
node scripts/prepare-map-permissions-sql.mjs --verify
{"version":"20261004202352","mode":"verify","sourceMd5":"7473398d40a0a14edea41ca825b9fef9","sourceSha":"3ff72fc294417ff11c7ce5111a5fff17532be79232c445ae1c0053a7040431a6","output":"apps/web/test-results/release-production/map-verify.sql"}
map_verify_prepare_exit=0
node scripts/prepare-map-permissions-sql.mjs
{"version":"20261004202352","mode":"apply","sourceMd5":"7473398d40a0a14edea41ca825b9fef9","sourceSha":"3ff72fc294417ff11c7ce5111a5fff17532be79232c445ae1c0053a7040431a6","output":"apps/web/test-results/release-production/map-apply.sql"}
map_apply_prepare_exit=0

SQL Editor VICINO/main/oxxdkwywprkfghhbnoto, ensayo:
{"result":"VERIFIED; ROLLBACK","functions":[{"anon":true,"signature":"search_map_publications_v1(jsonb)","public_grant":false,"service_role":true,"authenticated":true,"definition_md5":"bfddfb6b1eecc7584591da12ee57ac98"},{"anon":true,"signature":"search_map_publications_v2(jsonb)","public_grant":false,"service_role":true,"authenticated":true,"definition_md5":"b810ef6ed4605ad68944c40b7ae5ddd2"}],"ledger_present":false}

SQL Editor VICINO/main/oxxdkwywprkfghhbnoto, aplicación:
{"result":"APPLIED; COMMIT","functions":[{"anon":false,"signature":"search_map_publications_v1(jsonb)","public_grant":false,"service_role":true,"authenticated":true,"definition_md5":"bfddfb6b1eecc7584591da12ee57ac98"},{"anon":false,"signature":"search_map_publications_v2(jsonb)","public_grant":false,"service_role":true,"authenticated":true,"definition_md5":"b810ef6ed4605ad68944c40b7ae5ddd2"}],"ledger_present":true}
```

## Prueba real de API y Redis en producción

Script temporal ignorado y sin secretos:16comprobaciones, APIs propias, sin cookies, Auth POST, códigos, cuentas ni correos. Callback sin código es un recorrido de error; hasta21GET secuenciales, sin falsificar IP, sin seguir redirecciones ni iniciar OAuth. El21 fue rechazado con303/error=too_many_requests: acredita limitador real en producción, más allá del guard de variables del build. Cuota temporal del IP de prueba60s; no cambia configuración.

```text
node apps/web/test-results/release-production/smoke-production-s02.mjs
PASS production API feed=solicitudes: no session/location, bounded allowlist, no-store; counts=requests:4
PASS production API feed=comunidades: no session/location, bounded allowlist, no-store; counts=communities:0,posts:0
PASS production API feed=comunidades&tab=descubrir: no session/location, bounded allowlist, no-store; counts=communities:0,posts:0
PASS production private /mapa: login with exact safe next
PASS production private /buscar?q=mesa: login with exact safe next
PASS production private /favoritos: login with exact safe next
PASS production private /vender: login with exact safe next
PASS production private /chat: login with exact safe next
PASS production private /?feed=following: login with exact safe next
PASS production private /?feed=comunidades&tab=mias: login with exact safe next
PASS production private /?feed=solicitudes&cats=comida: login with exact safe next
PASS production private Home API feed=following: 401
PASS production private Home API feed=comunidades&tab=mias: 401
PASS production private Home API feed=solicitudes&cats=comida: 401
PASS production MapKit API: 401 before token generation
PASS production Redis limiter active: no-code OAuth callback blocked at request 21 (303 too_many_requests), no auth codes/accounts/emails
RESULT production API/rate-limit: 16/16 PASS; read-only app checks; no Auth POST or cookie/session retained
production_smoke_exit=0
```

## Incidencias de lectura

Fetch/PR/status fueron correctos. Primer bloque salió1 por las dos lecturas siguientes; ningún merge ni archivo se cambió desde esas lecturas. Se localizó security.yml y se usó glob de rg contra el directorio real.
```text
Get-Content: Cannot find path 'C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\.github\workflows\security-audit.yml' because it does not exist.
rg: supabase/migrations/20261002*: El nombre de archivo, el nombre de directorio o la sintaxis de la etiqueta del volumen no son correctos. (os error 123)
exit_code=1
```
No secrets ni cambios ajenos en commit; evidencia ampliada y horas finales en Notion.

## Revisión funcional de cierre

## Corrección final de navegación de comunidades

Durante la aceptación en producción, la URL cambiaba a Descubrir pero la pestaña seguía con aria-selected=false; Fundar enviaba a login con next=/?feed=comunidades. La prueba anterior solo comprobaba la URL y pasaba por login antes de probar Fundar: ese remonte ocultaba el fallo.

Next instalado16.3.6, app-router.js:270–276 confirma que __NA evita actualizar useSearchParams si se pasa como estado de una navegación externa. El primer ensayo replaceState(null, ...) compiló, pero ambas regresiones siguieron fallando después del retorno desde login. SessionDataProvider además instala/restaura wrappers de History al cambiar pathname; la causa completa de esa interacción no se declara resuelta por el primer diagnóstico. La corrección final usa router.replace interno de Next (guía instalada use-router.md), mantiene scroll:false y cambia solo pestañas públicas del componente invitado. Ajuste de cierre dentro del alcance de “termina todo lo pendiente y publica”, sin rehacer el trabajo existente. Diff final exacto:

```diff
+import { useRouter } from "next/navigation";
+  const router = useRouter();
-    window.history.replaceState(window.history.state, "", url.toString());
+    router.replace(url.pathname + url.search, { scroll: false });
```

Regresión ampliada en scripts/test-home-guest-http.ts: selección ARIA de Descubrir/Muro y Fundar inmediatamente después de cada cambio, retorno del logo y cero POST. Fixture de componentes incorpora replace del router simulado. Primero falló contra la versión compilada anterior (se conserva el fallo literal); resultados de los ensayos y de la corrección final debajo y en Tests/Notion.

```text
Producción CUA, esperar /login?next=%2F%3Ffeed%3Dcomunidades%26tab%3Ddescubrir después de Fundar:
Timed out waiting for URL https://vicinomarket.com/login?next=%2F%3Ffeed%3Dcomunidades%26tab%3Ddescubrir in tab 13.
URL observada: https://vicinomarket.com/login?next=%2F%3Ffeed%3Dcomunidades

$env:TEST_BROWSER='chromium'; $env:HOME_GUEST_BASE_URL='http://127.0.0.1:3116'; node --import tsx scripts/test-home-guest-http.ts
PASS help page remains public without login
PASS SSR feed=solicitudes: public preview without redirect
DATA requests=4; no contact/identity/media/geographic columns
PASS API feed=solicitudes: limited allowlist, no-store, anonymous and no location
PASS SSR feed=comunidades: public preview without redirect
DATA communities=0; posts=0; no fabricated rows
PASS API feed=comunidades: limited allowlist, no-store, anonymous and no location
PASS SSR feed=comunidades&tab=descubrir: public preview without redirect
DATA communities=0; posts=0; no fabricated rows
PASS API feed=comunidades&tab=descubrir: limited allowlist, no-store, anonymous and no location
PASS private /?feed=following: login exact next; Home API unauthorized
PASS private /?feed=comunidades&tab=mias: login exact next; Home API unauthorized
PASS private /?feed=solicitudes&cats=comida: login exact next; Home API unauthorized
PASS private /?feed=solicitudes&feed=following: login exact next; Home API unauthorized
PASS private /?feed=comunidades&tab=muro&tab=mias: login exact next; Home API unauthorized
PASS private /solicitudes/90000003-0003-4003-a003-000000000003: login exact next; Home API unauthorized
PASS desktop footer opens the public help page, never the private chat
PASS real request -> login -> original preview/scroll 474px stable
ExpectError: expect(locator).toHaveAttribute(expected) failed

Locator:  getByRole('tab', { name: 'Descubrir', exact: true })
Expected: "true"
Received: "false"
Timeout:  5000ms

Call log:
  - Expect "to.have.attribute.value" with timeout 5000ms
  - waiting for getByRole('tab', { name: 'Descubrir', exact: true })
    14 × locator resolved to <button role="tab" type="button" aria-selected="false" class="relative flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-all min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg! text-fg dark:text-fg-muted hover:text-fg">Descubrir</button>
       - unexpected value "false"

    at captureRawStack (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\node_modules\.pnpm\playwright-core@1.60.0\node_modules\playwright-core\lib\coreBundle.js:3130:17)
    at callMatcherAsStep (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\node_modules\.pnpm\playwright@1.60.0\node_modules\playwright\lib\matchers\expect.js:12873:57)
    at Object.toHaveAttribute (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\node_modules\.pnpm\playwright@1.60.0\node_modules\playwright\lib\matchers\expect.js:12863:23)
    at main (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\scripts\test-home-guest-http.ts:116:79) {
  matcherResult: {
    name: 'toHaveAttribute',
    expected: 'true',
    message: 'expect(locator).toHaveAttribute(expected) failed\n' +
      '\n' +
      "Locator:  getByRole('tab', { name: 'Descubrir', exact: true })\n" +
      'Expected: "true"\n' +
      'Received: "false"\n' +
      'Timeout:  5000ms\n' +
      '\n' +
      'Call log:\n' +
      '  - Expect "to.have.attribute.value" with timeout 5000ms\n' +
      "  - waiting for getByRole('tab', { name: 'Descubrir', exact: true })\n" +
      '    14 × locator resolved to <button role="tab" type="button" aria-selected="false" class="relative flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-all min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg! text-fg dark:text-fg-muted hover:text-fg">Descubrir</button>\n' +
      '       - unexpected value "false"\n',
    pass: false,
    actual: 'false',
    log: [
      '  - Expect "to.have.attribute.value" with timeout 5000ms',
      "  - waiting for getByRole('tab', { name: 'Descubrir', exact: true })",
      '    14 × locator resolved to <button role="tab" type="button" aria-selected="false" class="relative flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-all min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg! text-fg dark:text-fg-muted hover:text-fg">Descubrir</button>',
      '       - unexpected value "false"'
    ],
    timeout: 5000,
    ariaSnapshot: '- tab "Descubrir"'
  }
}
before_fix_http_exit=1

```

Preparación de prueba: corepack pnpm exec tsx no resolvió el ejecutable; node --import tsx en sandbox falló antes de correr casos. Ejecución fuera del sandbox permitió reproducir el fallo real anterior; no se confundió error de entorno con validación.

```text
corepack.cmd pnpm exec tsx scripts/test-home-guest-http.ts
"tsx" no se reconoce como un comando interno o externo,
programa o archivo por lotes ejecutable.
before_fix_http_exit=1

node --import tsx scripts/test-home-guest-http.ts [sandbox]
node:os:306
    throw new ERR_SYSTEM_ERROR(ctx);
          ^

SystemError [ERR_SYSTEM_ERROR]: A system error occurred: uv_os_get_passwd returned ENOMEM (not enough memory)
    at Object.userInfo (node:os:306:11)
    at file:///C:/Users/Hp%20User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/node_modules/.pnpm/tsx@4.21.0/node_modules/tsx/dist/temporary-directory-CwHp0_NW.mjs:1:84
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at async node:internal/modules/esm/loader:643:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:96:9) {
  code: 'ERR_SYSTEM_ERROR',
  info: {
    errno: -4057,
    code: 'ENOMEM',
    message: 'not enough memory',
    syscall: 'uv_os_get_passwd'
  },
  errno: [Getter/Setter],
  syscall: [Getter/Setter]
}

Node.js v24.18.0
before_fix_http_exit=1
```

## Reversión de la publicación

### Primer ajuste null: fallo chromium después de build con exit0

```text
$env:TEST_BROWSER='chromium'; node --import tsx scripts/test-home-guest-http.ts
PASS help page remains public without login
PASS SSR feed=solicitudes: public preview without redirect
DATA requests=4; no contact/identity/media/geographic columns
PASS API feed=solicitudes: limited allowlist, no-store, anonymous and no location
PASS SSR feed=comunidades: public preview without redirect
DATA communities=0; posts=0; no fabricated rows
PASS API feed=comunidades: limited allowlist, no-store, anonymous and no location
PASS SSR feed=comunidades&tab=descubrir: public preview without redirect
DATA communities=0; posts=0; no fabricated rows
PASS API feed=comunidades&tab=descubrir: limited allowlist, no-store, anonymous and no location
PASS private /?feed=following: login exact next; Home API unauthorized
PASS private /?feed=comunidades&tab=mias: login exact next; Home API unauthorized
PASS private /?feed=solicitudes&cats=comida: login exact next; Home API unauthorized
PASS private /?feed=solicitudes&feed=following: login exact next; Home API unauthorized
PASS private /?feed=comunidades&tab=muro&tab=mias: login exact next; Home API unauthorized
PASS private /solicitudes/90000003-0003-4003-a003-000000000003: login exact next; Home API unauthorized
PASS desktop footer opens the public help page, never the private chat
PASS real request -> login -> original preview/scroll 474px stable
ExpectError: expect(locator).toHaveAttribute(expected) failed

Locator:  getByRole('tab', { name: 'Descubrir', exact: true })
Expected: "true"
Received: "false"
Timeout:  5000ms

Call log:
  - Expect "to.have.attribute.value" with timeout 5000ms
  - waiting for getByRole('tab', { name: 'Descubrir', exact: true })
    13 × locator resolved to <button role="tab" type="button" aria-selected="false" class="relative flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-all min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg! text-fg dark:text-fg-muted hover:text-fg">Descubrir</button>
       - unexpected value "false"

    at captureRawStack (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\node_modules\.pnpm\playwright-core@1.60.0\node_modules\playwright-core\lib\coreBundle.js:3130:17)
    at callMatcherAsStep (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\node_modules\.pnpm\playwright@1.60.0\node_modules\playwright\lib\matchers\expect.js:12873:57)
    at Object.toHaveAttribute (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\node_modules\.pnpm\playwright@1.60.0\node_modules\playwright\lib\matchers\expect.js:12863:23)
    at main (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\scripts\test-home-guest-http.ts:116:79) {
  matcherResult: {
    name: 'toHaveAttribute',
    expected: 'true',
    message: 'expect(locator).toHaveAttribute(expected) failed\n' +
      '\n' +
      "Locator:  getByRole('tab', { name: 'Descubrir', exact: true })\n" +
      'Expected: "true"\n' +
      'Received: "false"\n' +
      'Timeout:  5000ms\n' +
      '\n' +
      'Call log:\n' +
      '  - Expect "to.have.attribute.value" with timeout 5000ms\n' +
      "  - waiting for getByRole('tab', { name: 'Descubrir', exact: true })\n" +
      '    13 × locator resolved to <button role="tab" type="button" aria-selected="false" class="relative flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-all min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg! text-fg dark:text-fg-muted hover:text-fg">Descubrir</button>\n' +
      '       - unexpected value "false"\n',
    pass: false,
    actual: 'false',
    log: [
      '  - Expect "to.have.attribute.value" with timeout 5000ms',
      "  - waiting for getByRole('tab', { name: 'Descubrir', exact: true })",
      '    13 × locator resolved to <button role="tab" type="button" aria-selected="false" class="relative flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-all min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg! text-fg dark:text-fg-muted hover:text-fg">Descubrir</button>',
      '       - unexpected value "false"'
    ],
    timeout: 5000,
    ariaSnapshot: '- tab "Descubrir"'
  }
}
final_chromium_http_exit=1

```

### Primer ajuste null: fallo webkit después de build con exit0

```text
$env:TEST_BROWSER='webkit'; node --import tsx scripts/test-home-guest-http.ts
PASS help page remains public without login
PASS SSR feed=solicitudes: public preview without redirect
DATA requests=4; no contact/identity/media/geographic columns
PASS API feed=solicitudes: limited allowlist, no-store, anonymous and no location
PASS SSR feed=comunidades: public preview without redirect
DATA communities=0; posts=0; no fabricated rows
PASS API feed=comunidades: limited allowlist, no-store, anonymous and no location
PASS SSR feed=comunidades&tab=descubrir: public preview without redirect
DATA communities=0; posts=0; no fabricated rows
PASS API feed=comunidades&tab=descubrir: limited allowlist, no-store, anonymous and no location
PASS private /?feed=following: login exact next; Home API unauthorized
PASS private /?feed=comunidades&tab=mias: login exact next; Home API unauthorized
PASS private /?feed=solicitudes&cats=comida: login exact next; Home API unauthorized
PASS private /?feed=solicitudes&feed=following: login exact next; Home API unauthorized
PASS private /?feed=comunidades&tab=muro&tab=mias: login exact next; Home API unauthorized
PASS private /solicitudes/90000003-0003-4003-a003-000000000003: login exact next; Home API unauthorized
PASS desktop footer opens the public help page, never the private chat
PASS real request -> login -> original preview/scroll 474px stable
ExpectError: expect(locator).toHaveAttribute(expected) failed

Locator:  getByRole('tab', { name: 'Descubrir', exact: true })
Expected: "true"
Received: "false"
Timeout:  5000ms

Call log:
  - Expect "to.have.attribute.value" with timeout 5000ms
  - waiting for getByRole('tab', { name: 'Descubrir', exact: true })
    14 × locator resolved to <button role="tab" type="button" aria-selected="false" class="relative flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-all min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg! text-fg dark:text-fg-muted hover:text-fg">Descubrir</button>
       - unexpected value "false"

    at captureRawStack (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\node_modules\.pnpm\playwright-core@1.60.0\node_modules\playwright-core\lib\coreBundle.js:3130:17)
    at callMatcherAsStep (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\node_modules\.pnpm\playwright@1.60.0\node_modules\playwright\lib\matchers\expect.js:12873:57)
    at Object.toHaveAttribute (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\node_modules\.pnpm\playwright@1.60.0\node_modules\playwright\lib\matchers\expect.js:12863:23)
    at main (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\scripts\test-home-guest-http.ts:116:79) {
  matcherResult: {
    name: 'toHaveAttribute',
    expected: 'true',
    message: 'expect(locator).toHaveAttribute(expected) failed\n' +
      '\n' +
      "Locator:  getByRole('tab', { name: 'Descubrir', exact: true })\n" +
      'Expected: "true"\n' +
      'Received: "false"\n' +
      'Timeout:  5000ms\n' +
      '\n' +
      'Call log:\n' +
      '  - Expect "to.have.attribute.value" with timeout 5000ms\n' +
      "  - waiting for getByRole('tab', { name: 'Descubrir', exact: true })\n" +
      '    14 × locator resolved to <button role="tab" type="button" aria-selected="false" class="relative flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-all min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg! text-fg dark:text-fg-muted hover:text-fg">Descubrir</button>\n' +
      '       - unexpected value "false"\n',
    pass: false,
    actual: 'false',
    log: [
      '  - Expect "to.have.attribute.value" with timeout 5000ms',
      "  - waiting for getByRole('tab', { name: 'Descubrir', exact: true })",
      '    14 × locator resolved to <button role="tab" type="button" aria-selected="false" class="relative flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-all min-h-12 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg! text-fg dark:text-fg-muted hover:text-fg">Descubrir</button>',
      '       - unexpected value "false"'
    ],
    timeout: 5000,
    ariaSnapshot: '- tab "Descubrir"'
  }
}
final_webkit_http_exit=1

```

## Reversión y pendientes de aceptación

### Incidencia de orquestación de validaciones

Type-check concurrente con build salió2 al desaparecer los archivos generados .next/types. No se cambió tsconfig ni se ocultó el fallo. Se repite secuencialmente después del build final. Los dos servidores propios3116 se detuvieron mediante Ctrl+C (exit1 esperado por interrupción); nunca se detuvo el servidor3115 del usuario.

```text
corepack.cmd pnpm --filter web type-check [concurrente con build]
Warning: truncated output (original token count: 6991)
Total output lines: 235

error TS6053: File 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/.next/types/app/(account)/historial/page.ts' not found.
  The file is in the program because:
    Matched by include pattern '.next/types/**/*.ts' in 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/tsconfig.json'
error TS6053: File 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/.next/types/app/(account)/historial/review/page.ts' not found.
  The file is in the program because:
    Matched by include pattern '.next/types/**/*.ts' in 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/tsconfig.json'
error TS6053: File 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/.next/types/app/(auth)/forgot-password/page.ts' not found.
  The file is in the program because:
    Matched by include pattern '.next/types/**/*.ts' in 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/tsconfig.json'
error TS6053: File 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/.next/types/app/(auth)/login/page.ts' not found.
  The file is in the program because:
    Matched by include pattern '.next/types/**/*.ts' in 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/tsconfig.json'
error TS6053: File 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/.next/types/app/(auth)/register/page.ts' not found.
  The file is in the program because:
[Se trunca explícitamente la salida intermedia de TS6053; error por leer .next/types mientras el build lo regeneraba.]
  The file is in the program because:
    Matched by include pattern '.next/types/**/*.ts' in 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/tsconfig.json'
error TS6053: File 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/.next/types/app/seller/reviews/page.ts' not found.
  The file is in the program because:
    Matched by include pattern '.next/types/**/*.ts' in 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/tsconfig.json'
error TS6053: File 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/.next/types/app/seller/ventas/page.ts' not found.
  The file is in the program because:
    Matched by include pattern '.next/types/**/*.ts' in 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/tsconfig.json'
error TS6053: File 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/.next/types/app/seller/verificacion/page.ts' not found.
  The file is in the program because:
    Matched by include pattern '.next/types/**/*.ts' in 'C:/Users/Hp User/Documents/Javier/proyectos/VICINO/PROJECT-VICINO-REGISTRO/apps/web/tsconfig.json'
C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\apps\web:
 ERR_PNPM_RECURSIVE_RUN_FIRST_FAIL  web@0.1.0 type-check: `tsc --noEmit`
Exit status 2
router_type_check_exit=2
```

## Reversión y aceptación independiente

### Corrección final con router: validación local aprobada

Next/Supabase reales, lectura solamente:18/18 Chromium y18/18 WebKit/exit0, incluyendo selección efectiva y Fundar desde Muro/Descubrir antes de remonte. Cero POST Auth/acciones; scroll474px estable. Componentes/CSS36+36 con fronteras Next/Auth/DB simuladas; no equivale a dispositivos. Type-check secuencial después del build exit0 y lint dirigido exit0. Compilación58/58; logs completos ignorados. Auditoría/secretos y deriva remotos del cierre se registran con SHA final en Notion al integrar.

```text
corepack.cmd pnpm --filter web build

> web@0.1.0 build C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-REGISTRO\apps\web
> node scripts/check-no-todo.mjs && node scripts/check-rate-limit-env.mjs && node ../../scripts/check-rutas.mjs && next build --webpack

OK: No TODO stubs detected.
Todas las rutas enlazadas existen. (74 rutas en el arbol)
▲ Next.js 16.3.6 (webpack)
- Environments: .env.local
[@sentry/nextjs] DEPRECATION WARNING: disableLogger is deprecated and will be removed in a future version. Use webpack.treeshake.removeDebugLogging instead.
[@sentry/nextjs] DEPRECATION WARNING: automaticVercelMonitors is deprecated and will be removed in a future version. Use webpack.automaticVercelMonitors instead.
✓ Running next.config.ts took 5.8s
- Experiments (use with caution):
  · clientTraceMetadata
  · optimizePackageImports
  · staleTimes
[salida intermedia truncada; log completo ignorado en apps/web/test-results/release-production/router-build.log]
├ ƒ /seller/analytics
├ ƒ /seller/cupones
├ ƒ /seller/cupones/nuevo
├ ƒ /seller/listings
├ ƒ /seller/reviews
├ ƒ /seller/ventas
├ ƒ /seller/verificacion
├ ƒ /settings
├ ƒ /solicitudes/[id]
├ ƒ /terminos
├ ƒ /vendedor/[id]
├ ƒ /vender
└ ƒ /vender/[id]/editar


ƒ Proxy (Middleware)

○  (Static)   prerendered as static content
ƒ  (Dynamic)  server-rendered on demand

router_build_exit=0

corepack.cmd pnpm --filter web type-check [secuencial después de build]
router_type_check_after_build_exit=0
corepack.cmd pnpm --filter web exec eslint components/home/guest-home-feeds.tsx
sin salida de eslint
router_lint_exit=0

$env:TEST_BROWSER='chromium'; node --import tsx scripts/test-home-guest-http.ts
PASS help page remains public without login
PASS SSR feed=solicitudes: public preview without redirect
DATA requests=4; no contact/identity/media/geographic columns
PASS API feed=solicitudes: limited allowlist, no-store, anonymous and no location
PASS SSR feed=comunidades: public preview without redirect
DATA communities=0; posts=0; no fabricated rows
PASS API feed=comunidades: limited allowlist, no-store, anonymous and no location
PASS SSR feed=comunidades&tab=descubrir: public preview without redirect
DATA communities=0; posts=0; no fabricated rows
PASS API feed=comunidades&tab=descubrir: limited allowlist, no-store, anonymous and no location
PASS private /?feed=following: login exact next; Home API unauthorized
PASS private /?feed=comunidades&tab=mias: login exact next; Home API unauthorized
PASS private /?feed=solicitudes&cats=comida: login exact next; Home API unauthorized
PASS private /?feed=solicitudes&feed=following: login exact next; Home API unauthorized
PASS private /?feed=comunidades&tab=muro&tab=mias: login exact next; Home API unauthorized
PASS private /solicitudes/90000003-0003-4003-a003-000000000003: login exact next; Home API unauthorized
PASS desktop footer opens the public help page, never the private chat
PASS real request -> login -> original preview/scroll 474px stable
PASS primary tabs and public discovery navigate without login
PASS discovery/wall selection and immediate login destination stay in sync without reload
PASS private community actions -> login, logo returns discovery; zero Auth/action POST
RESULT chromium: 18/18 PASS; Next/Supabase real read-only; device/Auth completion pending
router_chromium_http_exit=0

$env:TEST_BROWSER='webkit'; node --import tsx scripts/test-home-guest-http.ts
PASS help page remains public without login
PASS SSR feed=solicitudes: public preview without redirect
DATA requests=4; no contact/identity/media/geographic columns
PASS API feed=solicitudes: limited allowlist, no-store, anonymous and no location
PASS SSR feed=comunidades: public preview without redirect
DATA communities=0; posts=0; no fabricated rows
PASS API feed=comunidades: limited allowlist, no-store, anonymous and no location
PASS SSR feed=comunidades&tab=descubrir: public preview without redirect
DATA communities=0; posts=0; no fabricated rows
PASS API feed=comunidades&tab=descubrir: limited allowlist, no-store, anonymous and no location
PASS private /?feed=following: login exact next; Home API unauthorized
PASS private /?feed=comunidades&tab=mias: login exact next; Home API unauthorized
PASS private /?feed=solicitudes&cats=comida: login exact next; Home API unauthorized
PASS private /?feed=solicitudes&feed=following: login exact next; Home API unauthorized
PASS private /?feed=comunidades&tab=muro&tab=mias: login exact next; Home API unauthorized
PASS private /solicitudes/90000003-0003-4003-a003-000000000003: login exact next; Home API unauthorized
PASS desktop footer opens the public help page, never the private chat
PASS real request -> login -> original preview/scroll 474px stable
PASS primary tabs and public discovery navigate without login
PASS discovery/wall selection and immediate login destination stay in sync without reload
PASS private community actions -> login, logo returns discovery; zero Auth/action POST
RESULT webkit: 18/18 PASS; Next/Supabase real read-only; device/Auth completion pending
router_webkit_http_exit=0

$env:TEST_BROWSER='chromium'; node --import tsx scripts/test-home-guest-browser.ts
PASS 375px primary Solicitudes/Comunidades tabs navigate public previews
PASS 375px primary Following tab stays private
PASS 375px Muro/Descubrir change real content through history without login or effects
PASS 375px Mis comunidades goes to login and auth logo preserves public preview
PASS 375px Me gusta preserves post context without mutation
PASS 375px Comentar preserves post context without mutation
PASS 375px founding preserves feed context without mutation
PASS 375px request filters lead to login
PASS 375px request creation has no automatic effect
PASS 375px request card anchor carries exact detail context
PASS 375px new-tab uses actual guest anchor URL, never private detail
PASS 375px keyboard detail/login/Home return preserves tab and actual captured scroll after settling
PASS 375px light /?feed=solicitudes: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 375px light /?feed=comunidades: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 375px light /?feed=comunidades&tab=descubrir: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 375px dark /?feed=solicitudes: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 375px dark /?feed=comunidades: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 375px dark /?feed=comunidades&tab=descubrir: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px primary Solicitudes/Comunidades tabs navigate public previews
PASS 1280px primary Following tab stays private
PASS 1280px Muro/Descubrir change real content through history without login or effects
PASS 1280px Mis comunidades goes to login and auth logo preserves public preview
PASS 1280px Me gusta preserves post context without mutation
PASS 1280px Comentar preserves post context without mutation
PASS 1280px founding preserves feed context without mutation
PASS 1280px request filters lead to login
PASS 1280px request creation has no automatic effect
PASS 1280px request card anchor carries exact detail context
PASS 1280px new-tab uses actual guest anchor URL, never private detail
PASS 1280px keyboard detail/login/Home return preserves tab and actual captured scroll after settling
PASS 1280px light /?feed=solicitudes: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px light /?feed=comunidades: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px light /?feed=comunidades&tab=descubrir: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px dark /?feed=solicitudes: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px dark /?feed=comunidades: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px dark /?feed=comunidades&tab=descubrir: 48px targets, text >=4.5, keyboard focus >=3, no overflow
RESULT chromium: 36/36 PASS; real components/current CSS; Next/Auth/DB simulated; no device acceptance
router_chromium_components_exit=0

$env:TEST_BROWSER='webkit'; node --import tsx scripts/test-home-guest-browser.ts
PASS 375px primary Solicitudes/Comunidades tabs navigate public previews
PASS 375px primary Following tab stays private
PASS 375px Muro/Descubrir change real content through history without login or effects
PASS 375px Mis comunidades goes to login and auth logo preserves public preview
PASS 375px Me gusta preserves post context without mutation
PASS 375px Comentar preserves post context without mutation
PASS 375px founding preserves feed context without mutation
PASS 375px request filters lead to login
PASS 375px request creation has no automatic effect
PASS 375px request card anchor carries exact detail context
PASS 375px new-tab uses actual guest anchor URL, never private detail
PASS 375px keyboard detail/login/Home return preserves tab and actual captured scroll after settling
PASS 375px light /?feed=solicitudes: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 375px light /?feed=comunidades: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 375px light /?feed=comunidades&tab=descubrir: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 375px dark /?feed=solicitudes: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 375px dark /?feed=comunidades: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 375px dark /?feed=comunidades&tab=descubrir: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px primary Solicitudes/Comunidades tabs navigate public previews
PASS 1280px primary Following tab stays private
PASS 1280px Muro/Descubrir change real content through history without login or effects
PASS 1280px Mis comunidades goes to login and auth logo preserves public preview
PASS 1280px Me gusta preserves post context without mutation
PASS 1280px Comentar preserves post context without mutation
PASS 1280px founding preserves feed context without mutation
PASS 1280px request filters lead to login
PASS 1280px request creation has no automatic effect
PASS 1280px request card anchor carries exact detail context
PASS 1280px new-tab uses actual guest anchor URL, never private detail
PASS 1280px keyboard detail/login/Home return preserves tab and actual captured scroll after settling
PASS 1280px light /?feed=solicitudes: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px light /?feed=comunidades: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px light /?feed=comunidades&tab=descubrir: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px dark /?feed=solicitudes: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px dark /?feed=comunidades: 48px targets, text >=4.5, keyboard focus >=3, no overflow
PASS 1280px dark /?feed=comunidades&tab=descubrir: 48px targets, text >=4.5, keyboard focus >=3, no overflow
RESULT webkit: 36/36 PASS; real components/current CSS; Next/Auth/DB simulated; no device acceptance
router_webkit_components_exit=0

```

Incidencias de descubrimiento de herramienta, sin cambios de código ni bloqueo final: Get-Command gitleaks no estaba en PATH; se localizó la herramienta existente en VICINO/scratch/handoff-gitleaks/gitleaks.exe. El inventario de nombres rg informó dos directorios ajenos inaccesibles y no se abrió su contenido.
```text
Get-Command gitleaks
The term 'gitleaks' is not recognized as a name of a cmdlet, function, script file, or executable program.
Check the spelling of the name, or if a path was included, verify that the path is correct and try again.
rg: C:/Users/Hp User/Documents/Javier/proyectos\\herramientas_trabajo_ia\\tests\\.pytest_cache: Acceso denegado. (os error 5)
rg: C:/Users/Hp User/Documents/Javier/proyectos\\herramientas_trabajo_ia\\.pytest_cache: Acceso denegado. (os error 5)
```

## Reversión final y aceptación

Volver primero a versión compatible anterior. Si la app anterior necesita acceso invitado al mapa, restaurar solo el grant anterior mediante migración compensatoria con ledger; conservar definición y permisos privados. No revivir claves expuestas. Lecturas Home/preview usan otras RPC y no se revocan.

Entrega técnica S02 publicada. Este cierre versiona la migración aplicada y corrige la sincronización de pestañas; SHA/CI/producción y fin real se registran en Notion después de integrar, sin inventar controles posteriores a este commit. Revertir el ajuste de UI a6c3750d no necesita reabrir permisos de mapa: esa versión S02 ya protege el acceso. NT01–NT04 completos, correo/OTP/recuperación/OAuth y Android/iPhone conservan aceptación independiente según evidencia, además del carril Google Play. Publicación no inventa pruebas físicas ni cierra MP06–MP19.
