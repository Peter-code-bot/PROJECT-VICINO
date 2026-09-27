# Plan DISP-header-capsula

**Pendiente:** BUG-HDR en iPhone: cápsula nativa, banners, safe areas y web servida por Capacitor

**Fuentes en Notion:** A l.19,33,35 (BUG-HDR-iphone); C l.433 (PT08-web-servida-capacitor)

**Estado conciliado (26-sep ~23:30):** pendiente. El arreglo web 209caf7 está en prod. capacitor.config.ts apunta server.url a https://vicinomarket.com, así que la 1.1 (6) lo recibe sin recompilar.

**Qué falta:** Checklist en iPhone con la 1.1 (6): Home con scroll largo; ficha con banner de pausado o vendido; /solicitudes/[id]. La cápsula CromoNativo debe quedar alineada tras el scroll, sin chocar con el notch ni la Dynamic Island, también al volver de segundo plano. Comprobar que los controles web ocultos que pulsa CromoNativo funcionan con la web actual. Capturas en D01. Fecha: 29-sep.

## Objetivo

Cerrar BUG-HDR en iPhone. En la 1.1 (6), que carga https://vicinomarket.com con 209caf7, hay que comprobar que la cápsula nativa (Rankings, campana, menú), los flotantes de la ficha, los banners de pausado o agotado y la barra de /solicitudes/[id] quedan alineados tras el scroll y al volver de segundo plano, sin chocar con el notch ni con la Dynamic Island. También, que los controles web ocultos que pulsa CromoNativo siguen funcionando. La evidencia queda en D01/A04 con fecha 29-sep. No se toca la apariencia.

## Pasos

1. 1. Claude, solo lectura, la mañana del 29-sep: correr E2E_BASE=https://vicinomarket.com node scripts/staging/e2e-header-fijo.mjs, que debe dar 3/3. Comprobar también que el HTML de / trae 'md:hidden sticky top-0 z-40' (app/(marketplace)/layout.tsx:172). Anotar el SHA de master servido.
2. 2. Claude: crear scripts/staging/e2e-cromo-contrato.mjs con Playwright WebKit a 390x844, como visitante y en solo lectura. Extrae el puenteJS de apps/web/ios/App/App/CromoNativo.swift (bloque #"""…"""#, l.775-977), simula window.webkit.messageHandlers.vicinoCromo.postMessage y guarda cada estado reportado.
3. 3. El script de contrato comprueba lo siguiente. En Home: la cabecera reporta Rankings y Notificaciones con las etiquetas de components/layout/header.tsx, y las pestañas llegan con ids nav-* (bottom-nav.tsx l.90/121/163). Tras bajar 1200 px, la 'y' reportada coincide con getBoundingClientRect del botón web. En la ficha: aparecen los flotantes regreso, favorito y 'Mas opciones' dentro de [data-cromo-galeria] (gallery-top-bar.tsx l.96-126), con su 'y' estable tras bajar 700 px. Además, __vicinoCromo.cabecera(i) lleva a /rankings y a /notificaciones, __vicinoCromo.pulsar('nav-…') navega, y un diálogo abierto hace que modal sea true.
4. 4. Claude, sin tocar prod: repetir el contrato con sesión contra staging (node scripts/staging/dev-contra-staging.mjs en localhost:3100, que el puente acepta). Usar fixtures sintéticos de fixtures.mjs: vendedor @staging.vicino.test con un producto pausado y otro agotado (crearProducto con estatus) y una solicitud [FIXTURE] creada por SQL, porque fixtures.mjs no tiene helper de solicitudes. Validar el Menú de cuenta (h2 'Mi cuenta', a[href="/perfil"], interruptor de tema), que el banner queda debajo del header y que la barra de /solicitudes/[id] no queda tapada. Limpiar con limpiar().
5. 5. Pedro/Javier deciden qué cuenta se usa en el iPhone (ver requiere_antes). Javier confirma en TestFlight que tiene instalada la 1.1 (6): commit f61dbb3, CromoNativo de b72724f.
6. 6. Javier, iPhone con Dynamic Island, grabando pantalla. Home: arranque en frío, scroll de 3 o más pantallas y vuelta arriba; hacer pull-to-refresh en el tope. En todo momento la cápsula debe quedar sobre los botones del header, debajo de la isla, sin duplicarse ni desaparecer.
7. 7. Javier, ficha disponible: bajar y subir. Header, cápsula y los tres flotantes (regreso, y favorito con opciones) deben quedar fijos y sin solaparse. Tocar cada uno: regreso vuelve, favorito marca o abre el muro, opciones abre el menú.
8. 8. Javier, ficha pausada y ficha agotada propias, con la cuenta acordada: el banner queda justo debajo del header tras el scroll, sin que lo tapen la cápsula ni los flotantes.
9. 9. Javier, /solicitudes/[id] con sesión: la barra con el botón Volver y el título queda debajo del header, y la cápsula no tapa el botón Volver.
10. 10. Javier, segundo plano: en Home a media página y en la ficha, ir al inicio del iPhone 30 s y volver; bloquear y desbloquear; abrir otra app pesada 5 min o más (fuerza la recarga del WebContent). En los tres casos la cápsula debe quedar alineada.
11. 11. Javier, controles: campana → /notificaciones; trofeo → /rankings; menú → hoja nativa 'Mi cuenta', donde un enlace navega, el tema cambia y se cierra bien. Tocar cada pestaña de la barra inferior y comprobar que la burbuja marca la activa. Abrir un modal que cumpla el contrato (fundar comunidad): la cápsula y la barra deben ocultarse. Repetir Home y ficha en modo oscuro.
12. 12. Javier: repetir los pasos 6, 7 y 10 en un iPhone con notch (X a 14). Si no hay uno físico, usar el Simulator y dejarlo anotado como simulación, no como dispositivo.
13. 13. Registro: en D01/A04 van build 1.1 (6), SHA web servido, modelo y versión de iOS, resultado de cada paso y capturas. Después, marcar docs/PENDIENTES-2026-09-26.md l.179 y el bloque BUG-HDR en Notion.
14. 14. Si algo falla, clasificarlo. Si es de la web (sticky, offsets, banners), Claude lo corrige conservando la apariencia y lo valida con los dos e2e; el deploy necesita la autorización de Pedro. Si es de re-medición nativa, hay dos caminos. Paliativo sin recompilar: disparar 'resize' al volver a primer plano desde components/capacitor-init.tsx, porque el puente escucha resize. Arreglo de fondo: añadir visibilitychange/scroll → programar en el puenteJS de CromoNativo.swift; eso requiere una build 1.1 (7) en la Mac de Javier.

## Archivos

- apps/web/ios/App/App/CromoNativo.swift (puenteJS l.775-977; aplicarCabecera l.313-359; oyentes l.928-937; solo se toca si el fallo es nativo)
- apps/web/app/(marketplace)/layout.tsx (l.172, envoltorio sticky; solo lectura)
- apps/web/components/layout/header.tsx (aria-labels del contrato y pt-[env(safe-area-inset-top)]; solo lectura)
- apps/web/components/product/product-detail-mobile.tsx (l.61, banners sticky bajo el header)
- apps/web/app/(marketplace)/solicitudes/[id]/page.tsx (l.155, barra sticky)
- apps/web/components/product/gallery-top-bar.tsx (l.93-126, data-cromo-galeria)
- apps/web/components/layout/bottom-nav.tsx (l.90/121/163, contrato nav-*)
- apps/web/components/profile/account-menu-drawer.tsx (l.54-67, contrato del menú)
- apps/web/components/capacitor-init.tsx (solo como paliativo: resize al volver a primer plano)
- apps/web/capacitor.config.ts (server.url, StatusBar overlaysWebView:false; solo lectura)
- scripts/staging/e2e-header-fijo.mjs (existente)
- scripts/staging/e2e-cromo-contrato.mjs (nuevo)
- scripts/staging/fixtures.mjs (crearProducto con estatus; falta un helper de solicitudes)
- docs/PENDIENTES-2026-09-26.md (l.179)

## Pruebas

- Smoke de solo lectura en prod: E2E_BASE=https://vicinomarket.com node scripts/staging/e2e-header-fijo.mjs debe dar 3/3.
- Nuevo scripts/staging/e2e-cromo-contrato.mjs (Playwright WebKit, visitante, prod, solo lectura). Criterio: todos los pasos OK. Incluye que la 'y' reportada de la cabecera y los flotantes sea igual a la medición en vivo tras el scroll, y que cabecera(i), pulsar('nav-*') y el menú naveguen.
- El mismo contrato con sesión contra staging (dev-contra-staging.mjs, localhost:3100) con fixtures sintéticos @staging.vicino.test: pausado y agotado del dueño, /solicitudes/[id], Menú de cuenta. Sin datos restantes tras limpiar().
- Checklist en el iPhone (pasos 6 a 12). Cada paso pasa si la cápsula queda centrada sobre los botones web del header, a menos de 2 pt aprox. a la vista; si no invade la zona de la Dynamic Island o el notch; si el banner y la barra no quedan tapados; si no hay controles duplicados ni desaparecidos tras el scroll y al volver de segundo plano; y si cada toque llega a su destino. La evidencia es grabación más capturas en D01.

## Riesgos

- La 1.1 (6) es una build Release sin Safari Web Inspector: webContentsDebuggingEnabled en capacitor.config.ts solo aplica a Android. La evidencia es solo visual; para medir hace falta una build Debug desde Xcode con el mismo SHA, marcada como tal.
- El puente solo vuelve a medir la cabecera con mutaciones del DOM, resize o popstate. El scroll solo mueve la fila de la galería, y no hay listener de visibilitychange ni de foreground (CromoNativo.swift l.928-937). Por eso el rebote del pull-to-refresh o volver de segundo plano pueden dejar la cápsula desalineada, y el arreglo de fondo exige recompilar.
- Si la web cambia un aria-label o un id del contrato (header, nav-*, data-cromo-galeria, 'Mas opciones', h2 'Mi cuenta'), lo nativo desaparece en silencio. El contrato debe correrse antes de cada deploy que toque esos componentes.
- P0 aparte, reportado por Javier: el drawer '+' de /solicitudes (components/solicitudes/create-request-drawer.tsx l.210) sigue sin data-modal-open ni aria-modal, así que la cápsula y la barra nativas lo tapan. Va a aparecer al probar /solicitudes; se registra aparte y no cuenta como fallo de BUG-HDR.
- Pausar un listado real lo oculta a compradores mientras dura la prueba: hay que reactivarlo y anotarlo.
- Si llegan pushes a master antes del 29-sep, cambia la web servida. Hay que anotar el SHA real en D01; que GitHub esté actualizado no prueba que producción lo esté.

## Requiere antes

- Un iPhone con Dynamic Island (14 Pro o posterior) y, si se puede, otro con notch, los dos con la 1.1 (6) de TestFlight.
- Decisión de Pedro/Javier sobre la cuenta en prod. La RLS block_aware_products_select solo deja ver una ficha pausada o agotada a su dueño; un visitante recibe 404. Opciones: pausar temporalmente un listado propio de Javier y reactivarlo al terminar, o usar una cuenta QA dedicada que autorice Pedro. Nunca cuentas de terceros ni el seed excluido.
- Una solicitud abierta visible con sesión en prod, porque el visitante no ve solicitudes.
- Prod sirviendo 209caf7 o un sucesor el día de la prueba (paso 1).
- Claves de staging en .staging/staging.json para el paso 4.

**Responsable:** Javier (dispositivo, pasos 5-13); Claude (pre-verificación y contrato, pasos 1-4, y corrección web si falla); Pedro (decisión de cuenta y autorización de deploy)

**Estimación:** Claude: 2 h (smoke, script de contrato y pasada en staging). Javier: 1.5-2 h en dos iPhone, con grabación, más 30 min de registro en D01/A04. Si falla la web: +2-4 h más deploy autorizado. Si falla lo nativo: +1 día (cambio en CromoNativo, build 1.1 (7) y procesado en TestFlight). Fecha objetivo: 29-sep.

**Ejecutable por Claude ahora:** no
