# Contraseña del panel y cierre del RPC de roles

Javier autorizó terminar ADM-PASS-01/02 y confirmar la contraseña. Base de código publicada e5522f0; rama aislada fix/admin-role-security-20261011. El checkout principal y sus cambios ajenos se conservan. No se escribe ninguna contraseña en código, SQL, pruebas ni documentos.

## Cambio

Las Server Actions siguen autenticando con getUser y comprobando rol admin, clave de seguridad, límites y Zod. Sólo después crean el cliente service_role y llaman a admin_set_user_role_secure con el actor derivado del usuario verificado. El RPC nuevo vuelve a comprobar el rol actual, bloquea perfiles en orden estable, conserva idempotencia y no permite auto-retirar admin.

La migración20261011213000 conserva la firma histórica pero revoca su EXECUTE a PUBLIC/anon/authenticated. El RPC nuevo sólo permite service_role y verifica ese claim dentro del cuerpo. También elimina escrituras directas de user_roles de tabla y columna para clientes; no altera lecturas ni roles de cuentas. Se actualiza la explicación de la excepción del auditor.

## Configuración y contraseña

La clave vive exclusivamente en ADMIN_SECURITY_PASSWORD del entorno de Production. Sin ella las acciones rechazan el cambio. Vercel exige iniciar sesión y no existe token local de CLI/proceso: acceso solicitado a Javier mientras se completa el código. No está confirmada la presencia ni el valor vigente; una propuesta histórica en Notion no acredita la contraseña instalada. Si debe cambiarse mediante navegador, la introducción/confirmación de una nueva credencial corresponde al usuario según la política de control del navegador.

## Validación

28/28 pruebas aisladas, PostgreSQL WASM y acciones reales empaquetadas. Sin red, cuentas ni claves reales: claves de prueba aleatorias en memoria. Cubre EXECUTE viejo/nuevo, DML de tabla/columna, actor no-admin/ausente/revocado, service_role, idempotencia, auto-retiro, re-aplicación; sesión/rol/clave ausente/vacía/incorrecta/validación antes de crear cliente privilegiado, límites, actor ligado a getUser y errores del RPC sin falso éxito.

```text
node node_modules/tsx/dist/cli.mjs scripts/test-admin-role-security.ts
PASS anon no puede invocar RPC nuevo ni histórico
PASS anon no conserva escritura de tabla ni de columna
PASS authenticated no puede invocar RPC nuevo ni histórico
PASS authenticated no conserva escritura de tabla ni de columna
PASS service_role con actor no admin no concede roles
PASS service_role sin actor rechaza entrada
PASS canal correcto concede de forma idempotente
PASS auto-retiro bloqueado, otro retiro permitido
PASS actor revocado tras la lectura web no puede escribir
PASS claims no-service bloqueados incluso con permiso de dueño
PASS migración reaplicable conserva contrato
PASS assignRole: sesión y admin antes de cliente privilegiado
PASS assignRole: sesión y admin antes de cliente privilegiado
PASS assignRole: clave unconfigured no llega al RPC
PASS assignRole: clave empty no llega al RPC
PASS assignRole: clave wrong no llega al RPC
PASS assignRole: datos inválidos no llegan al RPC
PASS assignRole: canal correcto liga actor verificado y decisión
PASS assignRole: fallo SQL no informa éxito
PASS removeRole: sesión y admin antes de cliente privilegiado
PASS removeRole: sesión y admin antes de cliente privilegiado
PASS removeRole: clave unconfigured no llega al RPC
PASS removeRole: clave empty no llega al RPC
PASS removeRole: clave wrong no llega al RPC
PASS removeRole: datos inválidos no llegan al RPC
PASS removeRole: canal correcto liga actor verificado y decisión
PASS removeRole: fallo SQL no informa éxito
PASS clave correcta sigue respetando límite
PASS 28/28 seguridad de roles: SQL y acciones reales aisladas. Sin red ni claves reales.
Exit code: 0

node apps/web/node_modules/typescript/bin/tsc --noEmit -p apps/web/tsconfig.json
(sin salida)
Exit code: 0

node node_modules/eslint/bin/eslint.js app/admin/users/actions.ts
(cwd apps/web, sin salida)
Exit code: 0
```

Build con bootstrap Node/Next, entorno sólo en memoria, sin copiar archivos de secretos. Extracto final (ruta completa de las60 páginas omitida después de Collecting build traces):

```text
✓ Compiled successfully in 50s
  Finished TypeScript in 29.5s ...
  Collecting page data using 3 workers ...
  Generating static pages using 3 workers (0/60) ...
  Generating static pages using 3 workers (15/60)
  Generating static pages using 3 workers (30/60)
  Generating static pages using 3 workers (45/60)
✓ Generating static pages using 3 workers (60/60) in 8.5s
  Finalizing page optimization ...
  Collecting build traces ...
Exit code: 0
```

Primer test falló por spawn EPERM del sandbox; ejecutar esbuild fuera del sandbox resolvió el permiso. Luego el arnés falló con Top-level await is currently not supported with the cjs output format; se encerró la ejecución en main async. No se cambió el contrato ni las aserciones de seguridad.

## Producción: preflight y ensayo

Preflight de sólo lectura en VICINO/main, sin invocar cambios de rol. Confirma el camino directo real del RPC histórico y que no hay una migración previa candidata:

```text
legacy_authenticated_execute true
legacy_anon_execute false
direct_authenticated_write false
new_rpc_present false
candidate_ledger 0
legacy_body_md5 54f9721a73c898dd0b7d7588e98e3dcc
```

Fuente candidata:3120bytes, SHA256 cd8e46648cbd0c470793f7f52862d0307ed694a1de47ef3ac4770dca4594a500. Ensayo remoto con BEGIN, límites, guard de ledger/hash legacy, archivo exacto, assertions ACL/DML/search_path y ROLLBACK. Round-trip del editor coincide. No INSERT de ledger ni perfiles/roles de prueba. Resultado literal:

```text
rehearsal PASS
candidate_after_rollback 0
new_rpc_after_rollback false
```

## Publicación y recuperación

Pendiente de aplicar archivo+ledger en transacción y publicar web/tipos exactos en el mismo corte después de validar preview/CI. La app anterior usa el RPC revocado: durante el corte las escrituras de roles quedan bloqueadas hasta que sirva la web nueva, conservando lectura y datos. No reabrir EXECUTE de clientes como recuperación; corregir hacia adelante el canal validado del servidor. Una vuelta de web sola a e5522f0 no recupera cambios de roles después de esta migración.

Los SHA, CI, ACL final y despliegue se registrarán al comprobarse. La configuración de la clave y la prueba con cuenta admin real permanecen abiertas mientras falte el acceso a Vercel; las pruebas locales no las sustituyen. No se concedieron o retiraron roles reales.
