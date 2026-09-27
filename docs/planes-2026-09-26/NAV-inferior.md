# Plan NAV-inferior

**Pendiente:** Barra de navegación inferior: reparto de los botones en web/Android frente a la tab bar nativa de iOS

**Fuentes en Notion:** G l.1815-1818,1833-1834,1856 (LG-nav-inferior); H l.48 (H48-bottom-nav-distribucion)

**Estado conciliado (26-sep ~23:30):** decision. bottom-nav.tsx:13-21 reparte 2 + Vender al centro + 2 con justify-around y un hueco central (:105). Se oculta en ficha, chat y /vender (52170f1). En iOS la tab bar es nativa (b72724f) y está sin probar al tacto.

**Qué falta:** Javier o Alejandro confirman si la separación por el Vender central es intencional, cómo queda con y sin Vender (4 o 5 ítems) y si aplica solo a web/Android. Después, validar en iPhone/WebKit.

## Objetivo

Cerrar el reporte "barra inferior mal distribuida, dos pares" (H l.48 y G l.1818). El defecto de código ya se corrigió en 8a7d84c (27-ago, `flex-1 justify-around`), después se aplanó en 315157f, y los dos commits están en producción porque son ancestros de 4b6be86. Quedan cuatro cosas: medir que el reparto actual es parejo en web/Android con Vender y sin Vender, entregar esa evidencia a Javier para que confirme el diseño o pida un cambio, decidir si web/Android se acercan a la tab bar nativa de iOS (b72724f: Vender como pestaña normal en medio, `fillEqually`), y validar en dispositivo. Con el código actual el reparto ya sale parejo: a 375 px la separación entre centros es 64.6/70.6/70.6/64.6 px con Vender y 83.5 px uniforme sin Vender. El defecto viejo daba una razón mayor que 2.

## Pasos

1. 1. Premisa con git (Claude, solo lectura). Hacer `git fetch origin` y confirmar que 8a7d84c y 315157f son ancestros de origin/master y de lo que sirve producción. Anotar que la validación en dispositivo de bugs3 l.884-887 (cinco elementos parejos; cuatro sin burbuja) nunca se hizo. La subpregunta de G l.1818 (ocultar la barra en la ficha) ya la decidió Alejandro el 27-ago y está en 52170f1.
2. 2. Medición de solo lectura en producción, como visitante anónimo (sin sesión, isVendedor=false, 4 ítems). Correr Playwright con chromium y webkit-2287, que ya está instalado en %LOCALAPPDATA%/ms-playwright, a 320, 360, 375, 390 y 430 px. Leer getBoundingClientRect de #nav-inicio, #nav-buscar, #nav-chat y #nav-perfil. Criterio: razón máx/mín de la separación entre centros ≤ 1.02, sin .liquid-nav-fab, sin cajas encimadas. Tomar capturas en claro y oscuro.
3. 3. Medición del estado vendedor en staging. Crear `scripts/staging/e2e-nav-inferior.mjs` con el patrón de e2e-campus-home.mjs: crearUsuario, completarOnboarding y `update profiles set es_vendedor=true` solo en staging, login por UI y web local en :3100 con dev-contra-staging.mjs. Crear dos fixtures sintéticas @staging.vicino.test (vendedor y comprador) y limpiar() al final.
4. 4. Criterios del paso 3 con vendedor: exactamente un .liquid-nav-fab; su centro coincide con el centro de la píldora ±1 px; razón de separación entre las 5 posiciones ≤ 1.15 (hoy 1.09 a 375 y 1.11 a 320). Con comprador: 4 ítems parejos. En los dos casos, la barra no se pinta en /chat/<id>, en la ficha, en /vender ni en /perfil/editar, y el badge sigue dentro de #nav-chat.
5. 5. Paquete para Javier, sin tocar la apariencia: capturas web en Chromium y WebKit de 4 estados (vendedor/no vendedor × claro/oscuro), la tabla de medidas de los pasos 2 a 4, una captura de la tab bar nativa de iOS en TestFlight 1.1 (6) o en el Simulator de la Mac, y el extracto de openspec/changes/2026-08-27-liquid-navigation/design.md (4 ítems sin círculo; 5 con Vender elevado).
6. 6. Preguntas cerradas a Javier, registradas en Notion/D01: (a) ¿el reparto actual en web/Android es el aprobado? (b) ¿web/Android conservan Vender elevado en círculo o convergen con la tab bar nativa (Vender como pestaña normal en medio, icono sobre texto)? Esto entra en el contrato LG01 nativo/web. (c) ¿se iguala el hueco central de 64 px al círculo de 60 px? (d) confirmar que sin Vender van 4 ítems sin círculo y que la barra se oculta en ficha, chat, vender y editar perfil.
7. 7. Rama A, si Javier aprueba lo actual: no se toca código. `e2e-nav-inferior.mjs` queda como regresión. H l.48 se cierra con el SHA 8a7d84c más la evidencia de los pasos 2 a 4, y se registra en docs/PENDIENTES-2026-09-26.md.
8. 8. Rama B, si Javier pide un cambio: él entrega la especificación (medidas, 4 y 5 ítems, iOS frente a web). El cambio se acota a bottom-nav.tsx (:74-84 reparto, :93 justify-around, :105 hueco w-16, :116-133 círculo) y a globals.css (.liquid-nav* :356-397). Se conserva el contrato: nav[aria-label="Navegación principal"], ids nav-*, aria-current, badge con aria-label que termina en "sin leer", clase liquid-nav-fab en el central, scroll={false} con marcarRestauracionPendiente, md:hidden y las 4 rutas donde se oculta. Si cambia el contrato DOM, se ajusta CromoNativo.swift (:782, :889-895) en la Mac.
9. 9. Pruebas de la rama B, en una rama propia y no en master. Si la regla de reparto sale a una función pura (apps/web/lib/navigation/reparto-nav.ts), escribir su prueba unitaria (scripts/test-reparto-nav.ts, con tsx/jiti). Correr `e2e-nav-inferior.mjs` con los criterios nuevos, navegacion.spec.ts #3 en el proyecto mobile, y `pnpm type-check`, `pnpm lint` y `pnpm build`. Javier revisa en el preview de Vercel de la rama.
10. 10. Despliegue: un push a master se despliega a producción al momento, porque 6ee06be retiró la retención. Solo se hace con autorización explícita de Pedro. Después se repite la medición de solo lectura del paso 2 contra vicinomarket.com.
11. 11. Dispositivo (Javier/Pedro). Safari de iPhone: barra web con WebKit real y safe-area. App iOS de TestFlight: tab bar nativa con 4 y 5 pestañas, Vender en medio, oculta en ficha, chat y vender. App Android con el AAB 8: barra web dentro del WebView. Cada quien prueba con su propia cuenta, sin cuentas de terceros ni el seed excluido. Registrar dispositivo y versión del sistema en BB06/A04 y marcar H l.48 en Notion.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/layout/bottom-nav.tsx (:12-21 ítems, :74-84 reparto 2+central+2, :93 justify-around, :105 hueco w-16, :116-133 círculo liquid-nav-fab)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/globals.css (:93 --bottom-nav-h, sin consumidores en el código versionado según git grep; :356-397 .liquid-nav, .liquid-nav-fab, .liquid-nav-indicador)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/ios/App/App/CromoNativo.swift (:108-109 altoBarra/anchoPestana, :201-217 fillEqually, :397-410 pintarPestanas con el central en medio, :782 SEL_NAV, :792-795 oculta la barra web, :889-895 contrato ids nav-*, liquid-nav-fab y badge)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/layout.tsx (:122 isVendedor, :198 <BottomNav>)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/tests/navegacion.spec.ts (:108-140 contrato de la barra inferior)
- C:/Users/pedro/Projects/startup-marketplace/openspec/changes/2026-08-27-liquid-navigation/design.md (geometría aprobada: 4 sin círculo, 5 con Vender elevado)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-nav-inferior.mjs (NUEVO, patrón de e2e-campus-home.mjs y fixtures.mjs)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/dev-contra-staging.mjs (web local en :3100 contra staging)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/navigation/reparto-nav.ts y scripts/test-reparto-nav.ts (NUEVOS, solo en la rama B)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md (registro del cierre)

## Pruebas

- Smoke de solo lectura en producción, anónimo con 4 ítems: Playwright en chromium y webkit a 320/360/375/390/430 px; razón máx/mín de la separación entre centros de #nav-* ≤ 1.02 y sin .liquid-nav-fab.
- E2E en staging, scripts/staging/e2e-nav-inferior.mjs (nuevo), con una fixture vendedora y una compradora sintéticas @staging.vicino.test. Vendedora: un solo .liquid-nav-fab centrado en la píldora ±1 px y razón de separación ≤ 1.15. Compradora: 4 ítems parejos. Las dos: barra ausente en /chat/<id>, ficha, /vender y /perfil/editar; badge dentro de #nav-chat; fixtures borradas al final.
- Regresión existente: apps/web/tests/navegacion.spec.ts test #3 en el proyecto mobile (375x812). Los ids nav-inicio, nav-buscar, nav-chat y nav-perfil siguen presentes, #nav-vender apunta a /vender y ningún destino da 404.
- Solo en la rama B: prueba unitaria de la función pura de reparto con tsx/jiti (4 y 5 ítems, orden, índice del central); además pnpm type-check, pnpm lint y pnpm build en verde antes de cualquier push.
- Contrato con iOS nativo: en la app de TestFlight, la barra nativa muestra Vender en medio cuando existe #nav-vender con la clase liquid-nav-fab, y 4 pestañas sin él. Si falta liquid-nav-fab, Vender aparece al final: eso cuenta como fallo.
- Dispositivo: Safari de iPhone, app iOS de TestFlight y app Android con el AAB 8, con y sin cuenta vendedora del propio probador; capturas y dispositivo/OS registrados en BB06/A04.

## Riesgos

- Reporte vencido: el defecto de los dos pares se corrigió el 27-ago (8a7d84c) y está en producción. Hay riesgo de volver a arreglar lo que ya está arreglado; lo que falta es verificar y decidir.
- Contrato silencioso con iOS nativo. Si se renombra un id nav-*, el onboarding deja de señalar y el icono nativo cae a un círculo genérico. Si se quita la clase liquid-nav-fab, Vender aparece al final de la tab bar nativa. Si cambia el aria-label de la nav, se ven la barra web y la nativa a la vez. Ninguno de estos fallos lo detectan tsc ni build.
- Convergir web/Android con la tab bar nativa cambia la apariencia en Android y en la web: es rediseño reservado a Javier y no se hace como corrección de un bug.
- --bottom-nav-h (calc(safe-area + 98px)) ya no tiene consumidores en el código versionado. Un cambio de geometría no mueve ningún CTA, y un CTA futuro que la use heredaría un valor equivocado si no se actualiza.
- Playwright WebKit en Windows no equivale a Safari de iOS: no tiene safe-area real ni el mismo compositor de backdrop-filter. No sustituye la prueba en dispositivo.
- A 320 px con Vender quedan unos 8 px libres (1.6 px entre ítems de 52 px). Cualquier ítem o margen extra provoca traslape o desborde.
- Push a master es igual a producción inmediata: no se integra la rama B sin la revisión de Javier en el preview ni sin la firma de Pedro.
- El estado vendedor solo se prueba con una fixture sintética en staging. En producción, cada quien valida con su propia cuenta, nunca con cuentas de terceros ni con el seed excluido.

## Requiere antes

- Decisión de Javier sobre las preguntas a-d: ¿el reparto actual es el aprobado?, ¿convergencia con la tab bar nativa o divergencia por plataforma?, ¿se iguala el hueco de 64 px al círculo de 60 px?, ¿se confirman 4 ítems sin Vender y las rutas donde se oculta?
- Staging vicino-staging operativo (.staging/staging.json) y la web local en :3100 con dev-contra-staging.mjs, para la fixture vendedora sintética.
- Mac con Xcode/Simulator o iPhone con TestFlight 1.1 (6), y un Android con el AAB 8, para el paso 11.
- Autorización explícita de Pedro para cualquier push a master, que despliega a producción al momento desde 6ee06be.
- Si la rama B cambia el contrato DOM: alguien que ejecute en iOS en la Mac para ajustar CromoNativo.swift, porque desde Windows no se compila ni se prueba.

**Responsable:** Javier decide el diseño (preguntas a-d). Claude hace la medición, el e2e y el paquete de evidencia (pasos 1-5, 7 y 9). Pedro autoriza el despliegue a producción. Javier o Pedro validan en dispositivo, y los cambios nativos de iOS se hacen en la Mac.

**Estimación:** Claude: 1.5 a 2 h para la medición en producción, el e2e en staging y el paquete para Javier. Javier: 20 a 30 min de revisión. Rama A (sin cambio): 30 min de cierre. Rama B (cambio de geometría o convergencia con iOS): 3 a 5 h en la web, 1 a 2 h en iOS nativo si cambia el contrato DOM y 1 h en dispositivo. Total realista: 3 a 4 h por la rama A y 7 a 10 h por la rama B.

**Ejecutable por Claude ahora:** no
