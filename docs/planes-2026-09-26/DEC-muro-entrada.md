# Plan DEC-muro-entrada

**Pendiente:** Muro de entrada: exigir cuenta al abrir la app o solo pedir ubicación al visitante

**Fuentes en Notion:** D l.652 (R08-muro-acceso-onboarding), l.817-818,829-834 (S02B-muro-acceso-rutas); F l.1524-1533 (S02B-muro-entrada); G l.1728-1731 (G-muro-entrada); H l.24 (H24-muro-entrada-onboarding)

**Estado conciliado (26-sep ~23:30):** decision. middleware.ts:82-133 solo protege rutas privadas; (marketplace)/layout.tsx:128 manda a /bienvenida solo a usuarios autenticados. muro-sesion.tsx:15-25 aplica la regla del 26-ago: sin sesión se puede mirar. Exigir cuenta solo para mirar un marketplace arriesga la guía 5.1.1(v) de App Store.

**Qué falta:** Decidir: (a) muro duro al abrir, solo en la app o también en web, o (b) paso de ubicación obligatorio para visitantes que escriba la cookie vicino_location, manteniendo el muro de interacción. Después Claude implementa la tabla estado → ruta (rutas exentas, next seguro, salida con GPS denegado) con las pantallas actuales y la prueba en staging.

## Objetivo

Que ningún visitante llegue al feed sin zona. Hay dos caminos: (a) exigir cuenta al abrir, solo en la app o también en web; o (b) un paso de ubicación obligatorio para visitantes que escriba la cookie vicino_location y conserve la regla del 26-ago ("sin sesión se puede mirar"). Primero se decide; después Claude implementa la tabla estado → ruta con las pantallas actuales y la prueba en staging, sin cambiar la apariencia.

## Pasos

1. 1. Decisión de Pedro y Javier (30 min) con esta evidencia. Hoy apps/web/lib/supabase/middleware.ts:82-133 solo protege rutas privadas. (marketplace)/layout.tsx:128 manda a /bienvenida solo a quien tiene sesión. muro-sesion.tsx:15-25 aplica la regla 'sin sesión se mira'. Recomendación de Claude: la opción (b). La (a) arriesga la guía 5.1.1(v) de App Store y además no garantiza la ubicación: la cookie es por dispositivo, y quien ya hizo el onboarding y entra desde otro teléfono nunca vuelve a /completar-perfil, porque has_seen_onboarding ya está en true.
2. 2. Escribir la tabla estado → ruta en el bloque S02-B de docs/PENDIENTES-2026-09-26.md y en la jornada de Notion. Rutas con muro: /, /buscar y /rankings (las tres leen la cookie en home-session-data.ts:70, buscar/page.tsx:65 y rankings/page.tsx:82). Un visitante sin cookie válida va a /elegir-zona?next=<ruta+query>. Con cookie válida, pasa. Exentas: fichas /[categoria]/[slug], /vendedor/[id], /solicitudes/[id], /comunidades/*, legales, auth, /auth/*, /callback, /eliminar-cuenta y /cuenta-eliminada. Usuario con sesión: sin cambio, layout.tsx:128 sigue igual. Bots y prefetch pasan. Con GPS denegado, selector manual. Queda por decidir si hay 'Explorar sin zona' (cookie de sesión vicino_sin_zona=1).
3. 3. TDD, primero en rojo: crear scripts/test-muro-entrada.ts con cada fila de la tabla (cookies corruptas '999,999' y 'abc', next externo, next hacia /elegir-zona, query conservada, UA de bot, cabecera next-router-prefetch, sesión presente). Correr con apps/web/node_modules/.bin/jiti; debe fallar.
4. 4. Función pura en apps/web/lib/auth/muro-entrada.ts: decidirMuroEntrada({pathname, search, haySesion, cookieUbicacion, userAgent, esPrefetch}) devuelve 'pasar' o 'redirigir(destino)'. Usa imports relativos (para jiti), destinoSeguro de lib/auth/destino-seguro.ts y parseCoordinates de lib/geo/location-storage.ts:20, con el mismo rango lat/lng que home-session-data.ts:80-96. Excluye /elegir-zona del next para que no haya bucle. Las pruebas del paso 3 pasan a verde.
5. 5. Conectar en apps/web/lib/supabase/middleware.ts después de las guardas privadas (l.82-133) y antes del return final (l.173). Se copian las cookies renovadas al redirect como en l.76-78. proxy.ts no cambia: su matcher ya cubre /, /buscar y /rankings.
6. 6. Paso de zona en apps/web/app/(onboarding)/elegir-zona/page.tsx + paso-zona.tsx, solo con piezas actuales: OnboardingLocationMap, ChangeLocationSheet y useGeolocation.setManualPosition (que llama a writeLocation), con las clases y el texto del paso 'ubicacion' de completar-perfil.tsx:358-392. Al montar: si readLocation() recupera el espejo de localStorage, reescribe la cookie y va a next sin pintar nada. Al guardar: comprobar que document.cookie ya trae vicino_location antes de navegar; si no la trae, error honesto y la salida acordada, sin bucle.
7. 7. Solo si se eligió (a): añadir esApp(userAgent) con VICINO-iOS/VICINO-Android (el precedente está en app/api/mapkit/token/route.ts:215), que lleva a /login?next= con exenciones explícitas (auth, callbacks, legales, eliminar-cuenta). El paso de zona se mantiene para quien ya tiene cuenta y no tiene la cookie.
8. 8. Verificación local: tsc, lint y build; node scripts/check-rutas.mjs; apps/web/node_modules/.bin/tsx scripts/test-destino-seguro.ts; tsx scripts/test-s02a-registro-sesion.ts (sin regresión de next ni de sesión).
9. 9. E2E contra staging: levantar node scripts/staging/dev-contra-staging.mjs (localhost:3100) y correr E2E_BASE=http://localhost:3100 node scripts/staging/e2e-muro-entrada.mjs (nuevo). Fixtures solo @staging.vicino.test, limpiados al final.
10. 10. Para Javier: capturas a 390x844 en claro y oscuro del paso de zona, para su visto bueno visual. Claude no toca estilos ni el texto aprobado; cualquier rediseño lo hace Javier.
11. 11. Pedir a Pedro autorización explícita de despliegue. Con ella: push a master y smoke de solo lectura en producción.
12. 12. Pedro prueba en dispositivo: Android con la build de prueba cerrada e iPhone. Si se eligió (a), actualizar las notas de revisión de App Store y 'Acceso a la app' de Play con una cuenta demo que no sea real.
13. 13. Registrar SHA, entorno (código / desplegado / probado en dispositivo) y evidencia en docs/PENDIENTES-2026-09-26.md y en la jornada de Notion. Marcar PT04 'Matriz de acceso S02-B'.

## Archivos

- apps/web/lib/supabase/middleware.ts (conectar el muro entre l.133 y l.173)
- apps/web/lib/auth/muro-entrada.ts (nuevo, función pura)
- apps/web/lib/auth/destino-seguro.ts (se reusa destinoSeguro; excluir /elegir-zona del next si no se hace en muro-entrada.ts)
- apps/web/lib/geo/location-storage.ts (se reusan parseCoordinates, readLocation y writeLocation; sin cambio de contrato)
- apps/web/app/(onboarding)/elegir-zona/page.tsx (nuevo)
- apps/web/app/(onboarding)/elegir-zona/paso-zona.tsx (nuevo, compone OnboardingLocationMap + ChangeLocationSheet)
- scripts/test-muro-entrada.ts (nuevo, jiti)
- scripts/staging/e2e-muro-entrada.mjs (nuevo)
- docs/PENDIENTES-2026-09-26.md (tabla estado → ruta y evidencia)
- Sin cambios, verificados: apps/web/proxy.ts (el matcher ya cubre /, /buscar y /rankings), apps/web/app/(marketplace)/layout.tsx:128, apps/web/components/auth/muro-sesion.tsx, apps/web/app/(onboarding)/completar-perfil/completar-perfil.tsx

## Pruebas

- Unitarias (jiti): apps/web/node_modules/.bin/jiti scripts/test-muro-entrada.ts. Cubren todas las filas de la tabla: visitante sin cookie en /, /?feed=comunidades, /buscar?q=mesa y /rankings; cookie válida; cookies corruptas; ficha, /vendedor, /login, /auth/callback-server, /terminos, /eliminar-cuenta y /elegir-zona pasan; next externo o hacia /elegir-zona cae en '/'; bots (facebookexternalhit, WhatsApp, Googlebot) y prefetch pasan; usuario con sesión pasa; con (a), UA VICINO-iOS sin sesión lleva a /login?next=.
- Regresión: tsx scripts/test-destino-seguro.ts, tsx scripts/test-s02a-registro-sesion.ts, node scripts/check-rutas.mjs, y tsc + lint + build de apps/web.
- E2E en staging, scripts/staging/e2e-muro-entrada.mjs (Playwright, 390x844, isMobile): (1) contexto limpio con geolocalización denegada: / cae en el paso de zona, se elige la zona a mano y se vuelve a / con la cookie puesta y el feed 'Cerca de ti'; (2) al recargar no vuelve a pedirla; (3) un enlace compartido a una ficha da 200 sin muro; al tocar Inicio sale el paso de zona y luego se vuelve a /; (4) con espejo en localStorage y sin cookie, el paso reescribe la cookie y redirige solo; (5) un fixture con has_seen_onboarding=false sigue yendo a /bienvenida y en completar-perfil el botón 'Entrar a VICINO' ya sale habilitado por la caché; (6) menos de 3 redirecciones por caso (sin bucles).
- Dispositivo (Pedro): instalación limpia o datos borrados en Android e iPhone. Al abrir sale el paso de zona. Al negar el permiso queda el selector manual. Al cerrar y reabrir en frío no vuelve a pedirlo (la cookie persiste en WKWebView). Un deep link a una ficha abre la ficha.
- Smoke de solo lectura en producción, tras el despliegue autorizado: curl -sI https://vicinomarket.com/ sin cookie da 307 hacia /elegir-zona?next=%2F; con -H 'Cookie: vicino_location=19.041,-98.206' da 200; una ficha da 200; con -A 'facebookexternalhit/1.1' da 200; /login da 200.

## Riesgos

- App Store 5.1.1(v): exigir cuenta solo para mirar un marketplace es causa de rechazo. Con (a) también hay que declarar una cuenta demo en App Store y en 'Acceso a la app' de Play.
- La opción (a) no cumple el objetivo: la cookie vicino_location es por dispositivo, y quien ya hizo el onboarding entra en otro teléfono sin pasar por /completar-perfil. Solo el paso ligado a la cookie garantiza la zona.
- Canal de captación: las fichas, /vendedor/[id] y /solicitudes/[id] que se comparten por WhatsApp tienen que seguir públicas. Sin exención de bots, Google y las previsualizaciones mostrarían el paso de zona en lugar del home.
- Bucle de redirección si la cookie no se puede escribir (modo privado, cookies bloqueadas) o si WKWebView la pierde en un arranque en frío. Se mitiga con el espejo de localStorage, comprobando la cookie antes de navegar y con la salida acordada.
- Un prefetch del router puede guardar en caché la redirección; se excluye el prefetch y se cubre en el e2e.
- Quien elige zona y luego se registra ve otra vez el paso 'ubicacion' del onboarding. Queda atenuado porque useGeolocation lee la caché y el botón sale habilitado (completar-perfil.tsx:101).
- El muro es experiencia de usuario, no seguridad: ningún pendiente de seguridad se cierra citándolo.
- Apariencia: el paso nuevo solo compone piezas existentes; no pasa a producción sin el visto bueno visual de Javier.

## Requiere antes

- Decisión escrita de Pedro y Javier: (a) muro duro (solo app o también web) o (b) paso de zona para visitantes.
- Tres filas de la tabla por cerrar: qué rutas llevan muro (/, /buscar, /rankings); si existe 'Explorar sin zona'; si el muro aplica también a usuarios con sesión y sin cookie (nuevo dispositivo).
- Javier: nombre de la ruta y texto del paso, o aceptar el del paso 'ubicacion' actual de completar-perfil.
- Staging operativo (.staging/staging.json, scripts/staging/dev-contra-staging.mjs) y fixtures @staging.vicino.test.
- Autorización explícita de Pedro para desplegar a producción.
- Dispositivos de Pedro: Android con la build de prueba cerrada e iPhone con la app.
- Solo si (a): una cuenta demo para los revisores de Apple y Google, que no sea una cuenta real.

**Responsable:** Decisión: Pedro y Javier. Implementación y pruebas en staging: Claude. Visto bueno visual del paso de zona: Javier. Dispositivos y autorización de despliegue: Pedro.

**Estimación:** Decisión: 30 min (Pedro y Javier). Opción (b): 4-6 h de Claude (tabla 30 min, función pura + unitarias 1 h, middleware 30 min, paso de zona con piezas actuales 1-1.5 h, e2e en staging 1-1.5 h, registro 30 min) + ~1 h de Pedro (dispositivos y despliegue). La opción (a) suma 1-2 h (detección de app, exenciones, notas de revisión) más la espera de la revisión de Apple.

**Ejecutable por Claude ahora:** no
