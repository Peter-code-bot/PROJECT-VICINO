# Jornada 16-sep-2026 — bitácora de metas

Seguimiento vivo de todo lo pedido hoy. Cada meta tiene pasos, revisión y
estado. Se actualiza al cerrar cada paso; el push a `master` va al final de
cada meta verificada.

Nota de Pedro: si se agota Fable 5.1, los pendientes siguen con Opus 4.5.

## Meta 0 — Fase 3: navegación y conservación de datos (rama de Alejandro)

Estado: **CERRADA y en master** (`9cc82e0`, pusheado 16-sep 21:4x). Incluye el
merge del pulido visual que otra sesión subió en paralelo (7 commits).

- [x] Leer la rama `feat/frontend-fases-f1-f5-vicino` (60 archivos) y compararla con master.
- [x] Revisión adversarial por cinco lentes (parte de los verificadores cayó por límite de sesión; los hallazgos de los buscadores se evaluaron a mano).
- [x] Merge sobre master, tres conflictos resueltos a favor de master (`f172eab`).
- [x] Semilla del servidor en chats, perfil e inicio (`SessionCache.seed`, `useSessionData(key, seed)`), `loading.tsx` con esqueleto sólo sin datos.
- [x] Freno por IP en `/api/session/*`; `staleTimes.dynamic: 30`; precarga AUTO en `/` y `/buscar`.
- [x] Restauración de scroll sólo en navegaciones de pestaña; `prefetch={false}` en `/chat?seller=`.
- [x] Proveedor sin bucle de recarga ante `INITIAL_SESSION`; `detail` nulo del evento de invalidación.
- [x] Correcciones de las dos rondas de revisión (detalle en el documento).
- [x] Documento de revisión para Pedro: `docs/REVISION-fase3-rama-alejandro-2026-09-16.md`.
- [x] CODEX loop (2 rondas); lint sin errores; node 8/8, 19/19, 14/14, 5/5, 4/4, 3/3; Playwright `phases` 64/64 y `navigation-return` 20 regresos sin esqueleto en los dos viewports; `pnpm build` en verde.
- [x] Merge con master remoto (sin conflictos), build y pruebas repetidas, push.
- [ ] Smoke en vicinomarket.com cuando Vercel termine el despliegue.

## Meta 1 — Comunidades (plan integral, área I)

Estado: **implementada y verificada**, pendiente de push.

- [x] 1.1 Cuota de 24 h fuera (`comunidad_fundacion_estado` redefinida; `fundar_comunidad` ya delegaba en el helper, sólo se corrigieron sus comentarios).
- [x] 1.2 «Archivar» fuera del panel de administración. `archivarComunidad` se queda sin llamador: el archivado al salir la última persona lo hace la propia RPC.
- [x] 1.3 «Nenis Anáhuac» restaurada: viva, owner Javier, membresía `owner` activa (verificado en producción).
- [x] 1.4 Badges: chip «admin», globo negro sin borde y sin texto, sin etiqueta «Archivada». Verificado en pantalla a 375 px.
- [x] 1.5 y 1.7 Mapas táctiles: arrastrar, pinza y tocar para mover el pin; fuera el círculo de radio. Corregido además un efecto que recreaba el marcador en cada render.
- [x] 1.6 Barra lateral con scroll contenido (`overscroll-contain`) y el bloqueo de scroll de los modales arreglado: con `overflow-x: clip` en la raíz, `body.overflow=hidden` no paraba la página.
- [x] 1.8 Cabecera con la tríada de iconos y drawer de integrantes con las solicitudes arriba si mandas.
- [x] 1.9 Publicaciones y comentarios con imágenes: columna `imagenes`, bucket `community-media` privado, composer con previsualizaciones y botón de chat directo con el autor.
- [x] Ruta del bucket cerrada por privacidad: `<community_id>/<autor>/<archivo>` con dos helpers de permiso, para que las fotos de una comunidad privada no las pueda firmar cualquiera que conozca la ruta.
- [x] Verificación: `tsc`, `pnpm build`, lint sin errores, node 8/8 + 19/19 + 14/14 + 5/5 + 4/4 + 3/3 + 4/4 + 12/12, VERIFY en producción y comprobación visual.
- [ ] Push a master.

## Meta 2 — Panel de administración (área II)

Estado: **implementada y verificada**, pendiente de push.

- [x] 2.1 Nombre corregido en la base (dos migraciones: la reparación y el deshacer de una sobre-acentuación que introdujo la primera). `/admin/users` era la única pantalla que pintaba el nombre crudo: ahora pasa por `cleanDisplayName`, que además normaliza a NFC.
- [x] 2.1b Auditoría para que no vuelva a pasar: `scripts/check-texto-corrupto.mjs` barre once columnas de texto visible y corre cada 3 h en el workflow de fallos silenciosos. Verificado: encontró la fila, y tras la reparación dice que no queda ninguna.
- [x] 2.1c Candado nuevo en `scripts/apply-migration.mjs`: un archivo con bytes de control se rechaza antes de enviarlo. Postgres respondía `08P01 invalid message format` sin decir dónde.
- [x] 2.2 Los cambios de rol piden la clave de seguridad en un diálogo, con comparación en tiempo constante, freno por intentos y suelo en memoria. **La clave vive sólo en `ADMIN_SECURITY_PASSWORD`**: el repositorio es público, así que no hay valor por defecto y sin la variable el panel rechaza el cambio y lo dice.
- [ ] Push a master.

**Pendiente de Pedro:** configurar `ADMIN_SECURITY_PASSWORD` en Vercel (Production) con el valor que quiera usar. Hasta entonces, cambiar roles muestra «Falta configurar la clave de seguridad del panel».

## Meta 3 — Verificación de identidad (área III)

- [ ] 3.1 Bloqueo/confirmación al cambiar tipo o universidad con fotos subidas.
- [ ] 3.2 Aviso de privacidad en modal interno.
- [ ] 3.3 Motor de IA con las tres imágenes (selfie + frente + reverso) y proveedor real en el admin.
- [ ] 3.4 Miniaturas y visor interno en verificaciones pendientes.
- [ ] 3.5 `reject_verification_atomic` (migración) y acción de rechazo sin `permission denied`.
- [ ] Revisión + build + push.

## Meta 4 — Notificaciones y onboarding (área IV)

- [ ] 4.1 Preferencias de notificaciones en configuración (columna + GRANT por columna + página).
- [ ] 4.2 Paso de permisos de notificaciones en el onboarding.
- [ ] 4.3 Auditoría de push (`send-push`, triggers) y matriz de prioridades.
- [ ] Revisión + build + push.

## Meta 5 — Solicitudes: detalle y filtros unificados

- [ ] Detalle `/solicitudes/[id]`: categoría sobre la imagen, presupuesto como texto.
- [ ] Filtros unificados en `/buscar` y `/solicitudes`: botón + drawer con cuadrícula de categorías.
- [ ] Revisión + build + push.

---

## Verificación en producción de la Meta 1 (16-sep, tras el push)

Hecho con la sesión real del seed contra la base de producción:

- Unirse a una comunidad pública, **publicar con imagen** y ver la foto servida
  con URL firmada desde el bucket privado. La ruta guardada es
  `<community_id>/<autor>/<uuid>.webp`, la convención nueva.
- Borrar la publicación y **salir con el icono de la cabecera**: la comunidad
  queda con 0 publicaciones, 1 miembro vivo, el contador cuadrado y viva.
- La cabecera de comunidad se ve como la pidió Pedro: globo negro sin texto ni
  borde, sin etiqueta «Archivada», y los iconos que corresponden al rol.
- El nombre «Javier Rodríguez» se lee correcto en la barra lateral: la
  reparación del dato llegó a la aplicación.
- Smoke de producción: 8 de 8 en verde.

Un fallo encontrado al hacerlo y ya corregido: si el archivo elegido no se
puede decodificar (un `.png` renombrado, un HEIC que ese navegador no abre),
el mensaje llegaba crudo del navegador y en inglés («The source image could not
be decoded»). Ahora dice qué hacer.

### Pendientes conocidos que quedan anotados

- **Huérfano en `community-media`**: borrar una publicación no borra sus
  imágenes del bucket (`eliminar_publicacion_comunidad` hace DELETE de la fila
  y nada toca Storage). Queda un objeto de la prueba de hoy. El patrón del repo
  para cerrarlo es `storage_cleanup_pending`; es trabajo aparte.
- **`delete-account` no limpia `community-media`**: la Edge Function recorre
  una lista fija de buckets y el nuevo no está.
- **Moderación no ve las imágenes**: quien modera una publicación reportada no
  puede abrir la foto, porque la policy de lectura sólo alcanza a miembros de
  la comunidad. El chat lo resolvió dando lectura a admin y moderador.
- **Fechas en futuro**: una publicación recién creada se lee «dentro de 2
  minutos». Es el reloj del servidor por delante del navegador, y el formateo
  relativo no acota el futuro. Es cosmético y preexistente.
