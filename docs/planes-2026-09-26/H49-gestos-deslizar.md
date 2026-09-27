# Plan H49-gestos-deslizar

**Pendiente:** Deslizar entre páginas resulta incómodo en móvil

**Fuentes en Notion:** H l.49 (H49-gestos-deslizar)

**Estado conciliado (26-sep ~23:30):** decision. Los gestos existen desde c152b20 (lib/navigation/gestures.ts: bloqueo de eje, 10 px, ratio 1.3) y page-swipe-wrapper.tsx. No se ha concretado qué es lo incómodo.

**Qué falta:** Pedro o Javier dicen en qué pantalla y con qué gesto falla (conflicto con carruseles, umbral o animación) y si aplica sobre la barra nativa de iOS. Después, ajustar umbrales y exclusiones y probar en dispositivo.

## Objetivo

Saber qué es exactamente lo incómodo al deslizar entre las pestañas Inicio, Buscar, Chat y Perfil, y corregirlo sin cambiar la apariencia. Estado verificado en el código. El gesto vive en apps/web/components/layout/page-swipe-wrapper.tsx y apps/web/lib/navigation/gestures.ts. La dirección se decide a los 10 px, con una proporción de 1.3. La pantalla sigue al dedo solo un 20% del recorrido, con tope de 48 px. Se cambia de pestaña al pasar de 50 px, sin tener en cuenta la velocidad del gesto. El borde de 20 px está reservado al sistema. Al soltar, la pantalla vuelve a su sitio y aparece la tira "Abriendo…" hasta que llega la ruta. El gesto no puede empezar sobre botones, carruseles Embla (data-no-page-swipe) ni scroll horizontal. Un visitante sin sesión que desliza hacia Chat o Perfil acaba en /login. El P01 del plan de fluidez del 7-sep ya se hizo en c152b20. Lo cubren 8 pruebas en tests/navigation-gestures.spec.ts: la navegación arranca en menos de 100 ms, cancelar no navega y los carruseles, el borde y los modales no se ven afectados. La prueba de aceptación en dispositivo (30 gestos por dirección) no quedó registrada nunca.

## Pasos

1. 1. Pedro o Javier, 15-30 min. Contestar una lista cerrada con plataforma (app iOS, app Android o navegador), pestaña de origen, dirección y si hay sesión. Además, elegir el síntoma: (a) no cambia de pestaña al deslizar porque el dedo empezó sobre un carrusel, un chip o un botón; (b) cambia sin querer al mover un carrusel o al bajar la página; (c) la pantalla apenas sigue al dedo y luego salta con 'Abriendo…'; (d) la pestaña siguiente tarda en aparecer; (e) como visitante acaba en /login; (f) es la burbuja de la barra nativa de iOS (CromoNativo.swift, arrastrarBurbuja). Si se puede, una grabación de pantalla.
2. 2. Claude, se puede hacer ya y es solo lectura. Escribir scripts/staging/e2e-gestos-superficie.mjs (Playwright a 390x844, visitante, E2E_BASE configurable). Recorre / y /buscar, toma una rejilla de puntos con elementFromPoint y les aplica las mismas reglas que pageGestureBlocked. Informa del porcentaje de pantalla donde el gesto puede empezar y hace un swipe por CDP sobre un hueco y otro sobre un carrusel. Resultado: una tabla que se lleva a la conversación del paso 1.
3. 3. Clasificar según el paso 1. (a) y (b) son de comportamiento y los corrige Claude en los pasos 4-7. (c) es la transición visual y se entrega a Javier en el paso 8, sin implementarla. (d) es latencia y no gesto: se une al pendiente 'perfil/chat ~5 s' (Bugs, líneas 862-864) y se mide con window.__vicinoNavigationMetrics() (fuente 'swipe', route_commit_ms) en el dispositivo. (e) la decide Pedro en el paso 9. (f) va para Javier, porque es del piloto Liquid Glass (b72724f) y Claude no toca CromoNativo.swift.
4. 4. Primero las pruebas, en rojo. Crear apps/web/lib/navigation/gestures.test.ts con node:test y jiti, como location-search.test.ts. Sacar a funciones puras de gestures.ts la regla que decide si el gesto cambia de pestaña: swipeCommits(dx, velocidadX, anchoViewport), que cuente también un deslizamiento rápido y corto. Cubrir también el caso de que el gesto empiece sobre un enlace o una tarjeta y no sobre un carrusel.
5. 5. Implementarlo solo en comportamiento. En gestures.ts, ajustar las exclusiones que el paso 2 muestre de más; los mapas, inputs, video y modales se quedan excluidos. En page-swipe-wrapper.tsx: cambiar el umbral de 50 px por swipeCommits, calcular la velocidad con los últimos touchmove y revisar EDGE_GUARD_PX (20 px, más estrecho que la zona de 'atrás' de Android) si Android sale implicado. No se tocan el 20%, el tope de 48 px, la tira 'Abriendo…' ni las clases.
6. 6. pull-to-refresh-wrapper.tsx usa las mismas gestureAxis y pageGestureBlocked, y repite PAGES a mano. Cambiarlo por TAB_ROUTES de lib/navigation/tab-routes.ts para que las dos listas no se separen, y comprobar que los cambios del paso 5 no le afectan.
7. 7. Añadir casos a apps/web/tests/navigation-gestures.spec.ts (playwright.gestures.config.ts, montaje local sin red): un deslizamiento rápido y corto navega; un arrastre lento y corto no; un gesto que empieza sobre un enlace navega sin abrirlo (suppressClick); mover un carrusel o bajar la página nunca cambia la ruta. Las 8 pruebas que ya existen deben seguir en verde.
8. 8. Coordinación con Javier, si sale (c) o (f). Entregarle una nota con los valores actuales (20%, 48 px, 50 px, 'Abriendo…', una duración de 120-180 ms según P01), la grabación y la tabla del paso 2. Él decide si la pantalla sigue al dedo 1:1, si la pestaña nueva entra deslizando y qué sustituye a la tira, respetando reduced motion. Claude solo lo implementa con su especificación, o lo hace Javier.
9. 9. Decisión de Pedro, si sale (e). Una opción es quitar /chat y /perfil de las rutas a las que se puede deslizar cuando no hay sesión, filtrando TAB_ROUTES en page-swipe-wrapper.tsx con la sesión que ya tiene el layout. La otra es dejar que lleve a /login, según la regla de que sin sesión cualquier interacción manda a iniciar sesión.
10. 10. Verificación local: jiti con gestures.test.ts y restauracion-ui.test.ts, `npx playwright test -c playwright.gestures.config.ts`, type-check, lint y build.
11. 11. Staging: scripts/staging/e2e-gestos.mjs con dev-contra-staging, como visitante y con una cuenta sintética de fixtures.mjs. Son 30 gestos por dirección en /, /buscar, /chat y /perfil, con el porcentaje de superficie útil antes y después.
12. 12. Dispositivo, a cargo de Pedro o Javier. 30 gestos por dirección en iPhone (Safari en pestaña privada y en la app) y en Android. Comparar con la grabación del paso 1 y leer __vicinoNavigationMetrics por Web Inspector o chrome://inspect.
13. 13. Producción, solo con autorización explícita de Pedro. Push y despliegue web: no hace falta binario nuevo, porque la app carga vicinomarket.com. Después, smoke de solo lectura como visitante con E2E_BASE=https://vicinomarket.com node scripts/staging/e2e-gestos.mjs y registro en Notion (Bugs, líneas 49 y 864) y en docs/PENDIENTES.

## Archivos

- apps/web/lib/navigation/gestures.ts
- apps/web/lib/navigation/gestures.test.ts (nuevo)
- apps/web/components/layout/page-swipe-wrapper.tsx
- apps/web/components/layout/pull-to-refresh-wrapper.tsx
- apps/web/lib/navigation/tab-routes.ts
- apps/web/components/home/product-carousel.tsx (solo si cambia la exclusión data-no-page-swipe)
- apps/web/tests/navigation-gestures.spec.ts
- apps/web/playwright.gestures.config.ts (sin cambios previstos, se usa para ejecutar)
- scripts/staging/e2e-gestos-superficie.mjs (nuevo, diagnóstico de solo lectura)
- scripts/staging/e2e-gestos.mjs (nuevo, e2e de staging y smoke de prod)
- apps/web/ios/App/App/CromoNativo.swift (solo coordinación con Javier, Claude no lo toca)

## Pruebas

- Unitarias con jiti: apps/web/lib/navigation/gestures.test.ts cubre gestureAxis (10 px y 1.3) y swipeCommits (arrastre lento y corto no, deslizamiento rápido y corto sí, arrastre largo sí), además de las reglas de arranque sobre enlace frente a carrusel.
- Playwright local sin red (playwright.gestures.config.ts): las 8 pruebas actuales de navigation-gestures.spec.ts más las nuevas, que cubren deslizamiento rápido, arrastre lento, gesto sobre enlace sin abrirlo y carrusel o scroll vertical sin cambio de ruta.
- type-check, lint y build en verde.
- Diagnóstico de solo lectura en producción como visitante: e2e-gestos-superficie.mjs da el porcentaje de pantalla donde puede empezar el gesto en / y /buscar, antes y después.
- E2E en staging (scripts/staging/e2e-gestos.mjs) con visitante y cuenta sintética: 30 gestos por dirección y pestaña, cero cambios de ruta al mover un carrusel o bajar la página, y una cancelación nunca navega.
- Dispositivo: 30 gestos por dirección en iPhone (Safari privado y app) y Android, con reduced motion y VoiceOver/TalkBack. Métricas de __vicinoNavigationMetrics con fuente 'swipe'.
- Smoke de solo lectura en producción tras el despliegue autorizado: E2E_BASE=https://vicinomarket.com node scripts/staging/e2e-gestos.mjs como visitante.

## Riesgos

- Bajar el umbral o permitir que el gesto empiece sobre enlaces puede traer cambios de pestaña accidentales al mover carruseles o bajar la página, es decir, volver a lo que se arregló en c152b20.
- Un gesto que empieza sobre una tarjeta puede acabar abriéndola tras el swipe si falla suppressClick. También hay que cuidar el teclado (event.detail === 0).
- pull-to-refresh-wrapper.tsx comparte gestureAxis y pageGestureBlocked: cualquier cambio afecta también a tirar para recargar.
- La emulación táctil de Chrome por CDP no reproduce WKWebView ni la zona de 'atrás' de Android: solo el dispositivo da la prueba por buena.
- Si la causa real es latencia (d), ajustar el gesto no lo arregla y el pendiente seguiría abierto.
- Tocar el 20%, el tope de 48 px, la tira 'Abriendo…' o la animación invade el rediseño reservado a Javier.
- La burbuja nativa de iOS vive en CromoNativo.swift: un cambio ahí necesita binario nuevo, el Mac y revisión de App Store, no solo un despliegue web.

## Requiere antes

- Pedro o Javier contestan la lista del paso 1: plataforma, pestaña, dirección, sesión y síntoma de (a) a (f), mejor con grabación.
- Decisión de Pedro sobre el visitante que desliza hacia Chat o Perfil, si es el caso (e).
- Especificación de Javier para la transición, si es el caso (c), o su plan para la burbuja nativa de iOS, si es el caso (f).
- iPhone y Android físicos para el paso 12. Si hay que tocar código nativo, además hace falta el Mac para compilar.
- Staging disponible y una cuenta sintética de scripts/staging/fixtures.mjs, sin cuentas reales.
- Autorización explícita de Pedro para hacer push y desplegar a producción.

**Responsable:** Pedro y Javier deciden el síntoma y validan en dispositivo. Claude hace el diagnóstico, el ajuste de comportamiento y las pruebas. Javier se encarga de la transición visual y de la barra nativa de iOS. Pedro decide el caso del visitante y autoriza el despliegue.

**Estimación:** Paso 1 (Pedro y Javier): 15-30 min. Diagnóstico de Claude, paso 2: 1-2 h, se puede empezar ya. Ajuste de comportamiento con pruebas, pasos 4-7 y 10: 3-5 h. Staging y dispositivo: 1-2 h. En total, alrededor de 1 día hábil desde la decisión. La transición visual (c) y la barra nativa (f) van aparte y dependen de Javier.

**Ejecutable por Claude ahora:** no
