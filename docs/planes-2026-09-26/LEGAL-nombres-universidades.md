# Plan LEGAL-nombres-universidades

**Pendiente:** Revisión legal: uso de 'Universidad Anáhuac' y otros nombres y colores institucionales

**Fuentes en Notion:** F l.1564-1568 (LEGAL-nombre-anahuac); H l.26 (H26-revision-legal-anahuac); G l.1733-1736 (G-estudiantes-funcional, legal); B l.334-341 (PT10-S09-contrato-estudiante, legal)

**Estado conciliado (26-sep ~23:30):** decision. Inicio y Fin siguen en [Pendiente]. Ya está en prod: lib/utils.ts:8-18 (UNIVERSITY_COLORS, 9 universidades), verification-upload.tsx:81-91, buscar/page.tsx:423 (título = nombre) y home-category-order.tsx:84 y 105.

**Qué falta:** Plan: (1) Claude arma la ficha de hechos con todas las apariciones del nombre y del color institucional. (2) Pedro consulta a un abogado de propiedad industrial (LFPPI): uso descriptivo de la universidad verificada del propio usuario frente a categoría o colores que sugieran afiliación. (3) Mitigación provisional a decidir: etiqueta neutra, sin color institucional y con leyenda de no afiliación (el visual es de Javier). (4) Resolver antes de capturas y A04 (2-oct) y registrar Inicio y Fin.

## Objetivo

Tener antes de las capturas y de A04 (2-oct 16:00) un dictamen legal escrito sobre dos cosas: (1) el uso de los nombres y colores institucionales de 9 universidades, y (2) la solicitud de la credencial de estudiante, que es la segunda mitad del pendiente ⚖️ 4 de Notion. Si el dictamen no llega a tiempo, aplicar una mitigación provisional decidida por Pedro y Javier. Claude solo prepara la ficha de hechos y, si se aprueba, la implementación técnica. No da asesoría legal.

## Pasos

1. 1. Claude, hoy, en solo lectura sobre master 4f5577b. Marcar Inicio en la bitácora del pendiente ⚖️ 4 de la jornada del 26-sep. Armar la ficha de hechos como bloque bajo ese pendiente, con copia en docs/PENDIENTES-2026-09-26.md.
2. 2. Ficha, parte A: dónde aparece el NOMBRE. apps/web/app/seller/verificacion/verification-upload.tsx:81-91 tiene la lista de 9 universidades y en :225 BUAP viene preseleccionada. apps/web/app/(marketplace)/buscar/page.tsx:423 y :469-472 usan el nombre como título. apps/web/app/(marketplace)/home-session.tsx:127 y :151 lo ponen en el encabezado de las filas campus y en el mensaje de vacío. apps/web/components/home/home-category-order.tsx:84 (mensaje de vacío) y :105 (aria-label). apps/web/components/shared/filtro-categorias-drawer.tsx:271. En el panel de admin, admin/verifications/page.tsx:152-154.
3. 3. Ficha, parte B: dónde aparece el COLOR. apps/web/lib/utils.ts:8-19 define UNIVERSITY_COLORS. Se aplica por universityStyle (apps/web/lib/university.ts:7-10) en home-category-order.tsx:106 y filtro-categorias-drawer.tsx:267. Se aplica DIRECTO, sin pasar por universityStyle, en home-session.tsx:176-205 (bloque 'Comunidad Universitaria') y en verification-upload.tsx:1120-1127. Los commits 774f8f2 y 5f66b70 (Javier, 1-jun) los describen como 'exact official hex colors'.
4. 4. Ficha, parte C: quién lo ve. Solo el propio usuario con credencial aprobada, según getViewerUniversity en apps/web/lib/university-data.ts:8-17. El visitante nunca lo ve y el nombre no sale en perfiles públicos ni en tarjetas. El uso publicitario vendría de la captura SS4 'Vende en tu Universidad' (.claude/skills/store-asset-composer/SKILL.md:50). Aparte, hay contenido de usuarios: la comunidad 'Nenis Anahuac' (supabase/migrations/20260916140000..., línea 1365 en adelante).
5. 5. Ficha, parte D: textos legales vigentes y sus huecos. En apps/web/app/(marketplace)/terminos/page.tsx, el §8 (l.68-70) promete verificar con correo .edu.mx, que no existe en el código, y el §10 (l.81) dice que marcas y logotipos de la Plataforma son de VICINO o de sus licenciantes, sin cláusula de no afiliación. En apps/web/components/legal/aviso-privacidad-cuerpo.tsx, la tabla de transferencias (l.176-206) no lista a OpenAI aunque apps/web/app/actions/verify-document.ts:530-546 le envía la credencial; §15 (l.316) solo nombra 'INE y selfie'; y l.37 y l.49 citan al INAI y los Lineamientos de 2013 (hay que confirmar con el abogado la ley vigente, que cambió en 2025).
6. 6. Claude: añadir a la ficha un cuestionario para el abogado. (a) ¿Mostrar a cada usuario el nombre de su propia universidad verificada es un uso descriptivo permitido sin licencia? (b) ¿El color institucional como fondo de chip o bloque sugiere afiliación? (c) ¿Una categoría de filtro con el nombre cuenta como uso en el comercio? (d) ¿Qué texto de no afiliación hace falta y dónde? (e) ¿Se pueden usar el nombre o el color en las capturas de App Store y Play, a la luz de la guideline 5.2.1? (f) ¿Cómo retirar comunidades de usuarios que usan el nombre? (g) Credencial de estudiante: base de consentimiento, trato como dato sensible, OpenAI como encargado y plazo de conservación.
7. 7. Pedro: llevar la ficha a un abogado de propiedad industrial (LFPPI/IMPI) y datos personales, y pedir el dictamen por escrito y con fecha. Registrar la fecha de la consulta en Notion.
8. 8. Pedro y Javier, a más tardar el 30-sep: elegir la mitigación provisional. A) Dejarlo igual hasta el dictamen, sin captura SS4 con universidad real. B) Quitar el color institucional, conservar el nombre como texto y añadir la leyenda 'VICINO no está afiliada a {universidad}'. C) Mostrar 'Tu universidad' en Home y Búsqueda y dejar el nombre solo en verificación. Javier entrega el token de color neutro, el texto de la leyenda y dónde va, porque lo visual es suyo.
9. 9. Claude, solo si se aprueba B o C, en la rama fix/universidad-neutra. Convertir universityStyle (apps/web/lib/university.ts) en el único punto que decide el color. Cambiar los usos directos de home-session.tsx:176-205 y verification-upload.tsx:1120-1127 para que pasen por universityStyle. Retirar UNIVERSITY_COLORS de lib/utils.ts. Poner la leyenda donde indique Javier. No tocar seller_verification.university_name ni getUniversitySellerIds: comparan por igualdad exacta y es presentación, no dato.
10. 10. Claude, solo con la redacción del abogado: terminos/page.tsx §8 y §10, y aviso-privacidad-cuerpo.tsx (añadir OpenAI a la tabla de transferencias y la credencial universitaria al §15). Si el cambio es sustancial, publicar una versión nueva en legal_documents con 30 días de preaviso (lo exige el CHECK legal_documents_preaviso_30_dias). Esa escritura va a producción y necesita la autorización de Pedro.
11. 11. Capturas: no tomar SS4 ni el paquete A04 con el nombre o el color de una universidad real hasta que haya dictamen o mitigación en producción. Tampoco inventar una universidad falsa en las capturas.
12. 12. Push a master, que despliega a producción, solo con la autorización explícita de Pedro. Después, registrar Fin en la bitácora de Notion, D01 y docs/PENDIENTES-2026-09-26.md.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/utils.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/university.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/university-data.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/home-session.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/home/home-category-order.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/shared/filtro-categorias-drawer.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/buscar/page.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/seller/verificacion/verification-upload.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/actions/verify-document.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/terminos/page.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/legal/aviso-privacidad-cuerpo.tsx
- C:/Users/pedro/Projects/startup-marketplace/supabase/migrations/20260826380000_registro_y_aviso_de_cambios_legales.sql
- C:/Users/pedro/Projects/startup-marketplace/scripts/test-university.ts
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-campus-home.mjs
- C:/Users/pedro/Projects/startup-marketplace/.claude/skills/store-asset-composer/SKILL.md
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md

## Pruebas

- Ficha completa: `git grep -n -E "UNIVERSITY_COLORS|universityStyle|viewerUniversity|UNIVERSITIES" -- apps/web` sobre 4f5577b. Toda coincidencia que el usuario pueda ver tiene su fila en la ficha, sin huecos.
- Tras la mitigación: `git grep -n -iE "UNIVERSITY_COLORS|#FF5900|#003B5C|#006F53" -- apps/web` no devuelve nada.
- Unitaria: `npx jiti scripts/test-university.ts` da 20/20. Hay que actualizar la l.104, que hoy exige rgb(255, 89, 0) para Anáhuac, y añadir una aserción de que la leyenda de no afiliación aparece en Home y en el panel de filtros.
- `pnpm build` y `pnpm lint` con exit 0 antes de cualquier push.
- Staging: `node scripts/staging/e2e-campus-home.mjs` da 11/11 (dos universidades, intersección, vacío y fallo), sin regresión funcional, más una comprobación de la leyenda.
- Producción, en solo lectura y tras la autorización: `/`, `/?cats=universidad` y `/buscar?category=universidad` responden 200 como visitante. La vista con universidad se revisa con el usuario sintético de staging, no con cuentas reales.
- Si se publica una versión legal: `select documento, version, sustancial, publicado_en, vigente_desde from legal_documents order by publicado_en desc limit 2` en producción muestra el preaviso correcto.

## Riesgos

- La captura SS4 'Vende en tu Universidad' convierte un uso descriptivo interno en uso publicitario, y es la exposición legal más alta. Además, Apple puede rechazar la app por la guideline 5.2.1.
- home-session.tsx:176-205 y verification-upload.tsx:1120-1127 aplican UNIVERSITY_COLORS sin pasar por universityStyle. Una mitigación que solo cambie lib/university.ts dejaría esas dos superficies con el color institucional.
- scripts/test-university.ts:104 fija los colores RGB oficiales, así que cualquier mitigación rompe esa prueba. Hay que actualizarla y dejar constancia de que no es una regresión.
- Cambiar el valor guardado en seller_verification.university_name rompería getUniversitySellerIds, que compara por igualdad exacta, y el modo campus quedaría vacío. La mitigación debe tocar solo la presentación.
- Quitar el color cambia la apariencia, y eso le toca decidirlo a Javier. Claude no debe elegir el token neutro.
- Añadir a OpenAI como encargado en el Aviso puede ser un cambio sustancial. En ese caso la base exige 30 días entre publicación y entrada en vigor.
- El §8 de Términos promete verificar con correo .edu.mx, algo que no existe. El §10 afirma que las marcas mostradas son de VICINO o de sus licenciantes. Ambos son hallazgos laterales que el abogado debe ver.
- Hay comunidades de usuarios con nombres de universidades ('Nenis Anahuac'). No es un uso de VICINO, pero necesitan un procedimiento de retiro.
- Claude no emite opinión legal: la ficha es solo de hechos y la decisión es de Pedro con asesoría.

## Requiere antes

- Nada para los pasos 1 a 6 (ficha y cuestionario).
- Un abogado de propiedad industrial y datos personales contratado por Pedro.
- La decisión de Pedro y Javier sobre la mitigación (A, B o C), junto con el token de color neutro y el texto y la ubicación de la leyenda definidos por Javier.
- La autorización explícita de Pedro para hacer push a master (producción) y para cualquier fila nueva en legal_documents en producción.
- El usuario sintético de staging con credencial universitaria (ya existe en e2e-campus-home.mjs). Sin cuentas reales ni el seed excluido.

**Responsable:** Pedro, que decide y contrata al abogado. Claude arma la ficha y el cuestionario y hace la implementación técnica si se aprueba. Javier define lo visual de la mitigación.

**Estimación:** Ficha y cuestionario: 1 h de Claude, hoy. Consulta legal: de 1 a 5 días hábiles, externa, a cargo de Pedro. Mitigación técnica: de 2 a 3 h de Claude una vez que haya decisión y el token de Javier. Textos legales: 1 h después de recibir la redacción del abogado, más 30 días de preaviso si el cambio es sustancial. Ruta crítica: dictamen o mitigación en producción antes de A04 (2-oct 16:00).

**Ejecutable por Claude ahora:** sí
