# Plan RED-configuracion

**Pendiente:** Configuración: rediseño del frontend

**Fuentes en Notion:** D l.817 (S02B-rediseno-onboarding-configuracion, Configuración); F l.1619-1621 (T5-configuracion-rediseno); G l.1758-1761 (G-configuracion-rediseno); H l.31 (H31-configuracion-frontend)

**Estado conciliado (26-sep ~23:30):** pendiente. Sin cambios de diseño en configuracion/page.tsx. Solo se menciona en S02, paso 4, sin bocetos ni pasos.

**Qué falta:** Plan mínimo a proponer a Javier: inventario de secciones y preferencias que se conservan (incluida 20260916180000), bocetos para móvil y escritorio, estados de carga, error y guardado, y una prueba de persistencia al reabrir. El inventario y la prueba los puede preparar Claude; el diseño es de Javier. Ojo: los interruptores de push no surten efecto hasta PT07-send-push-deploy.

## Objetivo

Coordinar el rediseño de Configuración (/configuracion y /configuracion/notificaciones) sin perder funcionalidad. El diseño es de Javier. Claude prepara el inventario de lo que se conserva, una prueba de línea base en staging (con prueba de persistencia al reabrir) y el paquete de estados para los bocetos. La implementación visual empieza solo cuando Javier apruebe el boceto.

## Pasos

1. 1. Inventario (Claude, solo lectura, unos 30 min). Hacer una tabla de lo que se conserva: (a) /configuracion, page.tsx de 71 líneas, enlaza a Notificaciones, a /perfil/editar y a /privacidad. Cerrar sesión (logout-section.tsx) pide confirmación en 2 pasos con useLogout. Eliminar cuenta (delete-account-section.tsx) exige escribir ELIMINAR, hace POST /api/account/delete hacia la edge function delete-account y termina en /cuenta-eliminada. (b) /configuracion/notificaciones tiene 4 interruptores del catálogo lib/notificaciones/claves.ts (chat, ventas, comunidades, novedades). Una clave ausente cuenta como encendida. El guardado es optimista por clave, con generaciones y un toast de Reintentar. Hay 5 estados de permiso del sistema (sin-pedir, concedido, denegado, no-nativo, error). Si falla la lectura sale una tarjeta de error sin redirección. Se conservan los textos soloCampana y el atributo data-preferencias-listas. (c) Datos: profiles.notification_preferences (migración 20260916180000, GRANT SELECT por columna) y escritura por la RPC guardar_preferencias_notificaciones (código P0002). (d) Entradas: sidebar.tsx:200, seller-sidebar.tsx:47, admin-sidebar.tsx:54, account-menu-drawer.tsx:105 y /settings, que redirige. (e) Ajustes que hoy están fuera de la página: Modo oscuro en account-menu-drawer.tsx, ubicación (cookie vicino_location más change-location-sheet.tsx), /seller/verificacion y Soporte. (f) Contrato externo: la página pública /eliminar-cuenta (Play Data Safety) dice 'pestaña Configuración, sección Eliminar cuenta, botón rojo, ELIMINAR'.
2. 2. Prueba unitaria (Claude, unos 15 min): scripts/test-configuracion-catalogo.ts, que se corre con apps/web/node_modules/.bin/jiti (o con tsx, como el resto de scripts/test-*.ts). Comprueba que CLAVES_NOTIFICACION tenga exactamente 4 claves. Comprueba que esClaveNotificacion rechace un número, null, 'ventass' y una cadena de 1 MB. Comprueba que preferencias-form.tsx declare un TIPO por cada clave, leyendo el archivo como texto.
3. 3. Línea base E2E (Claude, 1 a 1.5 h): scripts/staging/e2e-configuracion.mjs, con la web local en :3100 contra staging (dev-contra-staging.mjs). Usa fixtures sintéticos @staging.vicino.test (crearUsuario más completarOnboarding) y retira todo con limpiar(). Se corre a 390x844 y a 1280x800. Casos: invitado a /configuracion termina en /login?next=/configuracion; /settings lleva a /configuracion; están los 5 destinos. Interruptor 'novedades': tocarlo, esperar data-preferencias-listas, recargar, cerrar el contexto y abrir uno nuevo con login otra vez (reabrir la app). Debe seguir cambiado y coincidir con el valor en SQL. Cerrar sesión: confirmar y luego cancelar. Eliminar: el botón está deshabilitado hasta escribir ELIMINAR y después se pulsa Cancelar; nunca se ejecuta. Los selectores van por rol y aria (no por clases) para que la prueba sobreviva al rediseño. Las capturas se guardan en .staging/e2e/. Tiene que pasar hoy, antes de cualquier cambio.
4. 4. Paquete para Javier (Claude, unos 20 min). Incluye el inventario del paso 1 y las capturas actuales en móvil y escritorio. Lista los estados que el boceto debe cubrir: carga de las dos rutas (el loading.tsx actual usa SkeletonFormulario con avatar y 6 campos, que no se parece a la lista), error de lectura, 'guardando' por interruptor, fallo con Reintentar, los 4 avisos de permiso, las confirmaciones de cerrar sesión y de eliminar, 'eliminando' y el error de eliminar. Restricciones: conservar role=switch, aria-checked y data-preferencias-listas; área táctil de 44 px o más; no cambiar los textos honestos sobre push sin revisarlos. Si una confirmación pasa a hoja o modal, lleva data-modal-open="true" (como fundar-drawer.tsx:142). Preguntas para Javier: si Notificaciones se queda como subpágina o se fusiona; si se mueven a Configuración el Modo oscuro, la ubicación y Soporte; qué botón de regreso usar (components/ui/boton-regresar.tsx de BB03 o el ChevronLeft actual); dónde va el punto de estudiante (S09).
5. 5. Javier entrega los bocetos (móvil 390 y escritorio 1280, en claro y oscuro, con todos los estados del paso 4) dentro de BB00–BB06 y las familias de botones, y aprueba el alcance. Si el boceto necesita un dato nuevo (por ejemplo, otra preferencia), lleva una migración con su GRANT por columna en la misma migración, y la aplica Pedro con autorización explícita.
6. 6. Implementación, solo con el boceto aprobado, en la rama feat/configuracion-rediseno, por quien designe Javier. Claude solo la hace si Javier lo pide. Archivos: configuracion/page.tsx, logout-section.tsx, delete-account-section.tsx, loading.tsx y notificaciones/page.tsx. En notificaciones/preferencias-form.tsx se cambia solo el JSX y las clases; no se tocan aplicar(), generaciones, avisos ni AvisoDePermiso. También notificaciones/loading.tsx y, opcionalmente, un esqueleto nuevo en components/shared/loading-skeletons.tsx. No se tocan actions.ts, claves.ts ni la migración. Si Eliminar cambia de sección o de nombre, se actualiza eliminar-cuenta/page.tsx en el mismo commit.
7. 7. Verificación: tsc 0, lint 0 y build. Correr test-configuracion-catalogo.ts y e2e-configuracion.mjs; deben quedar verdes igual que en la línea base. Si cambian selectores, ajustar apps/web/tests/notificaciones.spec.ts. Revisión visual a 375x812 y 1280x800 (regla de apps/web/CLAUDE.md), en claro y oscuro. En iPhone y Android: safe areas, el permiso de push y que la confirmación no quede bajo el cromo nativo.
8. 8. Publicación: preview de Vercel y, con autorización de Pedro, deploy a producción. Después, smoke de solo lectura en prod: /configuracion como invitado redirige a /login?next=/configuracion, /eliminar-cuenta da 200 y el texto coincide con la sección real. Registrar el resultado en la ficha S02-B de Notion y en docs/PENDIENTES-2026-09-26.md.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/configuracion/page.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/configuracion/logout-section.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/configuracion/delete-account-section.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/configuracion/loading.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/configuracion/notificaciones/page.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/configuracion/notificaciones/preferencias-form.tsx (solo capa visual)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/configuracion/notificaciones/loading.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/shared/loading-skeletons.tsx (opcional, esqueleto propio)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/eliminar-cuenta/page.tsx (solo si cambia la sección de Eliminar)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/tests/notificaciones.spec.ts (solo si cambian selectores)
- C:/Users/pedro/Projects/startup-marketplace/scripts/test-configuracion-catalogo.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-configuracion.mjs (nuevo)
- Solo lectura / no tocar: apps/web/app/(marketplace)/configuracion/notificaciones/actions.ts, apps/web/lib/notificaciones/claves.ts, supabase/migrations/20260916180000_preferencias_de_notificaciones.sql, apps/web/components/profile/account-menu-drawer.tsx, apps/web/components/layout/sidebar.tsx, apps/web/components/ui/boton-regresar.tsx

## Pruebas

- Unitaria (jiti o tsx): scripts/test-configuracion-catalogo.ts, para el catálogo de claves, la validación de esClaveNotificacion y un TIPO por clave en preferencias-form.tsx.
- E2E en staging: scripts/staging/e2e-configuracion.mjs a 390x844 y 1280x800 con fixtures sintéticos. Cubre la redirección del invitado, /settings, los 5 destinos, la persistencia del interruptor tras recargar y tras reabrir en un contexto nuevo (cotejada por SQL), cerrar sesión con confirmación y cancelación, y eliminar solo hasta la puerta de ELIMINAR. Termina con 0 fixtures restantes.
- Regresión: e2e-configuracion.mjs verde antes del rediseño (línea base) y otra vez después; notificaciones.spec.ts ajustado si cambian los selectores.
- Estática: tsc 0, lint 0 errores y pnpm --filter web build con todas las páginas generadas.
- Visual: capturas a 375x812 y 1280x800, en claro y oscuro, comparadas con el boceto aprobado de Javier.
- Smoke de solo lectura en prod tras el deploy autorizado: /configuracion como invitado redirige a /login?next=/configuracion, /settings lleva a /configuracion y /eliminar-cuenta da 200 con instrucciones que coinciden con la UI.
- Dispositivo (iPhone y Android): safe areas, aviso de permiso push y confirmaciones visibles sobre el cromo nativo.

## Riesgos

- Contrato de Play Data Safety: /eliminar-cuenta promete 'pestaña Configuración, sección Eliminar cuenta, botón rojo, ELIMINAR'. Si el rediseño mueve o renombra Eliminar, o cambia la palabra de confirmación, esa página queda falsa.
- preferencias-form.tsx (418 líneas) mezcla la capa visual con la lógica de guardado (generaciones, avisos, revertir una sola clave). Rediseñarlo a mano puede reabrir la divergencia entre la pantalla y la base que ya se corrigió. Se cambia solo el JSX.
- Hidratación: si se pierde data-preferencias-listas, un toque anterior a la hidratación se pierde en silencio y las pruebas dan falsos verdes.
- No añadir una redirección 'por seguridad' en la tarjeta de error: esa fue la causa del bucle del onboarding.
- Una preferencia nueva sin GRANT por columna devuelve 42501 y tumba toda la lectura de profiles.
- No cambiar revalidatePath por el envoltorio revalidate-session: purgaría toda la memoria del cliente en cada toque.
- Texto hoy falso en producción: el párrafo 'si los apagas, el teléfono se queda callado' no se cumple mientras send-push siga en la v20. El rediseño no debe añadir promesas nuevas; conviene avisar a Pedro.
- La delete-account desplegada es la del 16-jul y staging no tiene edge functions: la eliminación real no se prueba, solo su puerta de confirmación.
- notificaciones.spec.ts entra con VICINO_TEST_EMAIL (cuenta del seed). La prueba nueva usa solo fixtures sintéticos de staging.
- Si las confirmaciones pasan a hoja o modal sin data-modal-open, el cromo nativo de iOS las tapa (mismo fallo que Solicitudes).

## Requiere antes

- Javier: bocetos aprobados (móvil y escritorio, claro y oscuro, todos los estados) y decisión de alcance: qué ajustes entran (Modo oscuro, ubicación, Soporte, estudiante) y si Notificaciones sigue siendo subpágina.
- Staging operativo (.staging/staging.json con token) y la web local en :3100 contra staging mediante scripts/staging/dev-contra-staging.mjs.
- Pedro: autorización explícita para el deploy a producción y para cualquier migración nueva (con su GRANT por columna).
- PT07: que Pedro despliegue send-push para que los interruptores tengan efecto en el teléfono. No bloquea el rediseño, pero sin eso la prueba solo demuestra que la preferencia se guarda, no que el teléfono deje de sonar.
- Un iPhone y un Android físicos para revisar safe areas, el permiso de push y el cromo nativo.

**Responsable:** Javier (diseño y aprobación). Claude prepara el inventario y las pruebas (pasos 1 a 4 y 7). Pedro autoriza cualquier migración o deploy a producción.

**Estimación:** Preparación de Claude: 1.5 a 2 h (inventario 0.5 h, unitaria 0.25 h, E2E de línea base 1 a 1.5 h, paquete 0.25 h). Bocetos de Javier: 1 a 3 h. Implementación tras la aprobación: 1 a 3 h (referencia de Notion, Grupo C). Verificación y publicación: alrededor de 1 h. Total: 4.5 a 9 h repartidas en varios días; hoy no se cierra porque el calendario depende de Javier.

**Ejecutable por Claude ahora:** no
