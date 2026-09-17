# Auditoría del push — 16 de septiembre de 2026

> **Esto era una auditoría y no cambiaba ni la Edge Function ni un trigger.**
> Ya no es del todo cierto, y conviene leerlo antes que nada:
>
> - **`send-push` SÍ cambió** (16-sep, más tarde el mismo día): antes de
>   enviar consulta `public.acepta_notificacion` con el id del destinatario y
>   el grupo que le corresponde a la tabla (`messages` → `chat`;
>   `appointments` y `sale_confirmations` → `ventas`). Si devuelve `false` no
>   manda nada y responde `{"ignored":true,"reason":"Preference off: …"}`; si
>   la RPC falla, **manda** y deja constancia en el log (falla abierto, ver
>   DECISION 3 de la migración). Eso convierte el paso 4 de la sección 6.3 en
>   código escrito, **pendiente de despliegue**: el repo y producción
>   discrepan hasta que alguien despliegue la función.
> - **Ningún trigger se ha tocado.** Todo lo demás de la sección 6 sigue
>   pendiente y sigue exigiendo tu firma, porque implica `DROP` de triggers
>   vivos y cambiar el comportamiento del teléfono de todo el mundo.
> - Lo que ya se entregó antes en esta tarea son las *preferencias* (columna,
>   RPC, pantalla y paso del alta).

Todo lo que sigue se leyó del repo: `supabase/functions/send-push/index.ts`,
`supabase/migrations/20260604000002`, `20260604000003`, `20260604000005`,
`20260826090000`, `20260826140000`, `20260411000002`, `20260511000001`,
`20260912200000`, `20260912230000`, `supabase/functions/send-appointment-reminders/index.ts`
y `apps/web/app/(marketplace)/notificaciones/notification-list.tsx`.
Lo que **no** se pudo comprobar leyendo (estado real de `pg_trigger`, de
`net._http_response` y de los secretos del proyecto) está marcado como
**VERIFICAR EN PRODUCCIÓN** y nunca se afirma.

---

## 1. La respuesta corta a tu síntoma

> «Envié un mensaje y al aparecer el icono de notificaciones en la aplicación,
> en la parte de arriba no me llegó ninguna notificación push.»

**La causa estructural: nada en el diseño conecta «entró una fila en
`notifications`» con «manda un push».** No existe ningún trigger de push sobre
la tabla `notifications`. El push se dispara desde tres tablas de negocio
concretas, y `send-push` sólo acepta esas tres:

```ts
// supabase/functions/send-push/index.ts
const allowedTables = ["messages", "appointments", "sale_confirmations"];
if (!allowedTables.includes(payload.table) || payload.type !== "INSERT") { ...400 }
```

O sea que **toda** la campana de la app —comunidades, reseñas, nivel de
confianza, recordatorios de cita, verificación de identidad, venta
completada— llena `notifications`, pinta el icono de arriba… y el teléfono no
se entera de nada. No es un fallo: es que ese cable no existe.

Hay un detalle que apunta directo a tu caso. **Los mensajes de chat NO crean
fila en `notifications`**: el trigger que lo hacía se borró entero
(`20260511000001_drop_message_notification_trigger.sql`, porque llenaba la
tabla de filas que la UI nunca pintaba), y la campana además filtra
`.neq("tipo", "message")`. Por lo tanto:

- Si **se encendió la campana**, lo que llegó **no era un mensaje de chat** —
  era uno de los tipos de la sección 3, que no manda push por diseño.
- Si de verdad **era un mensaje de chat**, entonces el push sí se disparó y
  falló en el camino. La sección 5 tiene el orden de diagnóstico.

Lo más probable, si probabas con la app abierta, es la trampa de la sección
5.1: en Android un mensaje FCM con carga `notification` recibido **con la app
en primer plano** se entrega a la app, no a la bandeja del sistema. Se ve
exactamente igual que «no me llegó push».

---

## 2. Qué dispara push HOY

| Evento | Trigger | `table` que envía | ¿`send-push` lo acepta? | A quién le suena |
|---|---|---|---|---|
| Mensaje de chat nuevo | `push_on_message_pgnet` → `call_send_push_on_message()` | `messages` | **Sí** | Al otro participante del chat |
| Cita agendada | `push_on_appointment_pgnet` → `call_send_push_on_appointment()` | `appointments` | **Sí** | **Sólo al vendedor** (`record.seller_id`) |
| Confirmación de venta iniciada | `push_on_sale_pgnet` → `call_send_push_on_sale()` | `sale_confirmations` | **Sí** | Al que **no** la inició |
| `bookings` (tabla muerta) | `push-on-booking` → `call_send_push_on_booking()` | `bookings` | **No → 400** | A nadie |
| `sale_confirmations` (segundo trigger) | `on_sale_confirmation_inserted` → `notify_push()` | — | — | A nadie (ver abajo) |

Tres cosas que conviene tener escritas:

**a) Dos de los tres triggers vivos no existen en el repo.**
`push_on_appointment_pgnet` lo crea `20260604000005`. Pero
`push_on_message_pgnet` y `push_on_sale_pgnet` **no los crea ninguna
migración**: sólo se los *cita* (`20260826090000` redefine sus funciones con
`CREATE OR REPLACE`, que no crea el trigger). Es el mismo patrón de deriva que
ya documentó `20260826240000` con los grants de `profiles`. **Un entorno nuevo
levantado sólo desde `supabase/migrations` nace sin push de chat y sin push de
ventas, y nadie se entera** — porque el modo de fallo del push es el silencio.
→ Pendiente: una migración de constancia que cree los dos triggers con
`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`.

**b) `notify_push()` no manda nada.** Su cuerpo en el repo
(`20260604000002_push_triggers.sql`) construye la variable `payload`, no la
usa, y hace `RETURN NEW`. No hay ninguna llamada a `net.http_post`. Por lo
tanto el comentario de `20260826090000` que dice que `sale_confirmations`
«dispara dos notificaciones» **es incorrecto tal como está el repo**: la
segunda es un no-op.
→ **VERIFICAR EN PRODUCCIÓN** antes de darlo por bueno, porque esa función
pudo redefinirse en Studio:
```sql
SELECT prosrc LIKE '%http_post%' AS manda_algo
FROM pg_proc WHERE proname = 'notify_push';
-- esperado si el repo tiene razón: false
```

**c) El push de una cita sólo le llega al vendedor.** `send-push` fija
`receiverId = appointment.seller_id`. En cambio
`notify_appointment_created()` (`20260826140000`) inserta **dos** filas en
`notifications`, una para el comprador y otra para el vendedor. O sea que el
comprador ve la campana y no le suena el teléfono, aunque la cita sea suya.

---

## 3. Qué NO dispara push (y por qué)

Todos estos escriben **sólo** en `notifications`. La campana se enciende, el
teléfono calla.

| Evento | Quién lo escribe | Tipo en `notifications` |
|---|---|---|
| Solicitud para entrar a una comunidad | `comunidad_notifica` (`20260912230000:1530`) | `comunidad_solicitud` |
| Respuesta a tu solicitud (aceptada / rechazada) | `comunidad_notifica` (`:1695`) | `comunidad_solicitud_resuelta` |
| Te nombran moderador | `comunidad_notifica` (`:1873`) | `comunidad_moderador` |
| Comentario en tu publicación de comunidad | `notificar_comentario_de_comunidad` | `comunidad_comentario` |
| Venta completada («deja tu reseña») | `notify_sale_completed` | `sale_completed` |
| Nueva reseña recibida | `notify_new_review` | `review_reminder` |
| Subida de nivel de confianza | `update_trust_level_from_points` | `trust_upgrade` |
| Recordatorio de cita a 1 día y a 1 hora | Edge Function `send-appointment-reminders` | `recordatorio_cita_1d`, `recordatorio_cita_1h` |
| Verificación de identidad aprobada / rechazada | `notify_user_as_staff` desde el panel admin | el que pase el panel |
| Cita agendada, **lado del comprador** | `notify_appointment_created` | `cita_agendada` |

Y dos que no avisan **en absoluto**, ni por campana:

- **Solicitudes de compra y sus ofertas** (`purchase_requests`,
  `20260710000001`). No insertan en `notifications` en ninguna parte. Quien
  publica una solicitud no se entera de que le ofertaron, ni por push ni por
  campana. Es el hueco más grande de los que hay.
- **Likes en comunidades.** Decisión ya tomada y bien razonada
  (`20260912200000:1429`): un post con 40 likes serían 40 avisos sin forma de
  agrupar. No tocar.

Motivos por los que ninguno manda push, en orden de importancia:

1. **No hay trigger de push sobre `notifications`.** Es la causa de todos.
2. `send-push` sólo conoce tres tablas y `type === "INSERT"`. `sale_completed`
   está doblemente bloqueado: nace de un `AFTER UPDATE`.
3. `send-push` no tiene ninguna rama para nada que no sea esas tres tablas:
   no sabría de dónde sacar el destinatario, el texto ni el enlace.

---

## 4. Lo que el push manda hoy, y por qué todo suena igual

`send-push` fija la misma urgencia máxima para los tres eventos, sin mirar
cuál es:

```
android.priority = 'high',  android.notification.channel_id = 'default'
apns-priority = '10',       aps.sound = 'default', aps.badge = 1
```

Y el canal `default` de Android se crea con `importance: 5` (máxima),
`lights: true`, `vibration: true` (`hooks/usePushNotifications.ts`).

Consecuencia para la matriz que pediste: **hoy no existe ningún nivel
intermedio**. Todo suena y vibra, o no llega. Implementar «media» y «sólo
campana» necesita:

- un **segundo canal** de Android (p. ej. `suave`, `importance: 3`, sin
  vibración) creado en el cliente, y `channel_id` elegido por tipo en
  `send-push`;
- `apns-priority: '5'` y `aps.sound` ausente para el nivel medio;
- y que `send-push` reciba el `tipo` para poder decidir — hoy no lo recibe,
  porque no lee `notifications`.

El `badge: 1` es además un número fijo: no cuenta nada. El globo del icono de
iOS dirá siempre 1.

---

## 5. Si de verdad era un mensaje de chat: orden de diagnóstico

Del más probable al menos, y cada uno con cómo comprobarlo.

### 5.1 La app estaba en primer plano  ← empieza por aquí
En Android, un mensaje FCM con carga `notification` que llega **con la app
abierta** se entrega a la app (`pushNotificationReceived`), no a la bandeja del
sistema. El hook muestra entonces un toast de Sonner… y lo **suprime** si ya
estás en esa misma pantalla:

```ts
const ruta = rutaInternaDePush(notification.data);
if (ruta !== null && ruta === window.location.pathname) return;
```

(Ese `rutaInternaDePush` es de la misma tanda de arreglos: `notification.data`
llega sin tipo desde el puente nativo y su `url` se pasaba tal cual a
`router.push()`. Ahora se comprueba con `destinoSeguro` que sea una ruta interna
antes de navegar, y un enlace descartado deja el aviso sin botón en vez de
mover a nadie.)

O sea que probar el chat con el chat abierto produce exactamente «no me llegó
nada». **Prueba con la app cerrada o en segundo plano**, y con dos cuentas
distintas en dos teléfonos.

### 5.2 El destinatario no tiene `fcm_token`
`send-push` responde **200** con `{"ignored":true,"reason":"User has no FCM token"}`.
Un 200. No hay error en ningún sitio.

```sql
SELECT id, fcm_token IS NOT NULL AS tiene_token
FROM public.profiles WHERE id = '<uuid-del-destinatario>';
```

Cómo se queda en NULL: cerrar sesión lo borra a propósito
(`app/(auth)/actions.ts:278` y `hooks/use-logout.ts:42`, para que el token no
se quede apuntando a la cuenta anterior), y `20260826220000` puso a NULL los
tokens compartidos entre cuentas. Si después el dispositivo no volvió a
registrarse, silencio.

**Corrección (16-sep, más tarde el mismo día).** Aquí decía que «el hook
re-registra en cada arranque, así que el token se vuelve a guardar solo». Era
verdad a medias y la mitad que faltaba producía justo este síntoma: el efecto de
`hooks/usePushNotifications.ts` tiene las dependencias vacías, o sea que corría
**una vez por carga del documento**, no una vez por sesión. Al salir y volver a
entrar, `use-logout` dejaba `fcm_token` en NULL, `login-form` navegaba **blando**
con `router.push`, el layout raíz seguía montado y no había segundo `register()`:
la cuenta recién entrada se quedaba sin token hasta el siguiente arranque en
frío. Lo mismo le pasaba a quien concedía el permiso desde Ajustes del sistema
con la app viva.

Ya está arreglado en el hook: además del registro de arranque, se re-registra
cuando `onAuthStateChange` trae una sesión de otra cuenta y cada vez que la app
vuelve al primer plano (`appStateChange`). Con eso, 5.2 vuelve a ser lo que decía
esta nota. Queda una ventana conocida: un login de correo y contraseña ocurre en
el servidor, así que el cliente del navegador no emite ningún evento de sesión
hasta que la pestaña se oculta y se vuelve a ver — en la app eso es el primer
paso a primer plano, no el instante del login.

### 5.3 En iOS, el puente del token FCM no disparó
En iOS el plugin oficial entrega el token **APNs**, que el hook ignora a
propósito; el token de FCM llega por un deep link interno que emite el
`AppDelegate` (`vicino://fcm-token/...`). Si ese puente no se ejecuta,
`fcm_token` se queda en NULL y estamos en 5.2. Se ve en el log del dispositivo:
`APNs token received. Esperando token FCM del native bridge...` **sin** el
`Push token received via native bridge (ios)` detrás.

### 5.4 Android: falta el canal `default`
Android 8+ **descarta** toda notificación cuyo `channel_id` no exista, sin
pintar nada y sin avisar. `send-push` manda siempre `channel_id: 'default'`.
Si el canal no se creó en ese dispositivo, el push llega y el sistema lo tira.

### 5.5 `pg_net` no lee la respuesta: el fallo silencioso clásico
Los cuatro `call_send_push_*` hacen `PERFORM net.http_post(...)`. `PERFORM`
descarta el id de la petición, nadie lee la respuesta, y el bloque
`EXCEPTION WHEN OTHERS` se traga cualquier error con un `RAISE WARNING`. **La
única evidencia de si el push salió está en `net._http_response`, y esa tabla
se autoborra a las 6 horas.** Por eso hay que mirarla el mismo día:

```sql
SELECT id, status_code, timed_out, error_msg, created
FROM net._http_response
ORDER BY created DESC LIMIT 20;
```

- `timed_out = true` → ya pasó el 26-ago con el default de 5000 ms;
  `20260826090000` subió los cuatro triggers a 30000 ms. Un arranque en frío de
  `send-push` pasa de 5 s con normalidad.
- Ojo: un timeout de `pg_net` **no** cancela la Edge Function. Sigue corriendo;
  lo único que se pierde es saber si terminó.

### 5.6 `send-push` devolvió 401
La puerta compara el bearer contra `PUSH_WEBHOOK_SECRET` o `SB_SECRET_KEY`, y
los triggers mandan `'Bearer ' || vault.decrypted_secrets.service_role_key`.
**Si la `service_role` se rota sin actualizar el secreto del Vault (o al
contrario), todos los push pasan a 401 y nadie se entera.** Y es relevante hoy:
el expediente de la `service_role` filtrada en el repo público sigue abierto.
Se ve como `status_code = 401` en la consulta de 5.5.

### 5.7 FCM rechazó el mensaje
Token caducado o desregistrado, o `FIREBASE_SERVICE_ACCOUNT` mal. `send-push`
hace `console.error("FCM Error", ...)` y lanza: **500** en 5.5, y el detalle en
los logs de la función. Nada limpia los tokens que FCM declara
`UNREGISTERED`, así que se acumulan y cada envío falla otra vez.

---

## 6. Matriz de prioridades y plan exacto

### 6.1 La matriz que pediste

**ALTA — suena, vibra y entra en la pantalla de bloqueo.**
Criterio: alguien está esperando tu respuesta ahora mismo, o hay dinero o una
cita de por medio. Canal `default` (`importance 5`), `apns-priority 10`,
`sound: 'default'`.

| Evento | Estado | Grupo de preferencia |
|---|---|---|
| Mensaje de chat nuevo | **Ya funciona** | `chat` |
| Confirmación de venta iniciada | **Ya funciona** | `ventas` |
| Cita agendada — al vendedor | **Ya funciona** | `ventas` |
| Cita agendada — al comprador | **Falta** | `ventas` |
| Respuesta a tu solicitud de comunidad (aceptada o rechazada) | **Falta** | `comunidades` |
| Recordatorio de cita a 1 hora | **Falta** | `ventas` |
| Oferta a tu solicitud de compra | **Falta y ni campana tiene** | `ventas` |

**MEDIA — llega al centro de notificaciones sin sonido.**
Criterio: te interesa hoy, no en los próximos treinta segundos. Canal nuevo
`suave` (`importance 3`, sin vibración), `apns-priority 5`, sin `sound`.

| Evento | Estado | Grupo |
|---|---|---|
| Solicitud para entrar a tu comunidad (a dueño y moderadores) | **Falta** | `comunidades` |
| Venta completada («deja tu reseña») | **Falta** | `ventas` |
| Recordatorio de cita a 1 día | **Falta** | `ventas` |
| Verificación de identidad aprobada o rechazada | **Falta** | `novedades` |
| Te nombran moderador | **Falta** | `comunidades` |

**SÓLO CAMPANA — nunca push.**
Criterio: volumen alto sin agrupación posible, o nada que hacer al recibirlo.

| Evento | Por qué |
|---|---|
| Comentario en tu publicación de comunidad | El mismo razonamiento que ya se aplicó a los likes: un post activo genera decenas y no hay tabla de agregación ni cron que los consolide |
| Nueva reseña recibida | No hay nada que responder |
| Subida de nivel de confianza | Buena noticia, no urgente |
| Disputas (`dispute`) | Hoy no hay ningún emisor; decidir cuando exista |
| Likes | Ya decidido en `20260912200000`: no notifican ni en campana |

### 6.2 El cambio recomendado: que el push salga de `notifications`

Hoy cada tipo nuevo de aviso cuesta **un trigger nuevo + una rama nueva dentro
de `send-push`**. Eso es exactamente por lo que llevamos cuatro tablas
conectadas y diez tipos sin conectar. La tabla `notifications` ya tiene todo lo
que el push necesita —`user_id`, `titulo`, `mensaje`, `data`, `tipo`— y ya la
escriben once funciones distintas.

Propuesta: **un solo trigger sobre `notifications`**, y `send-push` traduce
`tipo` → prioridad, enlace y grupo de preferencia con un mapa. A partir de ahí,
un tipo nuevo es una entrada en ese mapa y nada más.

Seguridad: `notifications` **no tiene ninguna policy de INSERT** y
`create_notification` está revocada para todos menos `service_role`
(`20260826080000`), así que un cliente no puede fabricarse un push. **La
excepción a vigilar es `notify_user_as_staff`**: hoy un admin o moderador puede
insertar cualquier título y mensaje a cualquier usuario, y con este cambio eso
pasaría a ser un push a la pantalla de bloqueo. Es la misma superficie de
phishing que ya documenta `20260826080000`, pero con más alcance. Decide si ese
tipo entra en la lista de los que empujan.

### 6.3 Pasos, en orden

**Paso 1 — `send-push`: aceptar `notifications`.**
```ts
const allowedTables = ["messages", "notifications"];
```
Se quitan `appointments` y `sale_confirmations` **en el mismo cambio** que el
paso 2, no antes. `messages` se queda porque los mensajes de chat **no**
escriben en `notifications` (trigger borrado en `20260511000001`).

Ramas nuevas para `table === "notifications"`:
`receiverId = record.user_id`, `pushTitle = record.titulo`,
`pushBody = record.mensaje`, y `pushUrl` según `tipo` + `data`
(`comunidad_*` → `/comunidades/<community_id>`, `cita_*` → `/citas`,
`sale_*` → `/chat/<chat_id>` o `/historial`, resto → `/notificaciones`).

**Paso 2 — retirar los dos caminos que quedarían duplicados.**
`notify_appointment_created` y `notify_sale_confirmation_created` **ya**
insertan en `notifications`. Si se enciende el camino nuevo sin apagar los
viejos, cada cita y cada confirmación mandan **dos** push.
```sql
DROP TRIGGER IF EXISTS push_on_appointment_pgnet ON public.appointments;
DROP TRIGGER IF EXISTS push_on_sale_pgnet        ON public.sale_confirmations;
```
**Esto necesita tu firma: son `DROP` sobre triggers vivos en producción.**
Beneficio inmediato y gratis: el comprador de una cita empieza a recibir su
push, porque su fila en `notifications` ya se escribía.

**Paso 3 — el trigger que falta, y es UNO.**
Migración nueva con `public.call_send_push_on_notification()`, copiada del
molde de `call_send_push_on_appointment()` (`20260826090000`): `SECURITY
DEFINER`, `SET search_path TO ''`, secreto desde `vault.decrypted_secrets`,
`timeout_milliseconds := 30000`, y `EXCEPTION WHEN OTHERS → RAISE WARNING →
RETURN NEW`, porque un push fallido no puede deshacer el aviso.
```sql
DROP TRIGGER IF EXISTS push_on_notification_pgnet ON public.notifications;
CREATE TRIGGER push_on_notification_pgnet
  AFTER INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.call_send_push_on_notification();
```
Conviene que el trigger **no dispare** para los tipos de «sólo campana»
(`WHEN (NEW.tipo NOT IN (...))`) además del filtro de `send-push`: así el POST
ni se encola y no se gasta una invocación por cada comentario de comunidad.

**Paso 4 — respetar las preferencias. HECHO EN EL REPO, PENDIENTE DE
DESPLIEGUE.** Del lado de la base ya estaba todo: la migración
`20260916180000_preferencias_de_notificaciones.sql` deja
`public.acepta_notificacion(uuid, text)` con `EXECUTE` sólo para
`service_role`, justo para esto. Ahora `send-push` lo llama de verdad, antes
incluso de leer el perfil del destinatario (si lo tiene apagado, no hace falta
ni su token). El grupo se deriva de la tabla del webhook, que es lo único que
esta función recibe hoy: `messages` → `chat`; `appointments` y
`sale_confirmations` → `ventas`.

Se compara con `=== false` **a propósito**: clave ausente y perfil ausente
devuelven `true`, y ante la duda se notifica. Un sistema de preferencias que se
traga un mensaje de quien quiere comprarte hace más daño que uno que manda un
aviso de más. Por lo mismo, un **error** de la RPC (red, un `EXECUTE` perdido en
una rotación de llaves) no bloquea el envío: manda igual y lo deja escrito en el
log de la función, que es la única forma de que un `REVOKE` accidental no se
convierta en «las preferencias dejaron de aplicarse y todo parecía funcionar».

Tres cosas que quedan de este paso:

1. **Desplegar la función.** Mientras no se despliegue, el repo dice una cosa y
   producción hace otra: los interruptores de la pantalla no gobiernan nada.
2. El `comment on function public.acepta_notificacion` que puso la migración
   dice «Pendiente de conectar»; en producción ese comentario ya está
   desactualizado.
3. Cuando el push pase a salir de `notifications` (paso 1), el grupo dejará de
   derivarse de la tabla y tendrá que derivarse de `tipo`, con el mapa de la
   sección 6.1. El mapa de `send-push` es la **tercera** copia de las cadenas
   `chat`/`ventas`/`comunidades`/`novedades` — las otras dos viven en
   `apps/web/lib/notificaciones/claves.ts`, que sí las comparte entre la
   pantalla y la Server Action. Esta tercera no la vigila TypeScript: corre en
   Deno y no comparte tsconfig.

**Paso 5 — los tres niveles de sonido.** Segundo canal de Android (`suave`,
`importance: 3`) creado junto al `default` en `hooks/usePushNotifications.ts`
(hay una función `crearCanalAndroid` a la que añadirlo), y en `send-push` un
mapa `tipo → nivel` que elija `channel_id`, `apns-priority` y si va `sound`.

**Paso 6 — limpieza, cada una con su decisión.**
- `push-on-booking` sobre `public.bookings`: hoy manda un POST que recibe 400, y
  la tabla no recibe inserts de la app. → `DROP TRIGGER` (tu firma).
- `on_sale_confirmation_inserted` → `notify_push()`: verificar primero lo de la
  sección 2.b y, si es el no-op que dice el repo, `DROP` de las dos cosas.
- Migración de constancia que cree `push_on_message_pgnet` y
  `push_on_sale_pgnet`, que viven en producción y en ninguna migración.
- Un tope por persona y por hora para el push, **en la base**, no en la app:
  cada fila de `notifications` se convierte en un POST de `pg_net` + una
  invocación de Edge Function + una llamada a FCM, y una publicación muy
  comentada hace abanico. Los limitadores de `lib/rate-limit.ts` no cubren
  nada de esto: ni pasan por Next, ni existen sin credenciales de Upstash.
- Limpiar los tokens que FCM declara `UNREGISTERED` en vez de reintentarlos en
  cada envío.
- `aps.badge` dejó de ser útil siendo `1` fijo: o se calcula el número real de
  no leídos, o se quita.

---

## 7. Lo que hay que comprobar el mismo día (la ventana son 6 horas)

```sql
-- 1. Qué triggers de push existen DE VERDAD.
SELECT c.relname AS tabla, t.tgname, p.proname
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_proc  p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND (p.proname LIKE 'call_send_push%' OR p.proname = 'notify_push')
ORDER BY 1, 2;

-- 2. Si los POST salieron y con qué respuesta. Se autoborra a las 6 h.
SELECT id, status_code, timed_out, error_msg, created
FROM net._http_response ORDER BY created DESC LIMIT 20;

-- 3. Si el destinatario tenía token.
SELECT id, fcm_token IS NOT NULL AS tiene_token, last_seen_at
FROM public.profiles WHERE id = '<uuid>';

-- 4. Cuántos perfiles pueden recibir push hoy.
SELECT count(*) FILTER (WHERE fcm_token IS NOT NULL) AS con_token, count(*) AS total
FROM public.profiles;

-- 5. Tokens repetidos entre cuentas (el fallo de 20260826220000).
SELECT fcm_token, count(*) FROM public.profiles
WHERE fcm_token IS NOT NULL GROUP BY 1 HAVING count(*) > 1;
```

Y en el dashboard: los logs de la función `send-push` del momento de la prueba.
Un `{"ignored":true}` con 200 es el fallo más fácil de pasar por alto, porque
tiene la misma pinta que un éxito.
