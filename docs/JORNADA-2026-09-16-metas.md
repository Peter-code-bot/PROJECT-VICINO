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

---

## Meta 3 — Verificación de identidad (Área III)

### Lo que se hizo

- **3.1 Los datos se bloquean tras subir.** Cambiar el tipo de documento o la
  universidad con fotos ya subidas ya no cambia nada en silencio: abre una
  confirmación, y al aceptar descarta las tres imágenes y vuelve el trámite a
  revisión. Al cancelar no se mueve nada.
- **3.2 El aviso de privacidad se abre encima.** Era un enlace que navegaba
  fuera, y volver significaba repetir las fotos, porque los archivos elegidos no
  sobreviven a una navegación. Ahora es un modal. El texto legal se extrajo a
  `components/legal/aviso-privacidad-cuerpo.tsx` y lo leen los dos sitios: la
  página y el modal. Copiarlo habría dejado a alguien aceptando un documento
  distinto del publicado.
- **3.3 El motor de IA ahora sí coteja.** Antes recibía UNA ruta y se disparaba
  al subir el frente, así que el modelo nunca veía la selfie ni el reverso: era
  imposible que comparara caras, aunque el panel presentara su respuesta como si
  lo hubiera hecho. Ahora las tres imágenes van en una sola llamada.
- **3.4 Miniaturas y visor en el panel.** Los tres enlaces «Ver imagen» abrían
  el navegador del sistema desde el APK. Ahora son miniaturas con un visor a
  pantalla completa, con flechas, teclado y botón atrás de Android.
- **3.5 Rechazar ya funciona.** Fallaba el 100% de las veces con «permission
  denied for table seller_verification»: `authenticated` no tiene GRANT de
  UPDATE sobre `reviewed_at` ni `reviewer_note` (20260826301000, a propósito), y
  un GRANT ausente se comprueba antes que cualquier policy. Por eso aprobar sí
  funcionaba: pasa por una función SECURITY DEFINER. Ahora rechazar tiene su
  espejo, `reject_verification_atomic`.

### Lo que encontró la revisión adversarial, y está corregido

Cuatro fallos críticos en el motor y cuatro en la pantalla de subida. Los que
importan:

- **La evidencia se podía suplantar.** Las rutas de las imágenes venían del
  cliente y sólo se comprobaba que empezaran por el UUID de quien llama. La
  policy del bucket permite cualquier nombre bajo el propio prefijo, así que se
  podía subir un segundo juego de fotos que sí casaran y pedir el análisis de
  ésas: el modelo analizaba unas imágenes y el moderador veía otras, con el
  cartel «La IA dice: todo correcto» encima. Variante más barata: pasar la misma
  ruta como selfie y como frente hacía que el cotejo comparara la foto del
  documento consigo misma. **Las rutas ahora salen de la fila.**
- **Un rechazo automático era casi irreversible y le bastaba una corazonada.**
  Sólo uno de los cinco caminos a «rechazado» exigía confianza mínima: una
  respuesta con 35% de confianza en el rostro y el propio modelo pidiendo
  revisión humana rechazaba igual. Y «rechazado» es un estado resuelto, así que
  el cron borra las tres imágenes en menos de una hora y la cola del panel deja
  de mostrar el trámite. **Los cinco caminos piden ahora un hallazgo fundado.**
- **Inyección de prompt.** El nombre de la universidad se interpolaba entre
  comillas en el texto que lee el modelo, así que un valor con un salto de línea
  podía dictar la respuesta entera y fabricar la evidencia con la que decide el
  moderador. Ahora va serializado en JSON y con cota de forma.
- **La carrera con el revisor.** El análisis tarda hasta 28 segundos y escribía
  con service_role sin mirar el estado: si un admin aprobaba en esa ventana, la
  escritura ponía «rechazado» dejando el perfil verificado. Ahora el UPDATE
  lleva guarda de estado y 0 filas significa «alguien ya lo resolvió».
- **La cuota se gastaba en no-gastos.** Se consumía antes de descargar y de
  validar, así que tres fotos grandes quemaban un intento por subida sin una
  sola llamada de pago, y a los cinco la persona quedaba bloqueada una hora.
- **La pantalla podía mentir para siempre.** Si fallaba el borrado del bucket,
  las tarjetas seguían diciendo «Subido correctamente» sobre una fila vacía: el
  trámite quedaba sin documentos y el admin no podía aprobarlo.
- **Se escribía en TODAS las filas del historial.** `user_id` no es único en esa
  tabla, así que subir una foto resucitaba en la cola un rechazo viejo con su
  nota de revisión, que el admin no puede limpiar.
- **Datos del documento fuera del alcance del borrado.** Se guardaba el texto
  crudo del modelo, que puede traer nombre, CURP y clave de elector, en una
  columna que el cron de purga no toca: se borraban las imágenes cumpliendo el
  Aviso 15 y se conservaba lo extraído de ellas.

### La insignia, que era asimétrica

Aprobar sumaba 30 puntos **sin mirar si el perfil ya estaba verificado**, y el
vendedor puede devolver su propia verificación a «pendiente» desde su pantalla.
O sea que el ciclo aprobar, volver a pendiente, aprobar era repetible y regalaba
30 puntos cada vuelta, con los rankings en producción ordenando por eso. Y al
volver a pendiente nadie retiraba nada: quedaba un perfil que decía «identidad
verificada» con cero documentos.

La invariante vive ahora en la base (`20260916190000`), no en cada escritor: hay
tres que mueven ese estado y escribirla en cada uno garantizaba que el cuarto se
olvidara. Probado contra producción dentro de una transacción que aborta: 4 de 4
casos, incluida la idempotencia de la resta.

## Meta 4 — Notificaciones (Área IV)

- **4.1 Pantalla de preferencias** encima de «Editar perfil», con cuatro
  interruptores. La columna nueva es un `jsonb` y no una columna booleana por
  tipo: en esta tabla cada columna nueva cuesta una migración y su GRANT, y un
  GRANT olvidado rompe todo SELECT que la nombre. Clave ausente = encendido, así
  que ningún perfil necesita relleno.
- **4.2 Paso de permiso en el alta**, con el valor explicado antes del diálogo
  del sistema. El hook dejó de pedir el permiso en silencio al arrancar: en iOS
  negarlo es definitivo, y el arranque silencioso no ganaba permisos, los
  quemaba.
- **4.3 Auditoría del push** en `docs/AUDITORIA-push-2026-09-16.md`, con la
  matriz de prioridades y la causa estructural: no hay ningún disparador de push
  sobre `notifications`.

### Lo que encontró la revisión, y está corregido

- **La pantalla prometía un control que el backend no ejercía.** La función de
  push no consultaba la preferencia, así que apagar «Mensajes de chat» no apagaba
  nada. Ahora la consulta.
- **El token de push dejaba de refrescarse** tras cerrar y volver a entrar en la
  misma sesión de app, porque el efecto pasó a correr una vez por carga de
  documento y el regreso es una navegación blanda.

## Meta 5 — Detalle de solicitud y filtros unificados

- La categoría se apoya en la **esquina inferior derecha de la foto**,
  sobresaliendo 10 px, con fondo opaco propio para que se lea sobre una foto
  clara. Medido en el navegador: sobresale exactamente 10 px.
- El presupuesto es **texto**, en el color principal, no en verde ni como botón.
  Comprobado que su color es idéntico al del título.
- Los carruseles de categorías de `/buscar` y del feed de solicitudes se
  sustituyen por un botón que abre una cuadrícula con **todas** las categorías a
  la vez, sin bordes negros. En el carrusel, las categorías del final no
  existían para quien no arrastraba, y arrastrar en móvil competía con el gesto
  de cambiar de pestaña.

## Pendientes que quedan anotados

- **La función de push está escrita pero no desplegada.** Hasta que se
  despliegue, los interruptores de chat y ventas se guardan pero no se respetan.
- **Comunidades y novedades no tienen quien mande push todavía.** Su preferencia
  se guarda y valdrá cuando exista el productor; hoy sólo aparecen en la campana.
- **`ADMIN_SECURITY_PASSWORD` sigue sin definirse en Vercel.** Sin esa variable,
  el diálogo de seguridad del panel de roles no deja cambiar ningún rol.
- **La subida al bucket no comprueba el consentimiento biométrico.** El único
  guardia es la casilla del formulario, que se salta con la consola abierta; la
  policy de INSERT del bucket no mira la constancia. El servidor sí lo exige
  antes de analizar, así que nada se procesa sin consentimiento, pero la selfie
  puede llegar al bucket sin él. Cerrarlo es una policy nueva y hay que
  comprobar antes en qué orden se registra el consentimiento, o rompe el alta.
- **`@google/generative-ai` es una dependencia muerta.** No se importa en ningún
  sitio; el proveedor real es OpenAI. Se corrigió la etiqueta del panel, que
  decía «Gemini dice».
- **La aprobación automática por IA nace apagada**
  (`VERIFICACION_APROBACION_AUTOMATICA`). Un «aprobado» por ese camino no
  reparte insignia ni puntos, y además hace que el cron borre los documentos y
  saque la fila de la cola: nadie podría arreglarlo después. Se enciende cuando
  ese camino escriba también el perfil.
- **Un perfil aprobado sin insignia en producción.** La fila de verificación más
  reciente está en «aprobada» y su perfil tiene `is_verified = false` y cero
  puntos. Es anterior a hoy y no lo toca nada de este cambio, pero conviene
  saber por qué quedó así antes de fiarse del contador.
