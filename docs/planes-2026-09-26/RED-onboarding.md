# Plan RED-onboarding

**Pendiente:** Onboarding: revisión visual completa del flujo

**Fuentes en Notion:** D l.817,831-832 (S02B-rediseno-onboarding-configuracion, Onboarding); F l.1622-1624 (T6-onboarding-revision); G l.1763-1766 (G-onboarding-revision); H l.32 (H32-onboarding-frontend)

**Estado conciliado (26-sep ~23:30):** pendiente. No hay rediseño en app/(onboarding)/*: lo último es funcional (b3a5ced, 2e6b7c7 y cdc6f96 en el buscador).

**Qué falta:** Plan visual de Javier: inventario de pantallas, bocetos y responsivo. Depende de DEC-muro-entrada y del paso de estudiante (S09-UI-estudiante). La parte funcional va en S02B-matriz-acceso.

## Objetivo

Coordinar la revisión visual completa del onboarding (4 rutas, unos 13 estados) sin tocar su lógica. Tiene tres fases. (A) Claude arma hoy el paquete para Javier contra staging: capturas, inventario, contrato funcional que no se toca y preguntas cerradas. (B) Javier diseña y aprueba. (C) Tras la aprobación, Claude implementa solo marcado y clases, con recorridos e2e que demuestren que no vuelven los bucles de 2e6b7c7 y 227f685. Solo la fase A se puede ejecutar ya. B y C quedan bloqueadas por el diseño de Javier y por DEC-muro-entrada.

## Pasos

1. [Claude, ya] Corregir la ficha de Notion: la ruta /activar-ubicacion que cita el diagnóstico (jornada, §2.3) no existe. La ubicación es el paso 'ubicacion' de /completar-perfil.
2. [Claude, ya] Levantar la web local contra staging: node scripts/staging/dev-contra-staging.mjs (:3100). .staging/staging.json existe. Nada contra prod.
3. [Claude, ya] Script nuevo scripts/staging/capturas-onboarding.mjs, que solo captura. Crea fixtures con crearUsuario() y deja a cada usuario, por SQL de staging, en un estado: nuevo (/bienvenida); onboarding_paso = perfil, intereses y ubicacion; seller_type=business (se salta perfil); es_vendedor sin paso. Además /empezar-a-vender en categoria, tipo, negocio, activar y listo, y /activar-notificaciones en web ('no-nativo').
4. [Claude, ya] Capturas a 375x667, 390x844, 430x932, 768x1024 y 1280x800, en claro y oscuro, guardadas en .staging/e2e/onboarding/<pantalla>-<ancho>-<tema>.png. Esperar a que la página hidrate antes de cada clic. Terminar con limpiar() y exigir que queden 0.
5. [Claude, ya] Inventario por pantalla (ruta, archivo, estados, componentes) con las inconsistencias verificadas en el código: (1) en Bienvenida, <Button> con !bg-[#121212], dark:!bg-[#F4F1EB] y rounded-xl, frente a los <button> crudos con rounded-2xl y bg-[color:var(--brand)] del resto del flujo: son dos familias de botón primario. (2) Las flechas de regresar son ChevronLeft h-5 w-5 sin padding (el área táctil queda por debajo de 44 px) y no migraron a components/ui/boton-regresar.tsx (b72724f). (3) Los inputs difieren: bg-elev-2, text-sm y ring en perfil; bg-muted, text-base y ring-primary/40 en el alta. (4) El banner de error lleva un rgba fijo repetido en 3 archivos. (5) El h1 de Bienvenida usa font-outfit, que no es utilidad del tema. (6) Solo activar-notificaciones tiene loading.tsx. (7) El layout usa min-h-screen, contenido centrado y ningún safe-area.
6. [Claude, ya] Contrato funcional que el rediseño no puede cambiar: el layout del marketplace manda a /bienvenida si has_seen_onboarding=false. /bienvenida reanuda leyendo onboarding_paso y luego es_vendedor. La bandera solo se gasta en completeOnboarding del último paso. No hay 'x' ni 'saltar'. 'Quiero vender' no escribe nada. Los destinos de /activar-notificaciones son una lista cerrada. El CHECK profiles_onboarding_paso_check solo admite perfil, intereses y ubicacion, así que un paso nuevo exige migración. Nombre, bio y foto son obligatorios. Un negocio se salta el paso de perfil.
7. [Claude, ya] Hallazgo funcional, separado del rediseño y remitido a S02B-matriz-acceso: ChangeLocationSheet en completar-perfil.tsx no tiene quien la abra desde b4718dd. setHojaZonaAbierta(true) no existe y la rama zonaAMano está muerta. Hay que decidir si se quita o si se restaura 'elegir zona a mano'.
8. [Claude, ya] Publicar el paquete en Notion, en una página hija de la jornada que enlace RED-onboarding, con las capturas y el inventario. En docs/PENDIENTES-2026-09-26.md, una línea con el enlace. Sin tocar código de la app.
9. [Pedro/Javier] Cerrar DEC-muro-entrada (¿el visitante sin sesión ve login al abrir la app?) y decidir la posición del paso de estudiante (S09-UI-estudiante): ¿tras intereses?, ¿opcional?, ¿o se deja un hueco reservado?
10. [Javier] Bocetos de cada pantalla y estado en los 5 anchos, claro y oscuro: botón primario y secundario, regresar, inputs, banner de error, carga y mapa. Aprobación escrita en Notion, alineada con los fundamentos BB01/BB02.
11. [Claude, tras la aprobación] Rama feat/onboarding-visual desde master. Cambiar solo JSX y clases de los archivos listados. Usar BotonRegresar y los tokens del tema; ningún hex nuevo.
12. [Claude] Barrera del diff: git diff master --stat no debe tocar ninguna actions.ts ni las líneas de guard y redirect de los page.tsx, ni los ids nav-*. Si Javier pide cambiar el orden de pasos, eso sale de este ticket y pasa a S02B/S09 con migración.
13. [Claude] Capturas después del cambio con el mismo script y los mismos tamaños, lado a lado con las de antes, para la aprobación final de Javier.
14. [Pedro] Autorizar el merge a master y el despliegue. Smoke de solo lectura en prod. Prueba en iPhone y Android.

## Archivos

- apps/web/app/(onboarding)/layout.tsx
- apps/web/app/(onboarding)/bienvenida/page.tsx
- apps/web/app/(onboarding)/bienvenida/onboarding-options.tsx
- apps/web/app/(onboarding)/completar-perfil/page.tsx
- apps/web/app/(onboarding)/completar-perfil/completar-perfil.tsx
- apps/web/app/(onboarding)/activar-notificaciones/pedir-permiso.tsx
- apps/web/app/(onboarding)/activar-notificaciones/loading.tsx
- apps/web/app/(onboarding)/empezar-a-vender/alta-vendedor.tsx
- apps/web/components/map/onboarding-location-map.tsx
- apps/web/components/ui/boton-regresar.tsx (solo se consume)
- NUEVOS si Javier diseña la carga: apps/web/app/(onboarding)/{bienvenida,completar-perfil,empezar-a-vender}/loading.tsx
- NUEVO: scripts/staging/capturas-onboarding.mjs
- NUEVO: scripts/staging/e2e-onboarding.mjs
- SOLO LECTURA, no se tocan: apps/web/app/(onboarding)/completar-perfil/actions.ts, apps/web/app/(onboarding)/empezar-a-vender/actions.ts, apps/web/app/(marketplace)/layout.tsx (guard, línea 128), apps/web/lib/supabase/middleware.ts, supabase/migrations/20260905100000_onboarding_por_pasos.sql
- docs/PENDIENTES-2026-09-26.md (una línea con el enlace al paquete)

## Pruebas

- Base del paquete (fase A): capturas-onboarding.mjs genera todas las combinaciones pantalla x ancho x tema y limpiar() devuelve 0. Evidencia en .staging/e2e/onboarding/.
- Estáticas: pnpm --filter web exec tsc --noEmit, pnpm --filter web lint (0 errores), pnpm --filter web build, bash scripts/check-no-white-bg.sh y node scripts/check-rutas.mjs.
- No hay test unitario nuevo porque no cambia lógica. Se vuelven a correr con tsx scripts/test-destino-seguro.ts y scripts/test-s02a-browser.ts, que cubren la entrada desde auth.
- Playwright existentes: tests/notificaciones.spec.ts (destinos cerrados y botón principal según el permiso) y tests/navegacion.spec.ts (ids nav-*).
- E2E nuevo scripts/staging/e2e-onboarding.mjs contra :3100 y staging: (1) Explorar completo: bienvenida → notificaciones → perfil → intereses → ubicación → '/'; al final se lee como postgres has_seen_onboarding=true y onboarding_paso=null. (2) Reanudación: cerrar en intereses y reabrir '/' lleva a /completar-perfil en intereses. (3) Vender arrepentido: 'Quiero vender' y luego atrás muestra los 2 botones y no escribe ninguna fila. (4) Un negocio arranca en intereses. (5) /activar-notificaciones?siguiente=https://example.com termina en /completar-perfil. (6) Ninguna ruta rebota más de 2 redirecciones. limpiar()=0.
- Smoke en prod, solo lectura, tras el despliegue autorizado: sin sesión, GET /bienvenida, /completar-perfil, /empezar-a-vender y /activar-notificaciones redirigen a /login (con next en empezar-a-vender).
- Dispositivo (Pedro/Javier): iPhone con safe-area, teclado sobre bio y nombre de negocio, MapKit (tocar, arrastrar, GPS denegado y buscador) y permiso push nativo en sin-pedir, concedido y denegado. Comprobar que la cápsula nativa de CromoNativo no aparece sobre el onboarding. Repetir en Android.

## Riesgos

- Si el rediseño toca guards o actions, vuelven los bucles de redirección ya corregidos (2e6b7c7, 227f685, saga 42501). Mitigación: el diff queda limitado a JSX y clases, y el e2e de reanudación lo vigila.
- Diseñar antes de DEC-muro-entrada o de la decisión del paso de estudiante obliga a rehacer la pantalla de entrada y el orden de pasos.
- Un paso nuevo necesita migración del CHECK y GRANT por columna en profiles. Sin GRANT, todo SELECT de profiles da 42501 (causa raíz histórica).
- Cambiar textos o ids rompe tests/notificaciones.spec.ts y los ids nav-*.
- E2E con falsos verdes: un clic antes de hidratar se pierde en silencio, y si se inyecta .value se salta maxLength. Usar la marca de 'listo' y execCommand('insertText').
- Fixtures: los usuarios de staging deben terminar con limpiar()=0. Nunca en prod, nunca cuentas reales ni el seed excluido.
- La hoja de zona muerta en completar-perfil puede confundir el rediseño del paso de ubicación. Hay que decidir si se quita o se restaura (S02B), no esconderlo.
- Las capturas web no prueban el comportamiento nativo (Liquid Glass, permiso push y MapKit en WKWebView): hace falta el dispositivo.

## Requiere antes

- DEC-muro-entrada decidida por Pedro/Javier (condiciona la pantalla de entrada y el retorno tras login).
- Posición del paso de estudiante (S09-UI-estudiante), o el acuerdo de dejar un hueco reservado. Un paso real exige migrar profiles_onboarding_paso_check con autorización de Pedro y pasar antes por staging.
- Fundamentos BB01/BB02 de Javier (familias de botón, regresar e inputs) para no diseñar el onboarding aparte.
- Staging vivo (.staging/staging.json) y la web local en :3100 para la fase A.
- Aprobación escrita de Javier en Notion antes de la fase C. Autorización de Pedro para el merge y el despliegue a prod.
- iPhone y Android con el build candidato para la prueba final.

**Responsable:** Javier (diseño y aprobación). Claude prepara el paquete (fase A) e implementa tras la aprobación (fase C). Pedro decide DEC-muro-entrada, autoriza el despliegue y prueba en dispositivo.

**Estimación:** Fase A (Claude): 2-3 h. Fase B (Javier): no la estima Claude. De referencia, Notion calcula 1-3 h por pantalla o flujo, unas 4-8 h para 4 rutas. Fase C (Claude): 4-6 h de implementación, más 1-2 h de e2e y capturas, más 30-45 min de smoke y dispositivo. En total, unas 8-11 h de Claude más el tiempo de Javier.

**Ejecutable por Claude ahora:** sí
