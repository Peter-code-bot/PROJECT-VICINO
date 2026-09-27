# Plan DISP-S05-mapas

**Pendiente:** S05 en iPhone/iPad: MapKit, GPS, tap/arrastre/pinch, Aplicar, persistencia y preview

**Fuentes en Notion:** A l.19,42,112 (PT05-S05-dispositivo); B l.238-245 (PT05-S05-dispositivo); C l.412 (PT05-dispositivo-mapkit), l.531-534 (T1-S05); D l.650 (R06-ux-mapas-unificada), l.1021-1024,1066 (S05-validacion-nativa-proveedor); E l.1167,1170 (D01-S05-04-nativo); F l.1492-1503 (S05-mapas-tap-arrastre); G l.1713-1716 (G-mapas-ux-unificada); H l.20-21 (H21-mapa-controles-unificados)

**Estado conciliado (26-sep ~23:30):** pendiente. D01-S05 dice 'PASA LOCAL / PENDIENTE NATIVO' y PENDIENTES:170 sigue abierto. La 1.1 (6) carga la web remota, que ya incluye cdc6f96 y 5e14267.

**Qué falta:** Plan: iPhone con la 1.1 (6) y iPad (Safari o app) con una cuenta de prueba. GPS permitido y denegado (entrada manual); buscar Villahermosa; tap, arrastre y pinch sin recentrado en Cambiar ubicación, Publicar, Solicitudes y Onboarding; scroll del panel; cancelar no guarda; Aplicar una sola vez; recargar y confirmar la cookie vicino_location; búsquedas tardías; preview de un producto sin ubicación. Acta D01-S05 con capturas. Fecha: 28-sep.

## Objetivo

Cerrar D01-S05 ("PASA LOCAL / PENDIENTE NATIVO") y PENDIENTES:170 con un acta en iPhone (TestFlight 1.1 (6), que carga la web remota con cdc6f96 y 5e14267) y en iPad (app y Safari). El acta cubre MapKit real, GPS permitido y denegado, tap/arrastre/pinch sin recentrado, scroll del panel, cancelar sin guardar, Aplicar una sola vez, persistencia de la cookie vicino_location, búsquedas tardías y preview con y sin ubicación. Una captura por caso. No toca la apariencia: lo visual se entrega a Javier como dato.

## Pasos

1. 1. (Claude, 27-sep, solo lectura) Antes de nada, git fetch y git log -5 en master: otra sesión commitea en el mismo árbol. Confirmar que la web servida en prod incluye 5e14267.
2. 2. (Claude, 27-sep) Correr las regresiones S05 locales y el smoke de prod de solo lectura (ver pruebas). Si algo sale rojo, se arregla ANTES de la sesión con el dispositivo.
3. 3. (Claude, 27-sep, SELECT de solo lectura por la Management API) Sacar dos URLs públicas de ficha: una con location_map_available=true y otra sin ubicacion_geo. Si en prod no hay ninguna sin ubicación, el caso E2 queda N/A en el dispositivo (lo cubre S05-03 local). No se crea nada.
4. 4. (Claude) Preparar la plantilla del acta en la sección D01 de Notion, 'S05 — dispositivo 28-sep'. Casos A1–A14, B, C, D y E con el resultado esperado, más columnas de dispositivo, modelo, versión de iOS, build, retrato/horizontal, PASA/FALLA y nombre de captura DISP-S05-<caso>-<dispositivo>.png.
5. 5. (Pedro) Decidir la cuenta de prueba dedicada en prod (sin datos reales ni seed) para B, C y D. D necesita una cuenta NUEVA en onboarding: la crea Pedro por admin con email_confirm. El OTP no sirve porque el SMTP está capado a 2 correos por hora. Sin firma, la sesión se hace solo como visitante (A y E) y B/C/D quedan abiertos.
6. 6. (Pedro+Javier, 28-sep 18:00) Preparación: iPhone con TestFlight 1.1 (6) e iPad con la app y Safari. Ubicación en 'Al usar la app'. En iPad, probar retrato y horizontal (TARGETED_DEVICE_FAMILY 1,2).
7. 7. Cambiar ubicación desde Home (change-location-sheet.tsx). A1: MapKit carga sin fallback (anotar segundos). A2: 'Usar mi ubicación' con GPS permitido; anotar CUÁNTOS avisos de iOS salen y su texto (app y dominio, porque es navigator.geolocation dentro de WKWebView). A3: con Ajustes > VICINO > Ubicación = Nunca debe decir 'Permiso de ubicación denegado', la búsqueda manual sigue funcionando y la selección previa no se toca.
8. 8. A4: con la app recién abierta, primera búsqueda 'Villahermosa'; debe dar resultado a la primera (regresión 5e14267) y centrarse ahí. A5: un tap mueve el pin SIN recentrar ni perder el zoom. A6: arrastrar el pin (anotar si MapKit pide pulsación larga). A7: un dedo sobre zona vacía mueve el mapa, no la hoja, y no dispara pull-to-refresh ni el swipe de pestaña. A8: el pinch acerca el mapa y no la página; el doble tap hace zoom y no mueve el pin dos veces.
9. 9. A9: arrastrar fuera del mapa desplaza la hoja (maxHeight 85vh) hasta 'Aplicar ubicación'; con el teclado abierto se ven los resultados. Anotar si Aplicar queda bajo el pliegue en iPhone e iPad; ese dato es para Javier (palomita verde) y no se corrige aquí. A10: mover el pin y cerrar con la X, tocando fuera y con el gesto atrás; al reabrir sigue la ubicación anterior y Home no cambió.
10. 10. A11: doble toque rápido en Aplicar; la hoja se cierra una vez y Home se refresca una vez. A12: aplicar Villahermosa, forzar el cierre de la app y reabrir; la primera pintura de Home ya muestra Villahermosa en la barra y 'Cerca de ti' de esa zona (el servidor lee la cookie). En iPad Safari con Mac, leer vicino_location≈17.99,-92.93 en Web Inspector.
11. 11. A13: escribir 'Mérida', borrar y escribir 'Monterrey' rápido, también con red lenta; nunca aparece ni se aplica el resultado viejo. A14: en modo avión, al abrir la hoja sale el aviso con 'Reintentar'; con la red de vuelta, Reintentar carga el mapa.
12. 12. B Publicar (/vender, product-form.tsx → DeliveryMap → location-picker.tsx) y C Solicitudes (create-request-drawer.tsx), SIN enviar. El mapa aparece solo después de elegir una dirección. Probar tap, arrastre y pinch sin recentrado, el radio, que la X borre solo el texto y 'Quitar ubicación'. Aquí NO hay botón de GPS (DeliveryMap no pasa allowGeolocation): no es fallo. En C, el scroll del drawer contra el mapa.
13. 13. D Onboarding (completar-perfil.tsx → onboarding-location-map.tsx), solo con la cuenta firmada: GPS permitido y denegado, tap y arrastre; 'Entrar a VICINO' guarda y Home abre en esa zona. E Preview: la ficha con ubicación muestra el PNG de la zona aproximada (celda de ~1 km, sin pin exacto) y cambia con el modo oscuro. La ficha sin ubicación dice 'Esta publicación no tiene una ubicación disponible.' o no muestra el banner.
14. 14. (Claude, 28-sep noche) Llenar el acta D01-S05 con las capturas; marcar PENDIENTES-2026-09-26.md:170 y la jornada de Notion; dejar D01-S05-04 como PASA NATIVO o listar los fallos.
15. 15. Triage: cada FALLA pasa a ticket con su archivo. Gestos o pinch que se van a la página: apple-map-container.tsx (touchAction), change-location-map.tsx / location-picker.tsx (data-no-page-swipe) o lib/navigation/gestures.ts. Recentrado: apple-map-container.tsx (regionAplicadaRef) y los setView de cada consumidor. Doble aviso o fallo de GPS: pasar a @capacitor/geolocation (ya está en includePlugins), que es decisión de Pedro y puede exigir el build iOS 1.1 (7). Persistencia: lib/geo/location-storage.ts. Primera búsqueda vacía: hooks/use-mapkit.ts / lib/geo/location-search.ts. Preview: components/product/location-banner.tsx y app/api/products/[id]/location-map/route.ts. Lo visual (Aplicar bajo el pliegue, botones) se le entrega a Javier sin tocarlo.
16. 16. Cada arreglo: primero la prueba roja (en scripts/test-s05-map-browser.ts o tests/phases-location.spec.ts), luego el fix sin cambiar la apariencia, la revisión CODEX y pnpm build. Push solo con autorización de Pedro, porque master se despliega solo a prod. Después, repetir en el dispositivo únicamente el caso que falló.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/map/apple-map-container.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/home/change-location-sheet.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/home/change-location-map.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/map/location-picker.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/map/delivery-map.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/map/onboarding-location-map.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(onboarding)/completar-perfil/completar-perfil.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/vender/product-form.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/solicitudes/create-request-drawer.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/comunidades/admin/centro-map.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/geo/location-storage.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/hooks/use-mapkit.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/geo/location-search.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/navigation/gestures.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/product/location-banner.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/api/products/[id]/location-map/route.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/capacitor.config.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/ios/App/App/Info.plist
- C:/Users/pedro/Projects/startup-marketplace/apps/web/tests/phases-location.spec.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/tests/mapkit-recovery.spec.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/playwright.s05.config.ts
- C:/Users/pedro/Projects/startup-marketplace/scripts/test-s05-map-browser.ts
- C:/Users/pedro/Projects/startup-marketplace/scripts/test-s05-map-server.ts
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-villahermosa.mjs
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md

## Pruebas

- Unitaria (jiti): cd apps/web && node_modules/.bin/jiti lib/geo/location-search.test.ts → todo en verde (clasificarResultado, cobertura país/radio, Villahermosa dentro).
- Regresiones S05 aisladas en 3 viewports (mobile 390, ipad 820, desktop): pnpm --filter web exec playwright test --config playwright.s05.config.ts (phases-location.spec.ts + mapkit-recovery.spec.ts), sin .env, sin seed y sin sesiones.
- Componentes reales y ruta de preview: node node_modules/tsx/dist/cli.mjs scripts/test-s05-map-server.ts y, después del build (usa su CSS), scripts/test-s05-map-browser.ts.
- Smoke en prod, solo lectura: E2E_BASE=https://vicinomarket.com node scripts/staging/e2e-villahermosa.mjs → 3/3 (Villahermosa, Mérida, Monterrey aparecen, se aplican y la cookie guarda el punto a menos de 30 km).
- Smoke de tiempo de MapKit en prod (el script de tiempos de esta noche): MapKit listo por debajo de ~1 s y la primera búsqueda no vuelve vacía.
- Dispositivo (acta D01-S05): casos A1–A14 en iPhone app, iPad app (retrato y horizontal) e iPad Safari; B, C y D con la cuenta de prueba firmada; E1/E2 con las URLs de la lectura SQL. Todos PASA o con ticket, una captura por caso.
- Tras cada fix: una prueba nueva que falle antes y pase después, pnpm build en verde, y repetir en el dispositivo solo el caso afectado.

## Riesgos

- GPS en WKWebView: la app usa navigator.geolocation y no el plugin nativo. iOS puede pedir permiso dos veces (la app y el dominio vicinomarket.com) o recordar una negativa. Si pasa, arreglarlo con @capacitor/geolocation es decisión de Pedro y puede exigir el build 1.1 (7) desde la Mac del equipo.
- Arrastre del pin: en pantallas táctiles MapKit JS puede pedir pulsación larga antes de arrastrar. Si Javier quiere el arrastre inmediato de Comunidades, es un cambio de interacción que se decide con él, no un bug.
- Persistencia: la cookie se escribe con document.cookie y max-age de 1 año, pero ITP de WebKit puede limitarla a 7 días. Una sesión de un día no lo prueba. El espejo en localStorage la reescribe en el cliente, aunque el primer render del servidor tras caducar saldría sin zona.
- La build release no se puede inspeccionar: la evidencia de la cookie en la app es indirecta (barra de Home y 'Cerca de ti' tras forzar el cierre).
- Escrituras en prod: Publicar y Solicitudes se prueban SIN enviar. Onboarding sí escribe perfil y auth de una cuenta nueva, y solo se hace con firma. Nada con cuentas reales ni el seed.
- Mezcla con el rediseño: 'Aplicar' bajo el pliegue, la palomita verde y la hoja nueva de Cambiar ubicación son de Javier. El acta solo los registra.
- Master se despliega solo a prod: un arreglo apresurado tras la sesión puede romper prod. Antes, pnpm build y autorización.
- Otra sesión commitea en el mismo árbol: verificar git antes de tocar código.

## Requiere antes

- Dispositivos: iPhone con TestFlight 1.1 (6) instalado e iPad con la app y Safari; Javier con acceso a TestFlight.
- Firma de Pedro para una cuenta de prueba dedicada en prod (sin datos reales ni seed) para Publicar, Solicitudes y Onboarding. Onboarding exige una cuenta nueva, creada por admin con email_confirm, porque el SMTP está capado a 2 correos por hora. Sin esa firma, solo se prueba A y E como visitante.
- Lectura SQL de solo lectura en prod (Claude) para tener una ficha con ubicación y otra sin ubicación.
- Opcional: una Mac con Safari Web Inspector para leer la cookie vicino_location en el iPad con Safari. La app de TestFlight es build release y no se puede inspeccionar, así que ahí la persistencia se prueba por lo que se ve en pantalla.
- Agenda: 28-sep 18:00 (la fecha que da la jornada); conviene juntarla con la verificación del header fijo y la cápsula nativa en iPhone.
- Cualquier push de un arreglo necesita autorización de Pedro, porque master se despliega solo a prod.

**Responsable:** Pedro + Javier (sesión en dispositivo, 28-sep 18:00); Claude (preparación 27-sep, acta y arreglos de lógica con autorización)

**Estimación:** Preparación de Claude: 1 h (27-sep). Sesión en dispositivo: 2 a 2.5 h (28-sep, Pedro+Javier; conviene unirla a la del header fijo en iPhone). Acta y registro en Notion y PENDIENTES: 45 min. Cada fallo que salga: de 1 a 3 h aparte; si toca pasar al plugin nativo de geolocalización, además un build iOS nuevo.

**Ejecutable por Claude ahora:** no
