# Plan PT07-badge-unregistered

**Pendiente:** PT07: badge real (hoy fijo en 1) y limpieza de tokens UNREGISTERED en send-push

**Fuentes en Notion:** A l.21,84 (PT07-badge-tokens-unregistered); B l.254-261 (PT07-A02-ios-push); C l.425 (PT07-auditar-eventos-notificaciones, remediación)

**Estado conciliado (26-sep ~23:30):** pendiente. Verificado: supabase/functions/send-push/index.ts:290 tiene 'badge: 1' y no hay manejo de UNREGISTERED. Lee profiles.fcm_token en l.241-263.

**Qué falta:** Plan: (1) si FCM responde 404/UNREGISTERED, poner fcm_token = null solo en el perfil con ese token; (2) badge = no leídas del destinatario con un count head; (3) deno test con fetch simulado; (4) Pedro lo despliega junto con PT07-send-push-deploy.

## Objetivo

Que send-push mande en aps.badge el número real de pendientes del destinatario (hoy siempre dice 1, index.ts:290) y que, cuando FCM responda 404 con UNREGISTERED, ponga profiles.fcm_token en NULL solo en ese perfil y solo si sigue siendo el mismo token (hoy ese caso sale como 500 genérico, index.ts:307-311). No se toca la puerta de autorización (l.88-107), ni las preferencias (l.179-236), ni nada visual.

## Pasos

1. PASO 0, solo lectura en staging y en prod: confirmar que service_role puede hacer UPDATE en profiles.fcm_token con has_column_privilege('service_role','public.profiles','fcm_token','UPDATE'); profiles usa GRANT por columna. Revisar también qué triggers BEFORE UPDATE tiene profiles: profiles_updated_at no estorba. Confirmar las columnas notifications(user_id, leida, tipo) y chats(comprador_id, vendedor_id, no_leidos_comprador, no_leidos_vendedor).
2. git fetch y rama fix/pt07-badge-tokens desde master (4f5577b). Verificar que nadie tocó send-push después de 9f1ab8d.
3. Crear supabase/functions/send-push/avisos.ts, sin imports remotos para que corra en Deno y con tsx. Lleva cuatro funciones: (a) contarNoLeidos(db, userId): number|null. Lanza 3 consultas en paralelo igual que apps/web/app/(marketplace)/layout.tsx:70-83: count head de notifications con leida=false y tipo<>'message', más la suma de no_leidos_comprador y la de no_leidos_vendedor en chats. Devuelve null si falla cualquiera. (b) construirAps(titulo, cuerpo, badge): si badge es null OMITE la clave, porque iOS entonces deja el globo como está; si no, lo recorta a entero ≥0. (c) esTokenMuerto(status, cuerpoTexto): true solo si status es 404 y en error.details hay errorCode === 'UNREGISTERED'. Parsea el cuerpo con try, porque puede no ser JSON. (d) soltarTokenMuerto(db, userId, token): update profiles set fcm_token=null where id=userId and fcm_token=token, con select('id') para contar filas. El cliente se recibe con un tipo estructural mínimo, sin importar esm.sh.
4. Editar supabase/functions/send-push/index.ts. Importar './avisos.ts'. Después del chequeo de token (l.245-250), lanzar contarNoLeidos en paralelo con getGoogleAccessToken. Cambiar el bloque apns.payload.aps (l.284-292) por construirAps y conservar sound y content-available. Cambiar l.307-311: leer response.text(). Si esTokenMuerto, llamar soltarTokenMuerto. Si el UPDATE sale bien: console.warn con receiverId y filas, NUNCA el token, y respuesta 200 {ignored:true, reason:'Token unregistered, cleared'}. Si el UPDATE falla: console.error y 500 'FCM unregistered, cleanup failed'. Cualquier otro error de FCM (400 INVALID_ARGUMENT, 403 SENDER_ID_MISMATCH, 5xx) sigue siendo 500 sin tocar el token.
5. Pruebas unitarias en scripts/test-send-push-avisos.ts con ./node_modules/.bin/tsx, que es la convención del repo: jiti no está instalado. Usar un db falso y cuerpos reales de FCM (ver pruebas).
6. deno check supabase/functions/send-push/index.ts para que el grafo con './avisos.ts' compile en Deno 2.9.6, y deno lint del directorio.
7. E2E de staging en scripts/staging/e2e-push-badge.mjs, corrido con tsx para poder importar avisos.ts. Con fixtures.mjs crear 2 usuarios @staging.vicino.test y un chat entre ellos. Por SQL de staging: no_leidos_vendedor=3; notifications [FIXTURE] con 2 leida=false, 1 leida=true y 1 tipo='message' leida=false; fcm_token='STAGING-FAKE-A'. Usar un supabase-js con la service key DEL STAGING y assertNoProd antes de todo. Afirmar: contarNoLeidos=5; soltarTokenMuerto con 'STAGING-FAKE-B' da 0 filas y el token sigue; con 'STAGING-FAKE-A' da 1 fila y queda NULL; el perfil del otro usuario no cambia. Terminar con limpiar().
8. Opcional si el permiso lo deja: desplegar send-push SOLO al ref de staging para comprobar que se empaqueta con el import relativo. Hay dos pruebas. POST sin auth debe dar 401. POST con la service key de staging y un INSERT de messages del fixture debe llegar a 500 'Missing FIREBASE_SERVICE_ACCOUNT', que demuestra que corrió todo lo anterior. Staging no tiene Firebase, y el secreto de prod no se copia.
9. Bucle CODEX adversarial (área de máxima prioridad: mensajes y push) y reporte final. Commit convencional 'fix(push): badge real y limpieza de tokens UNREGISTERED en send-push (PT07)'. Push de la rama, ff-merge a master y push. Vercel no despliega las funciones de Supabase.
10. Entrega a Pedro, que despliega. Si prefiere, primero despliega 9f1ab8d solo (PT07-send-push-deploy) y lo prueba, y después esto: `supabase functions deploy send-push --project-ref oxxdkwywprkfghhbnoto --no-verify-jwt`. Para revertir: volver a desplegar desde 9f1ab8d con `git checkout 9f1ab8d -- supabase/functions/send-push`.
11. Smoke de solo lectura en prod después del despliegue. POST sin Authorization debe seguir en 401. Antes de 6 h, net._http_response debe mostrar 200 {success:true} en los envíos, y si aparece 'Token unregistered, cleared', contar los perfiles con token para ver que solo bajó uno.
12. Actualizar docs/PENDIENTES-2026-09-26.md (PT07, línea 226) y la página de Notion de la jornada con el commit y la evidencia. Abrir aparte el pendiente del reinicio del globo en el cliente (ver riesgos) para coordinarlo con Javier.

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/supabase/functions/send-push/index.ts
- C:/Users/pedro/Projects/startup-marketplace/supabase/functions/send-push/avisos.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/test-send-push-avisos.ts (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/staging/e2e-push-badge.mjs (nuevo)
- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md
- C:/Users/pedro/Projects/startup-marketplace/apps/web/app/(marketplace)/layout.tsx (referencia de la semántica de no leídas, l.70-83; no se edita)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/ios/App/App/AppDelegate.swift (seguimiento de Javier: applicationDidBecomeActive l.66; no se edita en este pendiente)

## Pruebas

- Unitarias (tsx scripts/test-send-push-avisos.ts). esTokenMuerto: 404 + details[{'@type':'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode:'UNREGISTERED'}] da true. Dan false: 404 sin details, 400 INVALID_ARGUMENT, 403 SENDER_ID_MISMATCH, 500, cuerpo HTML no JSON y cuerpo vacío.
- Unitarias de contarNoLeidos con db falso: 2 notificaciones + 1 de comprador + 4 de vendedor dan 7; sin filas da 0; un error en cualquiera de las 3 consultas da null; los no_leidos en null cuentan 0.
- Unitarias de construirAps: con badge null no existe la clave 'badge'; 7 da badge 7; -1 o 3.7 quedan en 0 y 3; sound 'default', content-available 1 y alert title/body siguen igual.
- Unitarias de soltarTokenMuerto con db falso: comprobar que el filtro es exactamente id=userId Y fcm_token=token (compare-and-set) y que un error del UPDATE sube como fallo, no como éxito.
- deno check supabase/functions/send-push/index.ts sin errores.
- E2E de staging con scripts/staging/e2e-push-badge.mjs: badge 5 contra el esquema real, token equivocado deja 0 filas, token correcto deja 1 fila y NULL, el otro perfil no cambia, y limpiar() deja 0 fixtures.
- Smoke de solo lectura en prod después de que Pedro despliega: 401 sin auth y net._http_response dentro de las 6 h.
- En dispositivo, cuando haya iPhone con TestFlight 1.1 (6) y dos cuentas de prueba: con la app en segundo plano, 2 mensajes de A a B hacen que el ícono de B marque sus pendientes reales (no 1). Después de leer el chat, el siguiente mensaje marca 1.

## Riesgos

- Borrar tokens válidos por clasificar mal. Mitigación: solo 404 con errorCode UNREGISTERED y filtro compare-and-set id+token. Nunca con INVALID_ARGUMENT, que puede venir de un error de nuestro payload, ni con SENDER_ID_MISMATCH, que con una cuenta de servicio mal rotada vaciaría todos los tokens.
- El token borrado se recupera solo: usePushNotifications lo vuelve a registrar al abrir la app. Pero si FCM declarara UNREGISTERED en falso, esa persona no recibe push hasta que vuelva a abrir la app.
- El globo se queda viejo. No hay reinicio en el cliente: sin plugin de badge y sin código en AppDelegate.swift, así que después de leerlo todo el ícono conserva el último número hasta el siguiente push. Esto ya pasa hoy con el 1 fijo, pero ahora el número será mayor. Arreglarlo exige código nativo iOS, build nuevo y la Mac: se coordina con Javier como seguimiento y no bloquea.
- La semántica debe coincidir con lo que la app muestra: se copia layout.tsx. leida en NULL no cuenta (.eq false) y los chats ocultos sí cuentan. Si Javier o Alejandro cambian esa regla en la app, esta sería otra copia que hay que vigilar, y se deja comentada como tal.
- Si falla el conteo, se omite badge (no se manda 0 ni 1) y se registra. El push sale igual.
- Latencia: son 3 consultas más, pero van en paralelo con el OAuth de Google, así que el costo neto es casi cero.
- Desplegar junto con 9f1ab8d mezcla dos cambios, y si algo se rompe no se sabe cuál fue. Se recomienda desplegar por separado o tener lista la reversión desde 9f1ab8d.
- Empaquetado del edge runtime con el import relativo: se cubre con deno check y, si el permiso lo deja, con un despliegue solo a staging.
- Android no usa aps.badge, así que no cambia. android.notification.notification_count queda fuera de alcance.

## Requiere antes

- Ninguno para el código, las unitarias ni el e2e de staging.
- Autorización explícita de Pedro para desplegar send-push a prod. Conviene que vaya después o junto con PT07-send-push-deploy (9f1ab8d), que ya está bloqueado para Claude por el clasificador.
- Para la prueba en dispositivo: iPhone con TestFlight 1.1 (6) y dos cuentas de prueba dedicadas, nunca reales.
- El PASO 0 debe confirmar que service_role tiene UPDATE en profiles.fcm_token; si no, la limpieza falla con 42501 y hace falta una migración de GRANT con firma de Pedro.

**Responsable:** Claude (código, unitarias, staging); Pedro (despliegue a prod y smoke autorizado); Javier (reinicio del globo en iOS, como seguimiento)

**Estimación:** Unas 3 h de Claude: 1.5 h de código y unitarias, 1 h del e2e de staging, 0.5 h de revisión CODEX, commit y documentación. Más 10 min de Pedro para desplegar y 20 min de prueba en dispositivo cuando haya iPhone y cuentas de prueba.

**Ejecutable por Claude ahora:** sí
