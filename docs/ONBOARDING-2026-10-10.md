# Onboarding por dato — implementación y publicación

## Corte de publicación — Supabase aplicado, candidato para PR54

Javier autorizó publicar a master tras completar requisitos y comprobaciones. La migración `20261010120000_onboarding_por_dato_y_usuario.sql` está aplicada a VICINO/main y registrada en el ledger dentro de la misma transacción. Se verificaron seis cuerpos de función contra el código local, permisos autenticados, bloqueo anónimo, RLS, índice único de username y presencia del RPC anterior. La PR [54](https://github.com/Peter-code-bot/PROJECT-VICINO/pull/54) contiene el candidato; la integración y el despliegue final se registran en el corte de cierre y en Notion.

Antes de confirmar el cambio remoto, el ensayo del DDL y ledger terminó con `ROLLBACK`. Un segundo ensayo usó el rol `authenticated` y claims locales a la transacción, sin exportar identificadores de cuentas: comprobó el usuario propio, reservados, otro usuario ocupado sin distinguir mayúsculas, guardado atómico, Omitir sin cambiar datos/activar vendedor, llamada al RPC anterior y finalización conjunta. También terminó con `ROLLBACK`. La aplicación persistente ejecutó únicamente el DDL, sus verificaciones y ledger; no persistió las operaciones de prueba sobre perfiles ni creó cuentas.

El primer CI de PR54 detectó diferencias del artefacto generado y 13 vulnerabilidades de dependencias del baseline (1 low, 5 moderate, 3 high y 4 critical). Se incorporó el archivo completo de tipos generado por CI38114074868: orden de `consultar_usuarios_onboarding` y función interna `username_validation_status`; el SHA256 del artefacto y archivo incorporado es `fa34ee2a9d436a9291b96d88fe31f33a4d530eb20215cdb95314de8aa7f3a1f6`. Conserva la protección de la columna de mapa generada.

Las correcciones necesarias para publicar son Next16.3.6→16.3.8, Capacitor core/cli/android/ios8.3.0→8.4.3 y suelos sharp0.35.5, source-map-js1.2.2, handlebars4.7.10. Se conservan ESLint16.3.6, sus patches y los de PWA/tinyglobby; no se rebaja audit. Referencias de los mantenedores: [Next](https://github.com/vercel/next.js/security/advisories/GHSA-cjq9-62q9-8jv4), [Capacitor](https://github.com/ionic-team/capacitor/security/advisories/GHSA-rvm3-566m-v7fv), [sharp](https://github.com/lovell/sharp/security/advisories/GHSA-wq5f-xc86-pv6w), [Handlebars](https://github.com/handlebars-lang/handlebars.js/security/advisories/GHSA-8r5x-fm3f-whwj) y [source-map-js](https://github.com/7rulnik/source-map-js/releases/tag/v1.2.2). El diff exacto está en los manifests/lockfile de esta PR.

Validación del candidato corregido: instalación congelada, audit completo sin vulnerabilidades, tipos web/shared, glob62/62, Auth/perfil/service worker24/24, Sentry JS con contexto Android sintético5/5, UI102/102 y build59/59, todos exit0. Lint tras build: 0 errores y148 avisos; incluye archivos generados del service worker. CI vuelve a verificar desde un checkout limpio. La revisión independiente de manifests, lockfile, SQL y flujo no encontró P0/P1 del candidato web.

**Límites:** siguen pendientes la concurrencia real entre sesiones y la aceptación de teclado, mapa, foto y permisos en Android/iPhone físicos. El ensayo SQL autenticado no acredita el recorrido completo de navegador con una cuenta de prueba. El parche de Capacitor se encuentra en el código y lockfile: las apps instaladas requieren sincronización, reconstrucción y nueva distribución para recibirlo; esta publicación no genera ni distribuye binarios nativos. La conversión de una cuenta previa conserva el borrador al Volver dentro de la visita, pero recargar antes de Activar recupera los datos anteriores.

Los cortes inferiores conservan la evidencia histórica de implementación local y revisión previa; sus estados de remoto pendiente no sustituyen este corte.

Fuente: seis capturas y decisiones de Javier en esta conversación del 10-oct-2026; autorización de implementación «Comienza lo que diga el plan». Equipo seleccionado por Workflow Advisor: diseño, flujo y usuario/SQL. La dirección vigente y el seguimiento continúan en [Notion](https://app.notion.com/p/3de98e8a0cfa81cc812ef86a0ca65263).

Trabajo aislado en `PROJECT-VICINO-ONBOARDING`, rama `feat/onboarding-20261010`, sobre `origin/master` `d2d54cd`. Los cambios previos del checkout principal se conservaron.

## Comportamiento entregado

El contenido empieza arriba y ocupa una columna centrada horizontalmente de hasta 448 px. El formulario tiene scroll propio; Continuar y Omitir quedan en el pie. Un solo contenedor aplica safe areas y la altura del viewport visual. Al abrir el teclado se mantiene el campo activo dentro del área del formulario, sin otra compensación de altura. Verde, crema, Outfit/Inter y tokens existentes se conservan; los textos del ID tienen contraste suficiente también en oscuro.

Cada pregunta tiene una URL `/completar-perfil/{paso}`. Explorar recorre usuario, nombre, foto, descripción, intereses, ubicación, notificaciones y cierre. Vender añade categoría, tipo, pagos para negocio y confirmación explícita de activación. El nombre y la descripción del negocio también tienen páginas propias.

Continuar guarda el dato y el siguiente paso en una transacción. Omitir envía sólo el avance: conserva el dato anterior. Volver mantiene ediciones temporales en sessionStorage de esa cuenta; el progreso confirmado se recupera de la base al reabrir. Los marcadores anteriores `perfil`, `intereses` y `ubicacion` siguen aceptados, y un perfil terminado no vuelve al onboarding. Los errores de lectura ofrecen reintento en la misma ruta, sin rebote a bienvenida. Se conserva el destino seguro de Auth al finalizar.

El ID elegido sigue siendo `profiles.username`, con las reglas existentes de 3–30 letras ASCII, números y guion bajo e índice único sin distinción de mayúsculas. `profiles.id` y `user_id` permanecen iguales. Las tres sugerencias usan el nombre del correo más números, normalizado y truncado; un correo relay usa el nombre del perfil como alternativa. Se comprueban antes de mostrarse y otra vez al confirmar. Una colisión actualiza el estado a «en uso» y permite elegir otra opción. Omitir conserva el ID automático actual.

Los borradores del vendedor no activan la cuenta. Sólo Activar Modo Vendedor convierte; Ahora no termina como explorador. Si la activación ya tuvo éxito y falla el guardado del avance, el reintento no activa por segunda vez. Las cuentas previas conservan su ruta de alta, ahora con los campos separados y precargados. Al omitir una nueva foto, descripción o pagos se conservan sus valores anteriores. La preparación, recorte y subida de foto bloquean la navegación hasta concluir o cancelar el recorte.

La ubicación elegida se confirma en la cookie y almacenamiento existentes. Omitir conserva la zona previa; sin zona, el inicio existente ofrece Activar ubicación. El centro por defecto del mapa no cuenta como selección. Las notificaciones permiten continuar u omitir ante permiso desconocido, fallo o denegación; un fallo al guardar el avance mantiene la pantalla y permite reintentar.

## Validación y alcance

Todas las pruebas usan datos sintéticos; no se crearon cuentas ni se enviaron mensajes/correos ni se modificó Supabase remoto. Los harness usan componentes reales y simulan sus límites externos. No equivalen a una prueba nativa o autenticada contra la base desplegada.

```text
node node_modules/tsx/dist/cli.mjs scripts/test-onboarding-username.ts
18 comprobaciones aisladas aprobadas. PGlite serializa escrituras; sin prueba multisesión ni remoto.
exit code: 0

node --import tsx scripts/test-onboarding-vendedor.ts
tests 14
pass 14
fail 0
exit code: 0

node node_modules/tsx/dist/cli.mjs scripts/test-onboarding-flow.ts
tests 9
pass 9
fail 0
exit code: 0

node scripts/check-rutas.mjs
Todas las rutas enlazadas existen. (76 rutas en el arbol)
exit code: 0

node node_modules/typescript/bin/tsc --noEmit --incremental false   [apps/web]
sin salida
exit code: 0

node node_modules/typescript/bin/tsc --noEmit   [packages/shared]
sin salida
exit code: 0

node node_modules/eslint/bin/eslint.js .   [apps/web]
60 problems (0 errors, 60 warnings)
exit code: 0

node scripts/test-onboarding-ui.mjs
cases: 102
passed: 102
failed: 0
exit code: 0

node test-results/onboarding/build-local.cjs   [apps/web]
Compiled successfully in 75s
Finished TypeScript in 18.2s
Generating static pages using 3 workers (59/59) in 14.6s
exit code: 0
```

El lint dirigido del onboarding, API y helpers pasó sin errores; sólo permanece el aviso anterior por img en AvatarInlineUpload. Instalación con pnpm 9.15.0 y lockfile congelado: exit 0. El build se ejecuta con URL/clave sintéticas, sin credenciales reales; sus validaciones de TODO, entorno y rutas se mantienen.

Prueba de UI: 102/102 aprobadas en móvil 375×812, escritorio 1280×800, viewport reducido 375×400, modos claro/oscuro y texto al 200%, con CSS actual y fuentes reales del build. Incluye ID ocupado/reservado/inválido, sugerencia pulsada dos veces, colisión al guardar, omitir con Continuar deshabilitado, recuperación de borradores, activación explícita y errores/permisos de notificaciones. Sin errores de página ni tráfico externo. Se recapturaron seis pantallas canónicas tras cargar las fuentes y terminar la transición del botón. Capturas y resultados por caso: `apps/web/test-results/onboarding/` (artefactos ignorados por Git).

La revisión adversarial independiente no encontró P0/P1. Se corrigieron dos P2 del ID, la navegación doble en notificaciones, la reactivación tras fallo de avance y el contraste oscuro. La regresión con foco antes de abrir teclado falló en los tres campos y pasó después de corregir el scroll del formulario. Las primeras mediciones de centrado fueron falsos positivos por ignorar el gutter de la scrollbar; se corrigió el harness para medir el área útil con safe areas. Los primeros intentos sandbox de subprocess fallaron con EPERM y se ejecutaron aislados fuera del sandbox, sin credenciales ni red externa.

## Aplicación pendiente al cerrar el corte local — histórico

La migración `20261010120000_onboarding_por_dato_y_usuario.sql` está preparada y probada en PostgreSQL WASM, sin aplicar a remoto. Añade RPC v2, consulta de disponibilidad y política compartida; amplía los pasos permitidos; finaliza bandera y marcador juntos; el generador automático evita un código ya usado como username. Mantiene el RPC anterior y los perfiles existentes, incluida la reanudación de negocios legacy sin nombre.

Para una entrega desplegada, aplicar primero esta migración y verificar permisos/RPC sobre la base de prueba; después desplegar la aplicación compatible. Quedan por verificar la concurrencia real entre sesiones, los recorridos autenticados con cuentas de prueba y teclado, mapa, subida de foto y permiso push en Android/iPhone físicos. En este corte no hay push de rama, PR, despliegue ni nueva versión nativa.

## Publicación autorizada — revisión previa

Javier autoriza push a master tras comprobar requisitos y seguridad. La consulta real del esquema desde la sesión vigente de Supabase confirmó las columnas y firmas previas, RLS activo y migración nueva ausente. La credencial local de Management API fue rechazada con `HTTP 401: {"message":"Invalid access token"}`; no se utilizó para escribir ni se extrajeron credenciales del navegador.

La revisión del camino de publicación encontró una transacción anidada: el `COMMIT` del archivo podía confirmar el DDL antes de insertar el ledger. Se quitaron sólo BEGIN/COMMIT externos; el aplicador controla la transacción completa. Dos regresiones ejercitan el SQL real con fallo del ledger y con ensayo ROLLBACK; ambos revierten también el DDL. Se corrigió además la confirmación del mismo tipo de vendedor en un negocio legacy sin nombre: el RPC no dispara UPDATE OF si el valor no cambia, y conserva el guard para cambios reales.

Suite SQL final: 20 comprobaciones, exit 0. La reanudación durable por dato corresponde al onboarding común; en la conversión de cuentas ya completas, Volver conserva el borrador de esa visita y recargar antes de Activar recupera los datos anteriores.

Reversión de aplicación: restaurar el despliegue Vercel anterior si fallan los recorridos principales o crecen errores de los RPC nuevos. La migración conserva los RPC y datos previos y admite la aplicación anterior; no borrar perfiles ni hacer backfill para revertir la interfaz. Antes de publicar, verificar transacción/ledger, firmas y permisos en la base real. Los teléfonos físicos permanecen como aceptación posterior, sin declararla cumplida por un build.

## Evidencia literal del candidato corregido y Supabase

Consulta ejecutada desde SQL Editor en VICINO/main después del COMMIT. Sólo devuelve metadatos, permisos y hashes; no identificadores ni datos de cuentas.

```sql
WITH expected(name,hash) AS (VALUES ('generate_user_id','ddef0d2a6ca3fec998b622b1b6715cc3'),('username_validation_status','afd495ce7e974a12c69c109641a4608e'),('set_username','61fe4ba21a4fe31a913c8544d337d1ed'),('consultar_usuarios_onboarding','a233bd7dc41a9b1b9ab601c684a840ab'),('guardar_paso_onboarding_v2','bc0a26e6b790a74289e40e7a9e76163d'),('complete_user_onboarding','fbe2624d68ae7afd93abeee79aef15d5')) SELECT jsonb_build_object('migration_registered', EXISTS(SELECT 1 FROM supabase_migrations.schema_migrations WHERE version='20261010120000' AND name='onboarding_por_dato_y_usuario'), 'function_hashes_matched', (SELECT count(*) FROM expected e JOIN pg_proc p ON p.proname=e.name JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND md5(replace(p.prosrc,chr(13)||chr(10),chr(10)))=e.hash), 'authenticated_execute', has_function_privilege('authenticated','public.guardar_paso_onboarding_v2(text,text,text,text,text,text[],text,text,text,text,text,text)','EXECUTE') AND has_function_privilege('authenticated','public.consultar_usuarios_onboarding(text,text[])','EXECUTE') AND has_function_privilege('authenticated','public.set_username(text)','EXECUTE') AND has_function_privilege('authenticated','public.complete_user_onboarding()','EXECUTE'), 'anonymous_execute_blocked', NOT has_function_privilege('anon','public.guardar_paso_onboarding_v2(text,text,text,text,text,text[],text,text,text,text,text,text)','EXECUTE') AND NOT has_function_privilege('anon','public.consultar_usuarios_onboarding(text,text[])','EXECUTE') AND NOT has_function_privilege('anon','public.set_username(text)','EXECUTE') AND NOT has_function_privilege('anon','public.complete_user_onboarding()','EXECUTE'), 'helper_internal', NOT has_function_privilege('authenticated','public.username_validation_status(text)','EXECUTE') AND NOT has_function_privilege('anon','public.username_validation_status(text)','EXECUTE'), 'rls_enabled', (SELECT relrowsecurity FROM pg_class WHERE oid='public.profiles'::regclass), 'username_unique_index_valid',(SELECT indisvalid AND indisunique FROM pg_index WHERE indexrelid='public.profiles_username_lower_key'::regclass), 'legacy_rpc_present',to_regprocedure('public.guardar_paso_onboarding(text,text,text,text,text,text[])') IS NOT NULL, 'profile_steps_constraint', (SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conrelid='public.profiles'::regclass AND conname='profiles_onboarding_paso_check')) AS onboarding_release_verification;
```

Resultado literal de la celda `onboarding_release_verification`:

```json
{
  "rls_enabled": true,
  "helper_internal": true,
  "legacy_rpc_present": true,
  "migration_registered": true,
  "authenticated_execute": true,
  "function_hashes_matched": 6,
  "profile_steps_constraint": "CHECK (((onboarding_paso IS NULL) OR (onboarding_paso = ANY (ARRAY['perfil'::text, 'categoria'::text, 'tipo'::text, 'usuario'::text, 'nombre'::text, 'foto'::text, 'descripcion'::text, 'pagos'::text, 'intereses'::text, 'ubicacion'::text, 'activar'::text, 'notificaciones'::text, 'listo'::text]))))",
  "anonymous_execute_blocked": true,
  "username_unique_index_valid": true
}
```

Los ensayos anteriores devolvieron `onboarding_dry_run_passed` y `onboarding_authenticated_dry_run_passed`; ambos terminaban en ROLLBACK. La aplicación devolvió `onboarding_migration_applied` y terminó en COMMIT. Se comprobó el contenido completo del editor antes de Run. Los seis hashes se cotejaron dentro de la transacción antes de confirmarla. Fuentes de los ensayos y aplicación conservadas localmente en `apps/web/test-results/onboarding/`, ignoradas por Git.

```text
pnpm 9.15.0 install --frozen-lockfile
Lockfile is up to date, resolution step is skipped
Already up to date
Done in 4.2s
exit code: 0

pnpm 9.15.0 audit
No known vulnerabilities found
exit code: 0

node node_modules/typescript/bin/tsc --noEmit --project apps/web/tsconfig.json
sin salida; web types exit code: 0
node node_modules/typescript/bin/tsc --noEmit --project packages/shared/tsconfig.json
sin salida; shared types exit code: 0

node scripts/test-glob-consumers.mjs
RESULT 62/62 consumer comparisons passed; failures=0
exit code: 0

cd apps/web
node --import tsx --test lib/auth/require-admin-or-moderator.test.ts app/actions/legal.test.ts lib/profile-session-data.test.ts components/registro-service-worker.test.ts
ℹ tests 24
ℹ suites 0
ℹ pass 24
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 5437.392
exit code: 0

node --require ./apps/web/test-results/onboarding/native-test-prelude.cjs --import tsx scripts/test-frontend-sentry.ts
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8405.7349
exit code: 0
```

Para esta última prueba se preparó sólo el contexto sintético requerido por plataformaNativa(): `globalThis.window = { Capacitor: { getPlatform: () => "android" } };`. El transporte captura envelopes en memoria; no es un puente ni teléfono real. Invocar el script con el CLI de tsx sin ese contexto, o pasar --require al CLI que crea otro proceso, dio 2/5 y exit1: `AssertionError [ERR_ASSERTION]: 0 !== 1`, `TypeError: complete is not a function` y `AssertionError [ERR_ASSERTION]: 'failed' !== 'ready'`. Se corrigió la invocación usando --import tsx en el proceso que carga el contexto, sin modificar la aplicación o las expectativas. El intento anterior dentro del sandbox falló antes de ejecutar con `Error: spawn EPERM`, errno -4048, syscall spawn, TransformError en esbuild; la ejecución autorizada fuera de ese límite sí corrió.

```text
node scripts/test-onboarding-ui.mjs
{
  "scope": "simulated local component UI; not auth/RLS/native-device validation",
  "fontSource": "next-build-inter-outfit",
  "cases": 102,
  "passed": 102,
  "failed": 0,
  "failures": [],
  "out": "C:\\Users\\Hp User\\Documents\\Javier\\proyectos\\VICINO\\PROJECT-VICINO-ONBOARDING\\apps\\web\\test-results\\onboarding"
}
exit code: 0
```

Build final con settings sintéticos. Se muestran inicio y final; se omiten avisos repetidos de Sentry/PWA y las rutas intermedias:

```text
node apps/web/test-results/onboarding/build-local.cjs
OK: No TODO stubs detected.
Todas las rutas enlazadas existen. (76 rutas en el arbol)
▲ Next.js 16.3.8 (webpack)
✓ Compiled successfully in 117s
  Finished TypeScript in 30.1s ...
✓ Generating static pages using 3 workers (59/59) in 8.5s
[rutas intermedias truncadas]
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
exit code: 0
```

Lint ejecutado después del build (salida de avisos truncada; resumen final literal):

```text
cd apps/web; node node_modules/eslint/bin/eslint.js
✖ 148 problems (0 errors, 148 warnings)
exit code: 0
```

El primer lint coincidió con la generación del SW por el build y falló antes de acabar. Se repitió secuencialmente; mensaje completo del fallo:

```text
Oops! Something went wrong! :(

ESLint: 9.39.4

Error: ENOENT: no such file or directory, open 'C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-ONBOARDING\apps\web\public\sw.js'
    at async open (node:internal/fs/promises:640:25)
    at async Object.readFile (node:internal/fs/promises:1290:14)
    at async readAndVerifyFile (C:\Users\Hp User\Documents\Javier\proyectos\VICINO\PROJECT-VICINO-ONBOARDING\node_modules\.pnpm\eslint@9.39.4_jiti@2.6.1\node_modules\eslint\lib\eslint\eslint-helpers.js:1306:16)
exit code: 1
```

El informe de auditoría original quedó guardado en audit-before.json. Resultado literal del CI38114074852/job114395360528:

```text
13 vulnerabilities found
Severity: 1 low | 5 moderate | 3 high | 4 critical
##[error]Process completed with exit code 1.
```

El CI38114074868/job114395360506 generó el esquema y publicó el artefacto correctamente, pero Require committed types to match production terminó en `##[error]Process completed with exit code 1.`. Las diferencias eran la colocación de consultar_usuarios_onboarding y la función username_validation_status. Se incorporó el artefacto completo y se verificó SHA256 idéntico antes de repetir CI.

Incidencias de lectura corregidas: se intentó leer `.github/workflows/ci.yml` (`Cannot find path ... because it does not exist.`); se listaron los workflows existentes database-types.yml/security.yml. Un rg con patrones docs/*.md y scripts/test-onboarding* en Windows devolvió `El nombre de archivo, el nombre de directorio o la sintaxis de la etiqueta del volumen no son correctos. (os error 123)`; se sustituyó por búsqueda en directorios con -g. No ocasionaron cambios en código.
