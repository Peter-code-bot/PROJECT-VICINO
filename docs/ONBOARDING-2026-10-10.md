# Onboarding por dato — entrega local

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

## Aplicación pendiente

La migración `20261010120000_onboarding_por_dato_y_usuario.sql` está preparada y probada en PostgreSQL WASM, sin aplicar a remoto. Añade RPC v2, consulta de disponibilidad y política compartida; amplía los pasos permitidos; finaliza bandera y marcador juntos; el generador automático evita un código ya usado como username. Mantiene el RPC anterior y los perfiles existentes, incluida la reanudación de negocios legacy sin nombre.

Para una entrega desplegada, aplicar primero esta migración y verificar permisos/RPC sobre la base de prueba; después desplegar la aplicación compatible. Quedan por verificar la concurrencia real entre sesiones, los recorridos autenticados con cuentas de prueba y teclado, mapa, subida de foto y permiso push en Android/iPhone físicos. En este corte no hay push de rama, PR, despliegue ni nueva versión nativa.

## Publicación autorizada — revisión previa

Javier autoriza push a master tras comprobar requisitos y seguridad. La consulta real del esquema desde la sesión vigente de Supabase confirmó las columnas y firmas previas, RLS activo y migración nueva ausente. La credencial local de Management API fue rechazada con `HTTP 401: {"message":"Invalid access token"}`; no se utilizó para escribir ni se extrajeron credenciales del navegador.

La revisión del camino de publicación encontró una transacción anidada: el `COMMIT` del archivo podía confirmar el DDL antes de insertar el ledger. Se quitaron sólo BEGIN/COMMIT externos; el aplicador controla la transacción completa. Dos regresiones ejercitan el SQL real con fallo del ledger y con ensayo ROLLBACK; ambos revierten también el DDL. Se corrigió además la confirmación del mismo tipo de vendedor en un negocio legacy sin nombre: el RPC no dispara UPDATE OF si el valor no cambia, y conserva el guard para cambios reales.

Suite SQL final: 20 comprobaciones, exit 0. La reanudación durable por dato corresponde al onboarding común; en la conversión de cuentas ya completas, Volver conserva el borrador de esa visita y recargar antes de Activar recupera los datos anteriores.

Reversión de aplicación: restaurar el despliegue Vercel anterior si fallan los recorridos principales o crecen errores de los RPC nuevos. La migración conserva los RPC y datos previos y admite la aplicación anterior; no borrar perfiles ni hacer backfill para revertir la interfaz. Antes de publicar, verificar transacción/ledger, firmas y permisos en la base real. Los teléfonos físicos permanecen como aceptación posterior, sin declararla cumplida por un build.
