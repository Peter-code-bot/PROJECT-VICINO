# Plan MAC-requisitos

**Pendiente:** Mac: iPhone de prueba registrado y sesión de Notion/Codex confirmadas

**Fuentes en Notion:** C l.473 (TM-requisitos-mac), l.578 (A0-accesos-mac-firma)

**Estado conciliado (26-sep ~23:30):** parcial. Xcode, firma y subida a ASC funcionan (f61dbb3). b72724f dice 'pendiente de prueba táctil en Simulator': no hay evidencia de un iPhone físico.

**Qué falta:** Javier confirma un iPhone de prueba registrado y la sesión de Notion en la Mac. Es requisito de todos los items DISP-*.

## Objetivo

Dejar acreditado, con evidencia en Notion (A01/D01), que existe un iPhone de prueba con la 1.1 (6) instalada, en TestFlight y opcionalmente registrado en el equipo HPTJ743Q64, y que Codex en la Mac lee el Notion del workspace VICINO. Así se desbloquean todos los DISP-*. Es coordinación, no código: el proyecto ya firma en automático (CODE_SIGN_STYLE Automatic, DEVELOPMENT_TEAM HPTJ743Q64, 1.1 (6) en project.pbxproj), y a b72724f solo le falta la prueba táctil en Simulator.

## Pasos

1. 1. Pedro/Javier: identificar quién es Account Holder o Admin del equipo HPTJ743Q64 en App Store Connect, el mismo que subió la 1.1 (6) desde la Mac. Sin ese rol no se puede dar de alta un probador ni registrar un dispositivo.
2. 2. Elegir el iPhone y anotar modelo e iOS. Debe tener iOS 26 para ver Liquid Glass: CromoNativo.swift:740 y :758 usan UIGlassEffect detrás de #available(iOS 26.0). Un segundo equipo con iOS menor a 26 (el mínimo del proyecto es 15.0) sirve solo para el fallback de BB06.
3. 3. Ruta TestFlight, obligatoria para los DISP-*: en ASC, TestFlight, Pruebas internas, agregar el Apple ID del probador (usuario del equipo) y habilitar la 1.1 (6). ITSAppUsesNonExemptEncryption=false ya está en Info.plist, así que no debería quedar en 'Missing Compliance'. Instalar TestFlight, aceptar la invitación e instalar la app. Esta ruta no requiere UDID y usa APNs de producción, como el candidato.
4. 4. Ruta Xcode, solo para depurar con Web Inspector: conectar el iPhone por cable, confiar en la Mac, activar Modo desarrollador y reiniciar. Poner el Apple ID del equipo en Xcode > Settings > Accounts y hacer Run del esquema App en el iPhone con firma automática. Xcode registra el UDID en el equipo HPTJ743Q64.
5. 5. Aprovechar la sesión en la Mac: `codesign -d --entitlements - <App.app del archivo 1.1 (6) en Organizer>` debe decir aps-environment=production (PT07, §3.3 de docs/AUDITORIA-push-2026-09-26.md). Si dice development, se detiene todo y se avisa a Pedro.
6. 6. Codex + Notion en la Mac: `codex --version`, luego `codex mcp list` debe mostrar el servidor de Notion. Pedir a Codex que lea la página de la jornada (3de98e8a0cfa81cc812ef86a0ca65263) y el Enrutador (3b698e8a0cfa8197a430dcee1f531992). Debe devolver sus títulos y no un 404: la conexión de Pedro da 404 en esa página, así que la cuenta conectada tiene que ser una del workspace VICINO.
7. 7. Higiene de la máquina compartida (los commits salen como 'Alumnos <alumnos@UAP-4411-03.local>' y la ruta es /Users/alumnos): `git config --local user.name` y `user.email` con la identidad de Javier. Al cerrar cada sesión: `codex logout`, quitar el Apple ID de Xcode > Accounts (o usar un usuario de macOS propio) y comprobar en Acceso a Llaveros que no quede una clave privada 'Apple Distribution' local.
8. 8. Registrar la evidencia en Notion (A01 Ficha de release / D01 Entorno): modelo, iOS, build instalado, ruta (TestFlight/Xcode), fecha, rol en ASC y estado de Codex/Notion. En el repo público solo se marca el pendiente de PT00 de docs/PENDIENTES-2026-09-26.md ('Mac y worktrees de Javier', l.232), sin UDID, sin correos y sin número de serie.
9. 9. Opcional (Claude puede hacerlo después, con permiso de Pedro): ampliar scripts/prepare-mac.mjs para que `--check` informe `xcrun devicectl list devices` (emparejado y Modo desarrollador) y si `codex mcp list` incluye notion. Así la confirmación queda reproducible. Debe mantener el exit 1 fuera de macOS.
10. 10. Desbloquear los DISP-*: con el iPhone listo, correr el guion §5 de docs/AUDITORIA-push-2026-09-26.md con dos cuentas de prueba (nunca reales), el arranque en frío desde un enlace universal (cc385bc), MapKit/GPS/gestos (PT05) y la cápsula nativa, los banners y las safe areas del header (209caf7).

## Archivos

- C:/Users/pedro/Projects/startup-marketplace/docs/PENDIENTES-2026-09-26.md (solo marcar PT00 l.232 y las casillas de dispositivo de PT05/PT07 cuando haya evidencia; sin UDID ni correos)
- C:/Users/pedro/Projects/startup-marketplace/scripts/prepare-mac.mjs (opcional, paso 9: reportar devicectl y el MCP de Notion)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/ios/App/App.xcodeproj/project.pbxproj (solo lectura: DEVELOPMENT_TEAM HPTJ743Q64, firma Automatic, 1.1 (6), deployment 15.0)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/ios/App/App/App.entitlements (solo lectura: aps-environment development en la fuente, associated domains)
- C:/Users/pedro/Projects/startup-marketplace/apps/web/ios/App/App/CromoNativo.swift (solo lectura: #available(iOS 26.0) en l.740/758)
- C:/Users/pedro/Projects/startup-marketplace/docs/AUDITORIA-push-2026-09-26.md (solo lectura: §3.3 entitlements, §5 guion de dispositivo)
- C:/Users/pedro/Projects/startup-marketplace/scripts/ios-local/README.md (solo lectura: el build de simulador no sirve para el iPhone físico)

## Pruebas

- En el iPhone: la app TestFlight muestra VICINO 1.1 (6) instalada, abre y carga vicinomarket.com (smoke de solo lectura, sin iniciar sesión con cuentas reales).
- Si se usó la ruta Xcode: `xcrun devicectl list devices` en la Mac muestra el iPhone como 'available (paired)', y developer.apple.com > Devices del equipo HPTJ743Q64 lo lista.
- `codesign -d --entitlements - App.app` del archivo 1.1 (6) muestra aps-environment = production.
- `node scripts/prepare-mac.mjs --check` en la Mac termina con exit 0 (Xcode ≥26, SDK iOS ≥26, Codex CLI presente).
- Codex en la Mac lee la página 3de98e8a0cfa81cc812ef86a0ca65263 y devuelve su título, sin 404 ni 403.
- Smoke de solo lectura en el dispositivo: con la app cerrada, tocar desde Notas un enlace https://vicinomarket.com/ abre la app una sola vez, sin bucle de recargas. Esto prueba a la vez el associated domains del build y el AASA servido (Claude no puede leer el AASA servido).
- `git log -1 --format=%an` de un commit nuevo hecho en la Mac muestra la identidad de Javier y no 'Alumnos'.
- Solo si se hace el paso 9: `node --check scripts/prepare-mac.mjs` pasa, y `--check` en Windows sigue devolviendo 1 con el aviso de macOS.

## Riesgos

- La Mac es un equipo compartido de laboratorio (usuario 'alumnos', host UAP-4411-03). Las sesiones de Apple ID, Codex/Notion, las credenciales de git y cualquier clave privada de firma en el llavero quedan al alcance de otros usuarios de esa cuenta.
- Los commits salen con el autor 'Alumnos <alumnos@UAP-4411-03.local>' y no se pueden atribuir a Javier.
- Si el Apple ID de Javier no tiene rol suficiente en HPTJ743Q64, Xcode no registra el dispositivo y la firma automática falla. La ruta TestFlight no depende de eso.
- Un iPhone con iOS menor a 26 solo muestra el fallback. No acredita Liquid Glass (LG01/BB06).
- Un build Debug instalado desde Xcode usa APNs sandbox y la web de producción, así que no vale como prueba de push del candidato. Las pruebas de push se hacen sobre TestFlight.
- El repo es público: publicar ahí UDID, Apple ID, capturas con tokens o datos de cuentas los expone.
- Que Codex tenga 'Notion conectado' con otra cuenta puede engañar: la conexión de Pedro da 404 en la página operativa. Hay que verificarlo leyendo esa página concreta.
- El horario del laboratorio puede retrasar todos los DISP-*, porque todos dependen de esta sesión.

## Requiere antes

- iPhone físico disponible, idealmente con iOS 26; opcionalmente otro con iOS menor a 26 para el fallback
- Acceso físico a la Mac del laboratorio (UAP-4411-03, usuario alumnos) en un horario utilizable
- Apple ID de Javier como usuario del equipo HPTJ743Q64 en ASC; rol Admin o con acceso a certificados si se usa la ruta Xcode
- Build 1.1 (6) en estado 'Ready to Test' en TestFlight
- Cuenta de Notion del workspace VICINO que sí ve la página de la jornada, para conectarla a Codex
- Decisión de Pedro/Javier sobre las sesiones en una Mac compartida: usuario de macOS propio o cerrar sesión al final de cada uso

**Responsable:** Javier (con la Mac y el iPhone). Pedro o el Account Holder del equipo HPTJ743Q64 da el rol en ASC y la invitación de probador interno.

**Estimación:** 60-90 min: 45-75 min de Javier con la Mac y el iPhone en mano, 10 min de quien administre ASC y 5-15 min de propagación de la invitación de TestFlight. Si hay que agregar el paso 9, son +30 min de Claude.

**Ejecutable por Claude ahora:** no
