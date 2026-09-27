# Plan LEGAL-credencial-estudiante

**Pendiente:** Revisión legal: pedir la credencial o ID de estudiante al usuario

**Fuentes en Notion:** F l.1564-1566,1569 (LEGAL-credencial-estudiante); H l.26 (H26-revision-legal-anahuac)

**Estado conciliado (26-sep ~23:30):** decision. /seller/verificacion pide una 'Credencial Universitaria'. El bucket verification-documents es privado con políticas de dueño (20260320000017:13-63) y existe purge-verification-documents. aviso-privacidad-cuerpo.tsx:72 menciona la credencial, pero cita la LFPDPPP y al INAI (l.28, 37, 47-49): hay que revisarlo frente a la ley de 2025.

**Qué falta:** Plan: (1) Claude: inventario de qué se pide, quién lo ve, cuánto se conserva y cómo se borra. (2) Pedro con asesor: base legal vigente, consentimiento, finalidad y minimización; actualizar el aviso. (3) Evaluar una alternativa: OTP al correo institucional y borrar la imagen al aprobar. (4) Decidir antes de S09 y registrar Inicio y Fin.

## Objetivo

Que Pedro decida con un asesor, antes de arrancar S09 (onboarding de estudiante), si VICINO puede pedir la credencial o ID de estudiante y en qué condiciones. La decisión se toma sobre un inventario técnico verificado de qué se recaba, quién lo ve, cuánto se conserva y cómo se borra, y deja el Aviso, los Términos y el código alineados con lo que se decida. Inicio y Fin quedan registrados en Notion y en docs/PENDIENTES-2026-09-26.md.

## Pasos

1. 1. Registrar el Inicio con fecha y hora en la página de Notion de la jornada del 26-sep (bloque 2.4, punto 4, 'Bitácora de ejecución') y en docs/PENDIENTES-2026-09-26.md.
2. 2. Claude, en solo lectura: crear docs/LEGAL-credencial-estudiante-inventario.md con una tabla dato → dónde vive → quién lo ve → plazo → cómo se borra, y cada fila con su archivo:línea.
3. 2a. Qué se pide: selfie, frente y reverso de la credencial, y la universidad elegida de una lista cerrada de 9 (verification-upload.tsx:81-91 y 1112-1140). El nombre del perfil entra como dato de cotejo (verify-document.ts:429).
4. 2b. Dónde se guarda: bucket privado verification-documents en la carpeta <uid>/ (20260320000017:13-21 y 56-63). Las columnas de seller_verification son ine_front_url, ine_back_url, selfie_url, document_type, university_name, ai_confidence_score y ai_analysis_raw (verify-document.ts:601-622). El consentimiento se guarda en verification_consent, pero solo el biométrico (privacy.ts:57-59).
5. 2c. Quién lo ve: el dueño, por la RLS del bucket. OpenAI (EE. UU.) recibe las 3 imágenes en base64 con detail high, junto con el nombre y la universidad (verify-document.ts:530-559). Los admins las ven por URL firmada con service_role durante 30 min (admin/verifications/page.tsx:13 y 78-120; guarda en admin/layout.tsx:20-26). El modo campus lee university_name con service_role y solo devuelve ids (lib/university-data.ts), pero aparecer en 'Tu universidad' deja ver la pertenencia a los demás.
6. 2d. Cuánto se conserva: en los trámites resueltos, la purga horaria borra las imágenes en menos de 1 h (purge-verification-documents/index.ts:12-22 y 168-216; cron en 20260825000001:88-99). Los pendientes o con status NULL NO tienen plazo máximo. Los huérfanos se borran a los 90 días (index.ts:48). ai_analysis_raw (nombre_en_documento y observaciones) y university_name se quedan para siempre: la purga solo pone a NULL las 3 URL (index.ts:213-216).
7. 2e. Cómo se borra: la purga horaria, más delete-account (functions/delete-account/index.ts:95-189, best-effort, con storage_cleanup_pending) y delete_user_data, que hace DELETE de seller_verification.
8. 2f. Brechas contra el Aviso, para el asesor:
9. (a) §8 (aviso-privacidad-cuerpo.tsx:167-210) no declara a OpenAI, y eso afecta también al INE.
10. (b) §5.2 (l.127) dice 'única finalidad verificar identidad', pero university_name ya segmenta Home y /buscar (c337ef7).
11. (c) §15 (l.316-317) promete 90 días y solo nombra 'INE y selfie'; la casilla dice lo mismo (verification-upload.tsx:1056), pero los pendientes no tienen tope.
12. (d) La casilla (l.1037-1056) solo consiente la selfie: no menciona la credencial ni el envío a un tercero.
13. (e) §1, §2, §9 y §20 (l.28, 37, 44-53, 239, 385) citan la LFPDPPP de 2010, los Lineamientos de 2013 y al INAI; hay que contrastarlos con la ley de 2025 y con la autoridad vigente (lo confirma el asesor).
14. (f) Términos §8 (terminos/page.tsx:68-69) ofrece correo .edu.mx, que no existe en el producto.
15. 3. Claude: preparar consultas SQL de solo lectura para prod: conteo de seller_verification por status y document_type con alguna URL no nula y su antigüedad mínima; últimas corridas de purge-verification-documents-hourly (cron.job_run_details) y de verification_document_purge_log. Si la Management API sigue dando 401, Pedro las corre y pega el resultado en el documento.
16. 4. Claude: añadir al mismo documento un cuestionario de una página para el asesor:
17. (1) Base de licitud por dato. (2) Si la credencial es dato sensible o solo lo es la selfie/biometría. (3) Si la casilla + verification_consent bastan como consentimiento expreso. (4) Si OpenAI es encargado o transferencia, y si hace falta DPA y declararlo.
18. (5) Si segmentar por universidad es una finalidad nueva. (6) Plazo máximo para los trámites pendientes. (7) Si el cambio es sustancial (Aviso §18, preaviso de 30 días). (8) Estudiantes menores de 18 (§16). (9) Si pedir la credencial a compradores en S09 es proporcional.
19. 5. Claude: especificar la alternativa, sin código. OTP al correo institucional, con una lista de dominios por universidad VERIFICADA (no inventada), envío por Resend y no por Auth (tope de 2 correos/h sin SMTP), columnas nuevas con GRANT en la misma migración y cuota en la base (Upstash es no-op). Compararla con lo que ya existe: las imágenes ya se borran en menos de 1 h al resolver; lo que falta es poner tope a los pendientes y no guardar nombre_en_documento.
20. 6. Pedro con el asesor: sesión con el inventario y el cuestionario; dictamen por escrito, punto por punto. Pedro y Javier deciden además si el modo campus sigue activo en prod mientras tanto (hay 1 credencial aprobada). El uso del nombre 'Universidad Anáhuac' es otro pendiente (marca), aunque puede ir en la misma sesión.
21. 7. Tras el dictamen, Claude implementa en una rama sin tocar la apariencia: textos de aviso-privacidad-cuerpo.tsx (§1, §2, §4.1, §4.2, §5.2, §8, §9, §15, §20), solo el texto de la casilla en verification-upload.tsx:1037-1056, terminos/page.tsx §7-§8 si aplica, y subir versión y fecha en packages/shared/src/constants/privacy.ts (2.2 → 2.3).
22. 8. Nueva migración con INSERT en legal_documents. Si el cambio es sustancial, vigente_desde debe quedar al menos 30 días después de la publicación; el CHECK de 20260826380000 lo impone. Aplicarla en prod requiere autorización de Pedro.
23. 9. Minimización, si el dictamen la pide: en verify-document.ts:619 guardar ai_analysis_raw sin nombre_en_documento ni observaciones libres (con una función pura en lib/verificacion/ para poder probarla). Poner tope a los pendientes en purge-verification-documents/index.ts, primero con dry_run en staging. Desplegar solo con la firma de Pedro: es código recuperado del bundle, ver su README.
24. 10. Registrar el Fin en Notion y en PENDIENTES, con enlace al dictamen y al commit. S09 no arranca sin este cierre.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/docs/LEGAL-credencial-estudiante-inventario.md (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md
- C:/Users/pedro/Projects/startup-marketplace/apps/web/components/legal/aviso-privacidad-cuerpo.tsx
- C:/Users/pedro/Projects/startup-marketplace/packages/shared/src/constants/privacy.ts
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/terminos/page.tsx
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/seller/verificacion/verification-upload.tsx (solo texto de la casilla, l.1037-1056)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/actions/verify-document.ts (l.619, minimización de ai_analysis_raw)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/lib/verificacion/analisis.ts
- C:/Users/pedro/Projects/startup-marketplace/supabase/functions/purge-verification-documents/index.ts (tope a pendientes, solo con firma de Pedro)
- C:/Users/pedro/Projects/startup-marketplace/supabase/migrations/<nueva>_aviso_2_3_legal_documents.sql
- Solo lectura, como evidencia: apps/web/lib/university-data.ts, apps/web/app/admin/verifications/page.tsx, apps/web/app/admin/layout.tsx, supabase/migrations/20260320000017_storage_buckets.sql, 20260825000001_verification_document_purge.sql, 20260826380000_registro_y_aviso_de_cambios_legales.sql, supabase/functions/delete-account/index.ts

## Pruebas

- Inventario: cada afirmación lleva archivo:línea comprobable. Para el control, grep -n 'OpenAI' apps/web/components/legal/aviso-privacidad-cuerpo.tsx hoy devuelve 0, lo que confirma la brecha (a).
- Solo lectura en prod (Pedro o Claude con acceso): SELECT status, document_type, count(*), min(created_at) FROM seller_verification WHERE coalesce(ine_front_url, ine_back_url, selfie_url) IS NOT NULL GROUP BY 1, 2; más las últimas corridas del job purge-verification-documents-hourly y de verification_document_purge_log.
- Tras cambiar el Aviso: node scripts/check-legal-versions.mjs sale 0; pnpm type-check, pnpm lint y pnpm build en verde.
- Smoke de solo lectura en prod tras el deploy autorizado: GET https://vicinomarket.com/privacidad muestra la versión nueva y declara al proveedor de análisis. El modal de /seller/verificacion muestra el mismo texto.
- Unitarias: npx tsx scripts/test-veredicto-verificacion.ts sigue verde. Si se hace la minimización, un nuevo scripts/test-analisis-minimo.ts (node:test) comprueba que lo que se guarda en ai_analysis_raw no contiene nombre_en_documento.
- Staging: purge-verification-documents con {"dry_run":true} y un fixture sintético pendiente con más antigüedad que el tope: lo reporta y no borra nada. Nunca contra prod.
- Regresión en staging: node scripts/staging/e2e-campus-home.mjs sigue 11/11 si se toca algo de university_name.

## Riesgos

- Hoy en prod, las 3 imágenes (credencial o INE y selfie) se envían a OpenAI en EE. UU. y el §8 del Aviso no lo declara. Es una exposición real, no hipotética, y alcanza también al INE.
- El modo campus ya está en prod (c337ef7) y usa university_name para segmentar, mientras el §5.2 del Aviso dice 'única finalidad: verificar identidad'.
- Los trámites pendientes conservan las imágenes sin plazo, aunque el §15 y la casilla prometen 90 días. ai_analysis_raw (con nombre_en_documento) se conserva indefinidamente.
- Si el asesor califica el cambio como sustancial, el preaviso de 30 días (CHECK de legal_documents) retrasa S09.
- Cambiar el texto de la casilla o del Aviso sin subir la versión deja consentimientos registrados contra un texto distinto.
- purge-verification-documents es código recuperado del bundle: redesplegarlo sin comparar puede borrar documentos de más, de forma irreversible.
- Alternativa OTP: una lista de dominios no verificada aprobaría a quien no es estudiante. Además, el correo de Auth sin SMTP propio está topado a 2 correos por hora.
- Claude no da asesoría legal: el inventario es técnico. La base de licitud y la lectura de la ley de 2025 las fija el asesor.
- El uso de la marca 'Universidad Anáhuac' es otro pendiente: no mezclarlo en este cierre.

## Requiere antes

- Asesor legal identificado y cita agendada (Pedro).
- Lectura de la base de prod: la Management API dio 401 en esta sesión. Si sigue así, Pedro corre las consultas preparadas.
- Decisión de Pedro y Javier sobre si el modo campus sigue activo en prod durante la revisión.
- Autorización explícita de Pedro para la migración de legal_documents, el deploy del Aviso y cualquier redeploy de purge-verification-documents.
- Que el cierre de este punto sea condición previa para arrancar S09 (onboarding de estudiante).

**Responsable:** Pedro (decisión con asesor legal); Claude prepara el inventario, el cuestionario y los cambios de texto y código tras el dictamen

**Estimación:** Claude: 2-2.5 h hoy para el inventario, las consultas y el cuestionario. Pedro con el asesor: una sesión de 1-2 h más la espera del dictamen (días, ajena al equipo). Tras el dictamen: 3-4 h de Claude para textos, versión, migración y pruebas. Si el cambio es sustancial, la versión nueva entra en vigor como mínimo 30 días naturales después de publicarse.

**Ejecutable por Claude ahora:** sí
