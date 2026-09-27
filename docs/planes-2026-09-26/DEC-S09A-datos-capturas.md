# Plan DEC-S09A-datos-capturas

**Pendiente:** S09-A: decidir datos dedicados para las capturas y la prueba en iPhone

**Fuentes en Notion:** A l.55 (S09A-datos-capturas); C l.596-597 (A3-ficha-revision-A04, capturas campus); D l.1130,1140-1143 (S09-integracion, datos); F l.1559-1563 (S09A-categoria-universidad, datos); G l.1733-1736 (G-estudiantes-funcional, capturas)

**Estado conciliado (26-sep ~23:30):** decision. En prod solo hay 1 credencial universitaria aprobada (Anáhuac). Capacitor carga prod, así que las capturas del iPhone salen de datos de prod.

**Qué falta:** Elegir: (a) cuentas demo dedicadas en prod (dominio de prueba propio, credencial sintética aprobada, 6-10 publicaciones con fotos propias y retiro documentado), que requieren autorización de Pedro; o (b) capturas web desde staging con fixtures (e2e-campus-home ya los crea). También depende de LEGAL-nombres-universidades. Fecha propuesta: 27-sep.

## Objetivo

Que Pedro y Javier elijan de dónde salen los datos de las capturas de App Store del modo campus y de la prueba en iPhone. Se recomienda la opción (c): datos demo en staging y la app iOS real en el Simulador del Mac, cargando la web local contra staging. Así las capturas llevan el cromo nativo sin escribir nada en prod. Hay que dejar el entorno reproducible y limpiable. El plan corrige además la premisa de la opción (b). Los fixtures de e2e-campus-home no sirven para capturas: llevan el prefijo [FIXTURE], no tienen fotos, usan nombres reales (Anáhuac/UDLAP/BUAP) y se borran al terminar. Y una captura de Chrome no trae el cromo nativo: CromoNativo.swift solo lo monta en los hostsPropios (l.638-641: vicinomarket.com, www, startup-marketplace-web.vercel.app y localhost). El propio plan P4 dice que una captura web no acredita Liquid Glass.

## Pasos

1. 1. DECISIÓN (27-sep, Pedro+Javier, 20 min). Elegir entre: (c) recomendada, staging + Simulador con server.url=http://localhost:3100 (localhost está en hostsPropios, así que el cromo nativo sí aparece); (b) captura web pura, que se descarta porque no refleja la app; (a) cuentas demo en prod, solo con autorización escrita de Pedro (ver riesgos). Anotar la elección en Notion y en docs/PENDIENTES-2026-09-26.md §S09-A.
2. 2. LEGAL. Mientras no haya dictamen de LEGAL-nombres-universidades, la demo usa una institución ficticia, p. ej. 'Universidad Demo', y la elige Javier. Ese nombre no está en UNIVERSITY_COLORS (apps/web/lib/utils.ts l.8-19), así que toma el color por defecto #0ea5e9 sin tocar código. university_name no tiene CHECK en las migraciones. Si Legal veta la función universitaria, se quitan las capturas de campus.
3. 3. ENTREGA DE JAVIER (diseño reservado). Lista de capturas: pantallas, orden y textos del marco. Tamaños: iPhone 6.9" y también iPad 13", porque TARGETED_DEVICE_FAMILY="1,2" en project.pbxproj l.331. Además, 8-12 fotos propias con derechos y sin caras de terceros, que se guardan en .staging/demo-fotos/ (ignorado por .gitignore l.68). No usar picsum ni Unsplash aunque next.config los admita.
4. 4. Claude: scripts/staging/fixtures.mjs. Parametrizar dominio y nombre visible en crearUsuario/limpiar. Hoy full_name es 'Fixture <etiqueta>' y saldría en la captura. El valor por defecto sigue siendo staging.vicino.test, así que los e2e no cambian. limpiar() pasa a retirar también seller_verification del dominio.
5. 5. Claude: scripts/staging/demo-datos.mjs (nuevo, datos puros). Contiene: la institución ficticia; 1 estudiante lector, 3-4 vendedores de esa institución y 2 generales, con nombres claramente ficticios; y 8-12 productos con títulos naturales sin [FIXTURE], precio, categoría y foto de .staging/demo-fotos. Todos en Puebla (19.0414, -98.2063).
6. 6. Claude: scripts/staging/demo-capturas.mjs (nuevo), con los comandos crear, estado y limpiar. Usa el dominio propio demo.vicino.test para que el limpiar() de los e2e no lo borre. Pasos de crear: (1) usuarios por GoTrue admin del staging; (2) completarOnboarding; (3) es_vendedor; (4) credencial 'Credencial Universitaria' aprobada por SQL con tres rutas sintéticas, porque el guard 20260826230000 exige tres documentos; (5) fotos al bucket público product-media en <userId>/…; (6) imagen_principal, que es lo que lee Home (home-session-data.ts l.129/234/360). Debe ser idempotente. La contraseña del lector se guarda en .staging/demo.json y nunca se imprime. assertNoProd sigue obligatorio.
7. 7. Claude: scripts/staging/dev-contra-staging.mjs. Añadir el flag --build, que corre next build y luego next start -p 3100 con el mismo entorno de staging. Así no sale el indicador de dev de Next en las capturas, y las NEXT_PUBLIC_* se incrustan al compilar. Vaciar también SENTRY_AUTH_TOKEN (next.config l.439), para no subir sourcemaps de staging a Sentry de prod. Al terminar, borrar apps/web/.next.
8. 8. Claude: correr en orden igualar-con-prod.mjs (solo reporte), demo-capturas.mjs crear, las pruebas de la sección Pruebas y demo-capturas.mjs estado. Dejar los datos demo vivos en staging para la sesión del Mac.
9. 9. Javier (Mac): git pull. Poner .staging/staging.json (claves SOLO de staging) por un canal seguro, nunca por chat ni git, o bien usar un túnel ssh -L 3100 a la máquina de Pedro. Correr node scripts/staging/dev-contra-staging.mjs --build. Editar SOLO apps/web/ios/App/App/capacitor.config.json, que es generado e ignorado (apps/web/ios/.gitignore l.12): server.url a http://localhost:3100. No tocar capacitor.config.ts.
10. 10. Javier (Mac): Xcode, Run en el Simulador de iOS 26 (iPhone 6.9" y iPad 13"). Poner la ubicación del simulador en Puebla, entrar con el lector demo, recorrer la lista de capturas y guardar cada una con xcrun simctl io booted screenshot. El marco y los textos los monta Javier.
11. 11. Javier (Mac), restauración antes de cualquier Archive: npx cap copy ios, que regenera la URL de prod; comprobar con grep que el JSON trae https://vicinomarket.com y no localhost; borrar .next y la copia de staging.json; Erase del simulador.
12. 12. Prueba en iPhone físico (A3/A04) contra prod con el candidato. Cubre visitante y una cuenta dedicada sin universidad: push, enlaces universales, MapKit y arranque en frío. El modo campus en dispositivo se da por cubierto con e2e 11/11 más el Simulador con el mismo binario nativo. Anotarlo como límite en A04. Si Pedro exige campus en prod, pasar a la opción (a), que necesita su firma.
13. 13. Claude: cuando no queden más capturas por repetir, demo-capturas.mjs limpiar. Anotar la evidencia (SHA, conteos, rutas de las capturas) en docs/PENDIENTES-2026-09-26.md §S09-A y en Notion (jornada 26-sep y DEC-S09A).

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/fixtures.mjs (modificar: dominio y nombre visible parametrizables; limpiar también seller_verification)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/dev-contra-staging.mjs (modificar: flag --build con next build + next start; vaciar SENTRY_AUTH_TOKEN)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/demo-datos.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/demo-datos.test.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/demo-capturas.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-demo-capturas.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md (§S09-A: decisión y evidencia)
- C:/Users/pedro/Projects/startup-marketplace/.staging/demo-fotos/ y .staging/demo.json (fuera de git)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/ios/App/App/capacitor.config.json (solo en el Mac, generado e ignorado, se restaura con npx cap copy ios; nunca se commitea)
- Sin cambios en apps/web/** ni en capacitor.config.ts ni en CromoNativo.swift. Referencias verificadas: apps/web/ios/App/App/CromoNativo.swift l.638-641 y l.780; apps/web/lib/university-data.ts; apps/web/lib/utils.ts l.8-19; supabase/migrations/20260826230000_guard_aprobacion_verificacion.sql; apps/web/next.config l.439

## Pruebas

- Unitaria: node --test scripts/staging/demo-datos.test.mjs. Comprueba que el conjunto no contiene '[FIXTURE]' ni ninguna clave real de UNIVERSITY_COLORS salvo 'Otra' (leídas de apps/web/lib/utils.ts), que tiene 8-12 productos y que cada foto referenciada existe en .staging/demo-fotos.
- Idempotencia: demo-capturas.mjs crear dos veces seguidas; estado da el mismo número de usuarios, productos y credenciales, sin duplicados.
- E2E staging: node scripts/staging/e2e-demo-capturas.mjs (nuevo; web en :3100 contra staging, viewport 430x932). El lector demo entra por /login. En /: el chip #cat-universidad es el primero. En /?cats=universidad: aparecen los N títulos demo y ningún producto general. Todas las <img> de main cargan (naturalWidth>0). El texto no contiene '[FIXTURE]', 'Fixture', 'Anáhuac', 'BUAP' ni 'UDLAP'. /buscar?category=universidad muestra los mismos N. Sin pageerror.
- Regresión: node scripts/staging/e2e-campus-home.mjs debe dar 11/11 y 'Fixtures restantes: 0' con la demo cargada. Después, demo-capturas.mjs estado debe dar los mismos conteos: el limpiar de staging.vicino.test no toca demo.vicino.test.
- Build contra staging: dev-contra-staging.mjs --build, exit 0 y 200 en /, /?cats=universidad y /buscar?category=universidad en localhost:3100. Sin subida de Sentry en el log.
- Mac: inicio de sesión y cromo nativo visibles en el Simulador (cápsula y barra de pestañas) sobre localhost. Antes de Archive, grep -c localhost apps/web/ios/App/App/capacitor.config.json = 0.
- Smoke de solo lectura en prod con prodRead de lib.mjs: select count(*) from auth.users where email like '%@demo.vicino.test' = 0, y el conteo de seller_verification aprobadas con 'Credencial Universitaria' sigue siendo 1, igual que antes. Prueba que nada llegó a prod.
- Limpieza: demo-capturas.mjs limpiar deja 0 usuarios @demo.vicino.test, 0 filas de seller_verification y 0 objetos de product-media bajo sus ids.

## Riesgos

- Opción (a) en prod, efectos comprobados en migraciones. (1) Aprobar una credencial da is_verified y +30 trust_points (20260916190000), así que las cuentas demo entran en los rankings de prod. (2) Sus productos se ven a compradores reales de Puebla. (3) Habría que subir una credencial falsa de una institución real. (4) El retiro depende de delete-account, y la desplegada es la del 16-jul (PT09).
- Marca: el nombre de la universidad sale en pantalla ({viewerUniversity} en home-session.tsx l.127/151 y en el título de /buscar l.423) con su color institucional. Usar un nombre real en capturas de tienda sin permiso choca con Apple 5.2.
- Riesgo de publicar con localhost: si se archiva con el JSON local apuntando a localhost, el build publicado no carga. Se mitiga con npx cap copy ios y el grep antes de Archive.
- ATS de iOS podría bloquear http://localhost en el WKWebView del Simulador. Si pasa, añadir NSAllowsLocalNetworking solo en la copia local sin commitear, o servir por https.
- Claves de staging en el Mac: son un secreto aunque no sean de prod. Canal seguro, borrarlas al terminar y rotarlas si se filtran.
- next build con el entorno de staging deja un .next con bundle de staging y, sin vaciar SENTRY_AUTH_TOKEN, subiría sourcemaps a Sentry de prod.
- Fidelidad de las capturas: Liquid Glass requiere el Simulador de iOS 26. En iOS anteriores sale el fallback, y la captura no correspondería a lo que ven la mayoría.
- El staging puede haber derivado de prod: correr igualar-con-prod.mjs (reporte) antes de sembrar.
- Si se pierden las fotos o el nombre ficticio no llega, el plan se atasca en el paso 3 y no hay forma técnica de suplirlo.

## Requiere antes

- Decisión escrita de Pedro+Javier sobre la opción, (c) recomendada
- Dictamen de LEGAL-nombres-universidades, o aceptación de una institución ficticia para las capturas
- Lista de capturas de Javier (pantallas, orden, iPhone 6.9" e iPad 13")
- 8-12 fotos propias con derechos en .staging/demo-fotos/
- Staging vivo con .staging/staging.json y el PAT de la Management API
- Mac de Javier con Xcode y Simulador de iOS 26, y un canal seguro para las claves de staging (o túnel SSH)
- Solo si se elige (a): autorización explícita de Pedro para escribir en prod y un plan de retiro firmado

**Responsable:** Decisión: Pedro+Javier. Scripts de staging, pruebas y registro: Claude, cuando haya decisión, fotos y nombre ficticio. Lista de capturas, sesión en el Mac/Simulador y marco de capturas: Javier. Prueba en iPhone físico: Javier/Pedro.

**Estimación:** ~5 h el 27-sep, sin contar la espera de Legal. Decisión y lista de capturas: 20-30 min. Scripts, test unitario, e2e y regresión (Claude, solo staging): 2.5-3 h. Sesión en el Mac con dos tamaños y restauración (Javier): 1.5-2 h. Si se elige (a), sumar 1-1.5 h y la firma de Pedro.

**Ejecutable por Claude ahora:** no
