# Revisión de pendientes de la jornada del 26-sep-2026

Corte: 26-sep ~23:30 CDMX. Fuente: páginas de Notion de la jornada (3de98e8a…) y Bugs y Tareas Pendientes, conciliadas contra master 4f5577b por un workflow de 44 agentes (lectura por tramos, conciliación con git y código, fusión de duplicados, planes, crítico). Solo lectura: nada se modificó al revisarlo.

Conteo: 21 hecho, 50 pendiente, 19 decision, 4 bloqueado, 14 parcial, 4 informativo. Planes nuevos: 26 (un archivo por plan en esta carpeta).

| Prio | ID | Pendiente | Estado | Responsable | Bloqueo | Plan |
|---|---|---|---|---|---|---|
| P0 | ANDROID-prueba-cerrada | PT08 Android: AAB 8 en prueba cerrada, verificación de desarrollador antes del 30-sep y verificadores reales | ⬜ pendiente | Pedro | acceso externo (Play Console) | en Notion/repo |
| P0 | FIX-cromo-modales | Bug P0 iOS: el formulario '+' de Solicitudes y otras superposiciones no se declaran modales y el cromo nativo las tapa | ⬜ pendiente | Claude | ninguno para el código y la prueba local; subir a master (= prod) requiere OK de Pedro; dispositivo para la validación final | en Notion/repo |
| P0 | PT04-SMTP | PT04: SMTP propio, límites de Auth, captcha y plantilla OTP en producción | ⬜ pendiente | Pedro | acceso externo (consola Resend/Supabase) + permiso produccion; Claude solo puede hacer la lectura del paso 1 | [PT04-SMTP.md](PT04-SMTP.md) |
| P0 | SEC-credenciales-repo-publico | PT09: repo público con service_role filtrada: contención, inventario y rotación | ⬜ pendiente | Pedro | permiso produccion + firma de Pedro (privatizar, rotar, apagar legacy); Claude solo hace la parte documental | en Notion/repo |
| P0 | SMOKE-prod-chat-venta | Smoke de chat y venta en producción con cuentas de prueba dedicadas (cierre de los P0 de chat y confirmar venta) | ⬜ pendiente | Pedro | permiso produccion | [SMOKE-prod-chat-venta.md](SMOKE-prod-chat-venta.md) |
| P1 | ASC-estado-frontera | A0: estado real en App Store Connect y frontera entre binario iOS y web | 🟣 decisión | Pedro+Javier | acceso externo (App Store Connect) + decision Pedro/Javier | en Notion/repo |
| P1 | BB03-LG01 | P2 diseño: aprobar el piloto Liquid Glass (BB03) y el contrato nativo/web LG01 | ⬜ pendiente | Javier | diseno Javier | en Notion/repo |
| P1 | DEC-S02A-neutral | Decidir si la pantalla neutral cierra el P0 de registro con correo existente | 🟣 decisión | Pedro+Javier | decision Pedro/Javier | en Notion/repo |
| P1 | DEC-S09A-datos-capturas | S09-A: decidir datos dedicados para las capturas y la prueba en iPhone | 🟣 decisión | Pedro+Javier | decision Pedro/Javier | [DEC-S09A-datos-capturas.md](DEC-S09A-datos-capturas.md) |
| P1 | DEC-muro-entrada | Muro de entrada: exigir cuenta al abrir la app o solo pedir ubicación al visitante | 🟣 decisión | Pedro+Javier | decision Pedro/Javier (riesgo App Store 5.1.1(v)) | [DEC-muro-entrada.md](DEC-muro-entrada.md) |
| P1 | DEC-venta-pendiente | S04: qué pasa con una venta pendiente tras bloqueo, pausa o eliminación del producto | 🟣 decisión | Pedro+Javier | decision Pedro/Javier | en Notion/repo |
| P1 | DIS-diseno-restante | Diseño restante reservado a Javier: aprobación pantalla por pantalla (fila del calendario) | ⬜ pendiente | Javier | diseno Javier | en Notion/repo |
| P1 | DISP-S05-mapas | S05 en iPhone/iPad: MapKit, GPS, tap/arrastre/pinch, Aplicar, persistencia y preview | ⬜ pendiente | Pedro+Javier | dispositivo | [DISP-S05-mapas.md](DISP-S05-mapas.md) |
| P1 | DISP-S09A-iphone | S09-A: validar en iPhone con un usuario de prueba con universidad aprobada y hacer las capturas | ⬜ pendiente | Javier | depende de otro item (DEC-S09A-datos-capturas) + dispositivo | en Notion/repo |
| P1 | DISP-arranque-enlaces | iPhone: arranque en frío, enlaces universales, Apple Sign-In, red lenta, splash, teclado y Sentry | ⬜ pendiente | Javier | dispositivo | en Notion/repo |
| P1 | DISP-chat-segundo-plano | Chat: volver de segundo plano en la app nativa (iPhone/Android) sin pérdidas ni aviso pegado | ⬜ pendiente | Pedro+Javier | dispositivo | en Notion/repo |
| P1 | DISP-header-capsula | BUG-HDR en iPhone: cápsula nativa, banners, safe areas y web servida por Capacitor | ⬜ pendiente | Javier | dispositivo | [DISP-header-capsula.md](DISP-header-capsula.md) |
| P1 | DISP-push-entrega | PT07: entrega real de push en dispositivo y revisión de net._http_response | ⬜ pendiente | Pedro+Javier | dispositivo | en Notion/repo |
| P1 | DOC-A01-D01-entorno | Redactar en Notion la ficha A01 y D01-Entorno y conciliación | 🟡 parcial | Claude | ninguno (los campos de ASC los completa Javier) | en Notion/repo |
| P1 | DOC-D01-actas | D01: actas fechadas del trabajo cerrado el 26-sep (PT01, S04, despliegue web, chips, header, PT05, S09-A, PT07, AASA) | 🟡 parcial | Claude | ninguno | en Notion/repo |
| P1 | DOC-D02 | D02: actualizar S04 con la aplicación en prod y escribir D02-Realtime, D02-S09A y la nota de D02-S05 | 🟡 parcial | Claude | ninguno | en Notion/repo |
| P1 | E2E-S01-retorno-vender | S01: E2E autenticado del botón Volver de /vender | ⬜ pendiente | Claude | ninguno | en Notion/repo |
| P1 | FIX-S09A-mas-de-20 | S09-A: tope silencioso de 20 en el modo campus y 'Ver todo' que pierde la categoría | ⬜ pendiente | Claude | ninguno para staging; subir a master (= prod) requiere OK de Pedro | [FIX-S09A-mas-de-20.md](FIX-S09A-mas-de-20.md) |
| P1 | IOS-candidato-build-prueba | Candidato iOS: build, TestFlight y prueba en dispositivo (A03/A04) | ⬜ pendiente | Javier | diseno Javier + dispositivo | en Notion/repo |
| P1 | IOS-envio-revision | Metadatos, privacidad, edad, capturas, notas de revisión y envío a Apple (A04 paquete / A05) | ⬜ pendiente | Pedro+Javier | acceso externo (App Store Connect) + depende de IOS-candidato-build-prueba | en Notion/repo |
| P1 | LEGAL-credencial-estudiante | Revisión legal: pedir la credencial o ID de estudiante al usuario | 🟣 decisión | Pedro | decision Pedro/Javier con asesoría legal; Claude solo prepara el inventario | [LEGAL-credencial-estudiante.md](LEGAL-credencial-estudiante.md) |
| P1 | LEGAL-nombres-universidades | Revisión legal: uso de 'Universidad Anáhuac' y otros nombres y colores institucionales | 🟣 decisión | Pedro | decision Pedro/Javier con asesoría legal; Claude solo prepara la ficha de hechos | [LEGAL-nombres-universidades.md](LEGAL-nombres-universidades.md) |
| P1 | MAC-conciliacion | PT00: conciliar el checkout y los worktrees de la Mac de Javier y el SHA del build 1.1 (6) | 🟡 parcial | Javier | acceso externo (Mac de Javier) | en Notion/repo |
| P1 | NOTION-D00-superado | Actualizar D00 y marcar como superadas las secciones desactualizadas de la jornada | 🟡 parcial | Claude | ninguno | en Notion/repo |
| P1 | NOTION-calendario-corte | Actualizar la tabla del calendario y el corte diario con estado real, fechas nuevas y responsables | 🟡 parcial | Claude | ninguno | en Notion/repo |
| P1 | NOTION-padre-bugs | Página padre 'Bugs y Tareas Pendientes': conciliar el lote del 26-sep y marcar lo resuelto | 🟡 parcial | Claude | ninguno | en Notion/repo |
| P1 | PREVIEW-mapa | 'Mapa no disponible' en la ficha: diagnóstico del caso reportado, smoke del proveedor real y privacidad | 🟡 parcial | Claude | ninguno (solo lectura en prod + staging); el enlace del caso lo tiene Javier | [PREVIEW-mapa.md](PREVIEW-mapa.md) |
| P1 | PT07-apns-clave | PT07: rotar la clave APNs G6K8JJCWA4 en coordinación con Firebase | 🟣 decisión | Pedro | acceso externo (Firebase y Apple Developer) + firma de Pedro | en Notion/repo |
| P1 | PT07-entitlements-ipa | PT07: confirmar que el binario de la 1.1 (6) sale con aps-environment production | ⬜ pendiente | Javier | dispositivo (Mac con el archive/.ipa) | en Notion/repo |
| P1 | PT07-send-push-deploy | PT07: desplegar send-push con preferencias (prod sigue en v20) | ⛔ bloqueado | Pedro | permiso produccion | en Notion/repo |
| P1 | PT09-delete-account | PT09: desplegar la versión actual de delete-account (prod tiene la del 16-jul) | ⬜ pendiente | Pedro | permiso produccion para el despliegue en prod; la prueba en staging es ejecutable | [PT09-delete-account.md](PT09-delete-account.md) |
| P1 | PT09-rate-limits | PT09: los limitadores de la app son no-op sin Upstash (login, OTP, feed, reportes, preview) | ⬜ pendiente | Pedro | acceso externo (Upstash y Vercel) para el arreglo; la tabla es de solo lectura | [PT09-rate-limits.md](PT09-rate-limits.md) |
| P1 | RED-cambiar-ubicacion-palomita | Cambiar ubicación: la X del header pasa a palomita verde con cambios pendientes (y rediseño de la hoja) | 🟣 decisión | Javier | diseno Javier (cambia la apariencia; la propuesta es suya) | en Notion/repo |
| P1 | VAL-S02A-staging | S02-A: validación funcional en staging de registro, correo existente, sesión activa, OTP y recuperación | ⬜ pendiente | Claude | ninguno para staging; la entrega real de correo depende de PT04-SMTP | en Notion/repo |
| P1 | VAL-S03-favoritos | S03/PT02: fixtures de favoritos y e2e con roles reales (cierre del P0 Favoritos JR/ROD170000) | ⬜ pendiente | Claude | ninguno | en Notion/repo |
| P1 | VERIF-fase7 | Fase 7: una corrida unificada de navegación, build y e2e en móvil sobre el SHA de master | 🟡 parcial | Claude | ninguno para web; dispositivo para iPhone/iPad | [VERIF-fase7.md](VERIF-fase7.md) |
| P2 | BB00-skills | P0 diseño: skills apple-design, button-expert y vicino-ui-reviewer, y registro BB00 | ⬜ pendiente | Javier | diseno Javier + decision Pedro (instalar código de terceros) | en Notion/repo |
| P2 | BB01-BB02 | P1 diseño: inventario de familias y consumidores (BB01) y fundamentos y tokens (BB02) | ⬜ pendiente | Javier | diseno Javier | en Notion/repo |
| P2 | BB04-BB05 | P3 diseño: implementar las familias nativas aprobadas y migrar sus consumidores | ⛔ bloqueado | Javier | depende de otro item (BB03-LG01) + diseno Javier | en Notion/repo |
| P2 | BB06-acta | P4 diseño: acta visual, de accesibilidad y en dispositivo del alcance incluido (BB06) | ⬜ pendiente | Javier | diseno Javier + dispositivo | en Notion/repo |
| P2 | DISP-187f976 | Validar en iPhone 187f976: selector y toast de video y modal de portada | ⬜ pendiente | Javier | dispositivo | en Notion/repo |
| P2 | DOC-A02 | A02: delta nativo del binario y resumen del inventario de eventos push | ⬜ pendiente | Claude | ninguno | en Notion/repo |
| P2 | DOC-S05-cobertura | S05: documentar el diagnóstico de Villahermosa, la tabla de configuración y la regla de cobertura vigente | 🟡 parcial | Claude | ninguno (Pedro/Javier confirman la regla) | en Notion/repo |
| P2 | DOC-devlogs-progress | DevLogs en 01_DevLogs y PROGRESS.md de las sesiones cerradas | 🟡 parcial | Claude | ninguno | en Notion/repo |
| P2 | FIX-solicitudes-fixtures | Fixtures de solicitudes: header fijo en /solicitudes/[id] y filtrado del feed contra la BD | ⬜ pendiente | Claude | ninguno | [FIX-solicitudes-fixtures.md](FIX-solicitudes-fixtures.md) |
| P2 | IOS-privacyinfo | PrivacyInfo.xcprivacy no está en el target de Xcode y no entra al bundle | ⬜ pendiente | Javier | dispositivo (Mac/Xcode) | en Notion/repo |
| P2 | LIMPIEZA-docs-retencion | Repo: borrar el script de retención muerto y corregir los docs que dicen 'producción retenida' | ⬜ pendiente | Claude | ninguno (el push a master lo autoriza Pedro) | en Notion/repo |
| P2 | MAC-requisitos | Mac: iPhone de prueba registrado y sesión de Notion/Codex confirmadas | 🟡 parcial | Javier | dispositivo | [MAC-requisitos.md](MAC-requisitos.md) |
| P2 | PT07-avisos-nuevos | PT07: avisos nuevos (oferta a Solicitud, cita al comprador) con un trigger único y sin duplicados | 🟣 decisión | Pedro+Javier | decision Pedro/Javier (alcance) + firma de Pedro para quitar triggers | [PT07-avisos-nuevos.md](PT07-avisos-nuevos.md) |
| P2 | PT07-badge-unregistered | PT07: badge real (hoy fijo en 1) y limpieza de tokens UNREGISTERED en send-push | ⬜ pendiente | Claude | ninguno para código y staging; el despliegue a prod lo hace Pedro | [PT07-badge-unregistered.md](PT07-badge-unregistered.md) |
| P2 | PT07-drop-notify-push | PT07: retirar notify_push y sus 2 triggers (401 fantasma) | 🟣 decisión | Pedro | permiso produccion (firma de Pedro, operación destructiva) | en Notion/repo |
| P2 | PT09-backend-B1-B7 | PT09: conciliación backend B1-B7 en solo lectura (tokens MapKit, releases de Sentry, jobs, 401 de pg_net, admin) | ⬜ pendiente | Claude | ninguno para la conciliación; las variables de Vercel las pone Pedro | en Notion/repo |
| P2 | PT09-deriva-permisos-rest | PT09: deriva de permisos repo↔prod y sondeo de acceso REST/RPC directo | 🟡 parcial | Claude | ninguno en staging; registrar en el ledger de prod requiere a Pedro | [PT09-deriva-permisos-rest.md](PT09-deriva-permisos-rest.md) |
| P2 | RED-busqueda | Búsqueda: rediseño general del frontend | ⬜ pendiente | Javier | diseno Javier | en Notion/repo |
| P2 | RED-comunidades-fundar | Comunidades y Fundar comunidad: rediseño del frontend | ⬜ pendiente | Javier | diseno Javier | en Notion/repo |
| P2 | RED-configuracion | Configuración: rediseño del frontend | ⬜ pendiente | Javier | diseno Javier | [RED-configuracion.md](RED-configuracion.md) |
| P2 | RED-onboarding | Onboarding: revisión visual completa del flujo | ⬜ pendiente | Javier | diseno Javier | [RED-onboarding.md](RED-onboarding.md) |
| P2 | RED-solicitudes | Solicitudes: rediseño del frontend (vista y filtros) | ⬜ pendiente | Javier | diseno Javier | en Notion/repo |
| P2 | S02B-matriz-acceso | S02-B funcional: matriz de acceso por estado, rutas exentas, GPS denegado y preferencias | ⬜ pendiente | Claude | ninguno (la apariencia del onboarding es de Javier) | en Notion/repo |
| P2 | S05-cuenta-sintetica | S05: publicar, editar y crear una solicitud con ubicación por la UI con una cuenta sintética | ⬜ pendiente | Claude | ninguno | [S05-cuenta-sintetica.md](S05-cuenta-sintetica.md) |
| P2 | S06-filtros-funcional | S06 funcional: filtros, paginación y estados de Búsqueda y Solicitudes | ⬜ pendiente | Claude | ninguno | en Notion/repo |
| P2 | S07-comunidades-funcional | S07 funcional: fundar y administrar comunidades (permisos, validación, cancelar sin crear) y contraste con los arreglos del 16-sep | ⬜ pendiente | Claude | ninguno (el rediseño es de Javier) | en Notion/repo |
| P2 | S08-dataset-auditoria | S08: dataset sintético y auditoría de Rankings, Mis Ventas, Mis Reseñas y Estadísticas | ⬜ pendiente | Claude | ninguno (solo staging) | [S08-dataset-auditoria.md](S08-dataset-auditoria.md) |
| P2 | S09-contrato | S09: contrato de estudiante (comprador o vendedor, estados, documentos, omitir y reanudar) y D02-S09 | 🟣 decisión | Pedro+Javier | decision Pedro/Javier + revisión legal | en Notion/repo |
| P2 | SEC-staging-dbpass | Rotar la contraseña de la BD de staging que quedó impresa en la salida de una herramienta | ⬜ pendiente | Claude | ninguno (solo staging) | en Notion/repo |
| P2 | TM-entorno-preview | Acordar un entorno de preview para probar la app nativa y el front contra staging o ramas sin fusionar | 🟣 decisión | Pedro+Javier | decision Pedro/Javier | [TM-entorno-preview.md](TM-entorno-preview.md) |
| P3 | B2-brand-book-extendido | B2: extender el brand book a familias y pantallas fuera del candidato | ⬜ pendiente | Javier | diseno Javier | en Notion/repo |
| P3 | D02-ADR | Comprobar si 02_Architecture_ADR recoge S04 y la vuelta de sale_confirmations a Realtime | ⬜ pendiente | Claude | ninguno | en Notion/repo |
| P3 | DEC-recordatorios-live-activities | Recordatorios de cita (push de 1 h y 1 día) y Live Activities: alcance y momento | 🟣 decisión | Pedro+Javier | depende de otro item (PT07-avisos-nuevos) + decision Pedro/Javier | en Notion/repo |
| P3 | E2E-chat-lotes | e2e-chat-venta: caso de recuperación por lotes (un hueco mayor que el lote) | ⬜ pendiente | Claude | ninguno | en Notion/repo |
| P3 | FIX-request-card-cero | Tarjeta de solicitud: un presupuesto de 0 pinta un '0' suelto y no fija el locale es-MX | ⬜ pendiente | Claude | ninguno (el push a master lo autoriza Pedro) | en Notion/repo |
| P3 | H39-nombre-vendedor | Unificar el nombre visible del vendedor negocio con interruptor de privacidad | ⛔ bloqueado | Pedro+Javier | decision Pedro/Javier (aparcado) + permiso produccion | en Notion/repo |
| P3 | H40-descarga-fotos | Se pueden descargar las fotos de cualquier publicación | 🟣 decisión | Pedro+Javier | decision Pedro/Javier | en Notion/repo |
| P3 | H46-gestion-seguidas | Pantalla /perfil/siguiendo para gestionar las tiendas seguidas | ⛔ bloqueado | Pedro+Javier | decision Pedro/Javier (aparcada) + diseno Javier | en Notion/repo |
| P3 | H49-gestos-deslizar | Deslizar entre páginas resulta incómodo en móvil | 🟣 decisión | Pedro+Javier | decision Pedro/Javier | [H49-gestos-deslizar.md](H49-gestos-deslizar.md) |
| P3 | H50-constantes-topes | product-form: pasar a constantes los topes de 50 MB y 5 MB | ⬜ pendiente | Claude | ninguno | en Notion/repo |
| P3 | INFO-planes-cumplidos | Planes y órdenes del día ya cumplidos o superados | ℹ️ informativo | Pedro+Javier | ninguno | en Notion/repo |
| P3 | INFO-reglas-vigentes | Reglas vigentes: Hecho con evidencia, datos sintéticos, componente compartido, onboarding de Javier, formato de entrega | ℹ️ informativo | Claude | ninguno | en Notion/repo |
| P3 | INFO-subpagina-usar-otro-correo | Subpágina de diseño 'Verificación por correo: Usar otro correo' | ℹ️ informativo | Javier | diseno Javier | en Notion/repo |
| P3 | LG-ajustes-aprobacion | Ajustes visuales del 16-sep pendientes de aprobación y cierre Liquid Glass en D01 | 🟡 parcial | Javier | diseno Javier + dispositivo | en Notion/repo |
| P3 | NAV-inferior | Barra de navegación inferior: reparto de los botones en web/Android frente a la tab bar nativa de iOS | 🟣 decisión | Javier | diseno Javier + dispositivo | [NAV-inferior.md](NAV-inferior.md) |
| P3 | PT00-stashes-respaldo | PT00: stashes históricos y rama security/eradicate-vercel-service-role-key | ℹ️ informativo | Pedro | decision Pedro/Javier (borrar solo con su OK) | en Notion/repo |
| P3 | PT10-fechas-siguiente-fase | PT10: fijar el 5-oct las fechas de implementación de S09/S10 y recordatorios | 🟣 decisión | Pedro+Javier | decision Pedro/Javier | [PT10-fechas-siguiente-fase.md](PT10-fechas-siguiente-fase.md) |
| P3 | S09-UI-estudiante | S09: paso '¿Eres estudiante?' en el onboarding, credencial para no vendedores e insignia en Perfil | ⬜ pendiente | Javier | depende de otro item (S09-contrato, LEGAL-credencial-estudiante) + diseno Javier | en Notion/repo |
| P3 | S10-definicion | S10: definir el MVP de negocios en el mapa y el contrato D02-S10 | 🟣 decisión | Pedro+Javier | decision Pedro/Javier + diseno Javier | en Notion/repo |
| P3 | S10-implementacion | S10: marcadores, clusters y listado sincronizado con el área visible | ⬜ pendiente | Claude | depende de otro item (S10-definicion) | en Notion/repo |
| P1 | HECHO-S04-completo | S04 chat/venta: implementación, validación en staging y migraciones S04 + Realtime aplicadas en prod | ✅ hecho | Claude | ninguno | en Notion/repo |
| P2 | HECHO-AASA-assetlinks | PT08: AASA y assetlinks.json servidos y validados | ✅ hecho | Claude | ninguno | en Notion/repo |
| P2 | HECHO-PT00-git-pedro | PT00: inventario Git del equipo de Pedro conciliado | ✅ hecho | Claude | ninguno | en Notion/repo |
| P2 | HECHO-PT01-lint-ci | PT01: los any de Favoritos corregidos y CI en verde | ✅ hecho | Claude | ninguno | en Notion/repo |
| P2 | HECHO-PT05-villahermosa | PT05: Villahermosa y cobertura del buscador de ubicación corregidas en prod | ✅ hecho | Claude | ninguno | en Notion/repo |
| P2 | HECHO-PT07-auditoria | PT07: auditoría de notificaciones push (incluida la extensión de recordatorios) | ✅ hecho | Claude | ninguno | en Notion/repo |
| P2 | HECHO-PT07-codigo | PT07 código: sin bucle en el arranque en frío y sin token en logs | ✅ hecho | Claude | ninguno | en Notion/repo |
| P2 | HECHO-S09A-campus | S09-A: chip Universidad y modo campus exclusivo en Home y /buscar | ✅ hecho | Claude | ninguno | en Notion/repo |
| P2 | HECHO-header-web | BUG-HDR: header móvil fijo al hacer scroll (web/prod) | ✅ hecho | Claude | ninguno | en Notion/repo |
| P2 | HECHO-iOS-piloto-testflight | Piloto iOS integrado y 1.1 (6) subida a TestFlight; Mac preparada con Xcode | ✅ hecho | Javier | ninguno | en Notion/repo |
| P2 | HECHO-retencion-vercel | Retención de producción por S04 puesta y retirada; prod despliega master | ✅ hecho | Claude | ninguno | en Notion/repo |
| P2 | HECHO-staging-fixtures-acceso | Staging fiel a prod, fixtures mínimos y acceso a la Management API | ✅ hecho | Claude | ninguno | en Notion/repo |
| P3 | HECHO-S01 | S01 implementado: Siguiendo sin texto, disparador 'Categorías' en Búsqueda/Solicitudes, retorno de /vender | ✅ hecho | Claude | ninguno | en Notion/repo |
| P3 | HECHO-S02A | S02-A implementado: correo existente, sesión activa en /register y pantalla de código con salidas | ✅ hecho | Claude | ninguno | en Notion/repo |
| P3 | HECHO-S03 | S03 implementado: favorito inactivo sin 404, pausada fuera del catálogo, ficha pausada sin compra | ✅ hecho | Claude | ninguno | en Notion/repo |
| P3 | HECHO-S05-mapas | S05 mapas: borrador/Aplicar ubicación, tap y arrastre, zoom y errores del preview (local) integrados | ✅ hecho | Claude | ninguno | en Notion/repo |
| P3 | HECHO-chips-home | Barra de categorías del Home: tocar un chip sube su fila (chips reactivos) | ✅ hecho | Claude | ninguno | en Notion/repo |
| P3 | HECHO-integracion-S01-S05 | S01-S05 integrados en master y desplegados | ✅ hecho | Claude | ninguno | en Notion/repo |
| P3 | HECHO-old-desactualizados | Items del padre resueltos pero abiertos en Notion: cupones, recorte de avatar, proveedor de mapas y RPC del feed | ✅ hecho | Claude | ninguno | en Notion/repo |
| P3 | HECHO-old-limpieza-visual | Lote antiguo de limpieza visual y repo (H56, H57, H61-H66) | ✅ hecho | Claude | ninguno | en Notion/repo |
| P3 | HECHO-old-publicar-video | Lote antiguo de publicar/video y perfil (H50 toast, H51-H55, H58-H60) | ✅ hecho | Claude | ninguno | en Notion/repo |

## Hallazgos del crítico de completitud

**1. Pendientes con fecha de hoy o del traspaso que faltan en la lista**

- **Checkout Windows de Javier (traspaso, jornada3 l.17).** Ningún item cubre `PROJECT-VICINO-S05`: está en HEAD 532143f, detrás de origin, y tiene sin seguimiento `seed-villahermosa-estradajr.sql`, un seed con datos de cuentas. Los worktrees S01-S04 con diffs viejos también están en esa máquina Windows (l.489, l.1172), no en la Mac.
  - MAC-conciliacion pone esos worktrees "en la Mac", que es otra máquina.
  - Riesgo concreto: el repo es público y el `.gitignore` raíz no tiene ninguna regla para seeds (verificado, `grep seed .gitignore` sale vacío). Un `git add -A` en esa máquina lo publica.
  - Falta un item "CHK-windows-javier": avanzar a 4f5577b, sacar el seed del repo, añadir la regla `/seed-*.sql` (Claude puede hacerlo ya) y confirmar que ese seed nunca se ejecutó contra prod. El cambio lo dejó sin commit otra sesión con otra cuenta (l.39).
- **Registro de migraciones y reversión de Realtime (PT03 l.398, "registro de migraciones vigente").** 20260926100000 y 20260925010000 se aplicaron por la Management API, fuera de `db push`. Ningún DOC-* pide anotarlas en el registro de migraciones de Notion (`[[vicino-migraciones]]`, bugs3 l.39).
  - `docs/rollback/` solo tiene los rollbacks de 20260912300000 y 20260925010000. No hay rollback SQL de 20260926100000 (Realtime). Esto debería entrar en DOC-D02.
- **Menores:**
  - PT05 l.409 pide expresamente probar ciudades de borde de cobertura y fuera de México, y l.411 pide revisar `exigir_cobertura_operacion`. La lista lo deja como "opcional" en HECHO-PT05; debería ir en S05-cuenta-sintetica.
  - El traspaso l.24 incluye el rediseño de Perfil y Rankings, que no tienen item RED-* propio. Hoy solo caben dentro de DIS-diseno-restante y LG-ajustes-aprobacion.

**2. Items marcados hecho sin evidencia suficiente**

- **HECHO-AASA-assetlinks.** Dice "Verificado ahora por lectura pública", pero el Registro l.66 y PENDIENTES:238-239 dicen que el clasificador bloqueó esa lectura. No hay salida guardada: status, content-type, hash y hora.
  - Hasta que se guarde en PENDIENTES o en el D01, debe quedar como "verificado por subagente, sin acta".
  - El 308 de www no es opcional: App.entitlements declara `applinks:www.vicinomarket.com` y Apple no sigue redirecciones.
- **HECHO-iOS-piloto-testflight.** f61dbb3 (autor "Alumnos") solo toca 12 líneas del `project.pbxproj` (sube la versión). Que la 1.1 (6) se subió a TestFlight solo lo dice el mensaje del commit, y el traspaso l.15 lo llama "reportado".
  - No hay ID del build en ASC ni estado de procesamiento. Debe quedar "reportado; falta confirmarlo en ASC", dentro de ASC-estado-frontera.
- **HECHO-old-publicar-video.** Mete como hecho H52 (187f976), que la página padre marca "🔴 SIN VALIDAR EN PRODUCCIÓN" (bugs3 l.52), con riesgo conocido de autoPlay en WKWebView.
  - Separar H52 como "código hecho, sin validar" y no marcarlo en Notion hasta cerrar DISP-187f976.
- **HECHO-S04-completo.** La aplicación en prod solo consta en docs/PENDIENTES:135-145, que es un autorregistro. El Registro de avance de Notion (l.28-70) no tiene entrada de ese evento, y el traspaso l.15 dice "esta recopilación no volvió a consultar la BD".
  - Vale como "migración aplicada". H17 y H19 (los P0 de chat y de venta) no pueden cerrarse hasta SMOKE-prod-chat-venta.
- **HECHO-S09A-campus.** En prod solo se probó al visitante (200), y el visitante nunca ve el chip. El modo campus autenticado depende del cliente de servicio en prod y nunca se ejecutó contra prod.
  - Debe decir "hecho en staging; prod autenticado sin probar". Además queda ligado a SEC: si se apaga legacy, cae el modo campus.

**3. Items marcados no ejecutables que Claude podría hacer ya**

- **INFO-subpagina-usar-otro-correo.** Leer la subpágina 3e498e8a...903a (l.1813) es solo lectura en Notion. El bloqueo "diseño Javier" aplica a actuar sobre ella, no a leerla.
- **PT07-send-push-deploy.** Verificado: `supabase/config.toml` solo declara purge-verification-documents, expire-confirmations y send-appointment-reminders (l.48-59). Claude puede añadir `[functions.send-push] verify_jwt = false`, y declarar delete-account explícitamente, para que el despliegue de Pedro no dependa de acordarse de `--no-verify-jwt`.
- **ASC-estado-frontera, la parte de la frontera binario/web.** `git diff --stat f61dbb3 origin/master -- apps/web/ios apps/web/android apps/web/capacitor.config.ts` solo muestra `android/app/build.gradle`. Nada posterior a la 1.1 (6) exige un binario iOS nuevo, y FIX-cromo-modales es solo web. Se puede escribir ya; solo la lectura del panel de ASC queda para Pedro y Javier.
- **IOS-privacyinfo.** El archivo existe y `grep -ci privacy project.pbxproj` da 0 (objectVersion 60, sin carpetas sincronizadas). Claude puede preparar en una rama el parche del pbxproj (referencia, build file y fase de recursos); en la Mac solo queda compilar y verificar.
- **MAC-conciliacion, la parte remota.** `git branch -r --no-merged origin/master` solo lista ramas de dependabot y ramas antiguas: feat/comunidades-hiperlocales y feat/frontend-fases-f1-f5 tienen 0 commits únicos, y fix/sentry-ios ya está superado por lib/observability/sentry-nativo.ts. Se puede registrar ya que no hay trabajo de Javier o de la Mac sin integrar en el remoto.
- **SMOKE-prod-chat-venta, la preparación.** e2e-chat-venta.mjs hoy crea cuentas y productos con los fixtures de staging (l.19 y 76-78) y apunta a E2E_BASE, que por defecto es :3100 (l.24). Claude puede añadir ya:
  - un modo prod con las cuentas por variable de entorno y sin crear fixtures;
  - una guarda de confirmación explícita;
  - el script para retirar la venta de prueba.
  
  Solo la corrida necesita a Pedro.
- **PT00-stashes-respaldo.** Revisar `git stash show -p` de los 5 stashes y resumir su contenido para que Pedro decida es solo lectura.
- **Preparación documental en items "no ejecutables" que ya dicen "Claude puede preparar":** inventario de LG-ajustes-aprobacion, inventario de seller_verification de S09-contrato, borrador de D02 de S10-definicion y opción B de DEC-venta-pendiente (migración más casos en staging como insumo para decidir).
- **No es de Claude, pero el bloqueo está mal puesto en PT07-entitlements-ipa.** No hace falta la Mac: en ASC, TestFlight → build → Build Metadata muestra los entitlements del binario, así que lo puede comprobar desde el navegador cualquiera con acceso a ASC.
- **Opcional: RED-cambiar-ubicacion-palomita.** La propuesta es del propio Javier (l.1635). Se puede preparar en una rama que no sea master, con preview, para que él la apruebe, sin tocar prod.
