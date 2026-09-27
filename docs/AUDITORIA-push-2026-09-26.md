# Auditoría de notificaciones push — 26 de septiembre de 2026

Encargo: «Auditoría breve — Notificaciones push nativas» y su «Extensión —
recordatorios e información personalizada», en la página de Notion
`2026-09-26 — Pendientes Frontend & Bug Prioritario Favoritos`. Corresponde a
**PT07**.

Parte de `docs/AUDITORIA-push-2026-09-16.md`, que describe el diseño. Este
documento dice **qué hay vivo en producción hoy** y corrige lo que aquella
suponía. Todo lo marcado como *verificado* sale de consultas de solo lectura
(`scripts/db-query.mjs`) y de la Management API del 26-sep, entre las 18:30 y
las 00:10 UTC. Lo que exige un teléfono en la mano queda como **PRUEBA EN
DISPOSITIVO** y no se afirma.

---

## 1. Respuesta corta

| Pregunta | Respuesta |
|---|---|
| ¿Hay push en iPhone? | **Sí, el cableado existe y está completo**: Firebase + APNs, puente del token FCM y `remote-notification`. La 1.1 (6) ya está en TestFlight. **No hay evidencia de una entrega real reciente**: no hubo ningún envío en la ventana de 6 h que guarda `pg_net`. |
| ¿Hay push en Android / Play Store? | **Sí, el mismo cableado**: `google-services.json`, plugin empaquetado, permiso `POST_NOTIFICATIONS` y canal `default` que se crea en el cliente. El alcance real es limitado: la app sigue en **prueba cerrada** (AAB 8 en revisión) y no en producción pública. |
| ¿Cuántas personas pueden recibir push hoy? | **6 de 49 perfiles** tienen `fcm_token`. Los 6 son tokens FCM válidos de forma (ninguno es un token APNs crudo). La base no guarda la plataforma, así que no se puede saber cuántos son de iPhone. |
| ¿Qué eventos mandan push? | Solo **3**: mensaje de chat, cita nueva (solo al vendedor) y confirmación de venta. Todo lo demás enciende la campana y el teléfono no se entera. |
| ¿Funcionan? | La ruta del servidor está viva y autenticada. Falta la **PRUEBA EN DISPOSITIVO** con dos cuentas y la app en segundo plano o cerrada. Ver §5. |

---

## 2. Qué dispara push hoy (verificado en `pg_trigger`)

| Tabla | Trigger | Función | Resultado real |
|---|---|---|---|
| `messages` | `push_on_message_pgnet` | `call_send_push_on_message` | Push al otro participante del chat. Bearer desde Vault y timeout de 30 s. |
| `appointments` | `push_on_appointment_pgnet` | `call_send_push_on_appointment` | Push **solo al vendedor**. El comprador solo tiene campana. |
| `sale_confirmations` | `push_on_sale_pgnet` | `call_send_push_on_sale` | Push a quien **no** inició la confirmación. |
| `sale_confirmations` | `on_sale_confirmation_inserted` | `notify_push` | **POST sin `Authorization` → 401.** Ver §3.1. |
| `bookings` | `on_booking_inserted` | `notify_push` | Igual: 401. La tabla está vacía (0 filas). |
| `bookings` | `push-on-booking` | `call_send_push_on_booking` | Llega autenticado, pero `send-push` no acepta `bookings` → 400. Tabla muerta. |

Los 11 triggers tienen `tgenabled = 'O'`, o sea que todos están activos.

---

## 3. Hallazgos nuevos (no estaban en la auditoría del 16-sep)

### 3.1 `notify_push` SÍ manda, y cada vez recibe 401
La auditoría del 16-sep, leyendo el repo, decía que `notify_push()` no hacía
nada. **En producción sí llama a `net.http_post`** (la redefinieron en Studio),
pero **sin cabecera de autorización**, y desde el 27-ago la puerta de
`send-push` lo rechaza. Consecuencias:

- **No hay push duplicado** en ventas, que era el miedo de `20260826090000`.
  El segundo POST muere en la puerta.
- **Es la causa de los 401 «fantasma»** que se vieron en `net._http_response`:
  una venta o un booking = un 401 de ruido. Ese ruido tapa los 401 de verdad
  (Vault desalineado tras una rotación), que son justo los que importan.
- Además lleva `search_path=public` sin fijar y no tiene timeout.

**Arreglo**: `DROP TRIGGER on_sale_confirmation_inserted` y `on_booking_inserted`,
y después `DROP FUNCTION notify_push()`. **Necesita tu firma**: son objetos vivos
en producción.

### 3.2 `send-push` desplegada está atrasada
Versión desplegada: **v20, del 28-ago-2026**. El repo tiene desde el 16-sep la
consulta a `acepta_notificacion`. Por lo tanto, **los interruptores de
`/configuracion/notificaciones` no gobiernan nada en producción**. Hoy afecta a
1 perfil con preferencias guardadas. Coincide con la línea base del 26-sep.

**Arreglo**: `supabase functions deploy send-push --no-verify-jwt`.
`PUSH_WEBHOOK_SECRET`, `SB_SECRET_KEY` y `FIREBASE_SERVICE_ACCOUNT` ya existen
como secretos, así que el despliegue no depende de nada más.

### 3.3 iOS: `aps-environment = development` en `App.entitlements`
Es lo que genera Capacitor, y con firma automática Xcode lo cambia a
`production` al exportar para App Store o TestFlight. **Verificar una vez** en
el `.ipa` de la 1.1 (6) (`codesign -d --entitlements - App.app`) que dice
`production`. Si dijera `development`, APNs rechaza en silencio todo push del
build de TestFlight.

### 3.4 Clave APNs: revisar antes de revocar
El Documento Maestro tiene pendiente revocar la clave **G6K8JJCWA4** (expuesta
en un chat). **Antes de hacerlo, mira en Firebase → Configuración → Cloud
Messaging → Apple qué clave APNs está subida.** Si es la misma, revocarla
**apaga todo el push de iPhone** sin ningún error visible. El orden correcto
es: crear una clave nueva, subirla a Firebase y solo después revocar la vieja.
No se pudo comprobar desde aquí: no hay acceso a la consola de Firebase.

### 3.5 Arranque en frío desde un enlace: bucle de recargas (todavía en master)
Lo encontró Javier el 26-sep en la Mac: `components/capacitor-init.tsx:172-187`.
`App.getLaunchUrl()` devuelve el mismo enlace después de cada recarga, y
`location.href` vuelve a recargar. **Sigue en master.** Afecta con seguridad a
los enlaces universales. En teoría no afecta al toque sobre un push, porque ese
entra por `pushNotificationActionPerformed` y `router.push`, no por launch URL.
**PRUEBA EN DISPOSITIVO**: con la app cerrada, tocar un push de chat.

### 3.6 Otros cabos sueltos
- `usePushNotifications.ts:299` y `:323` todavía imprimen los primeros 20
  caracteres del token. Es el pendiente A1: quitarlos antes del candidato.
- `aps.badge: 1` es fijo: el globo del icono de iOS dice siempre 1.
- Nadie limpia los tokens que FCM declara `UNREGISTERED`.

---

## 4. Lo que la campana ya sabe y el teléfono no

Tipos que hay en producción en `notifications`, que **no mandan push**:

| Tipo | Filas | Última | ¿Merece push? |
|---|---|---|---|
| `trust_upgrade` | 29 | 26-sep | No: es buena noticia, no es urgente |
| `review_reminder` | 2 | 26-sep | No: no hay nada que responder |
| `sale_confirmation` | 2 | 26-sep | Ya la cubre `push_on_sale_pgnet` |
| `comunidad_solicitud` / `_resuelta` | 1 + 1 | 16-sep | **Sí** |
| `comunidad_comentario` | 1 | 16-sep | No: el volumen es alto y no se puede agrupar |

Y dos flujos vivos que **no avisan de ninguna forma**:
- **Ofertas a una Solicitud** (`request_responses`). Hay 6 solicitudes
  publicadas, y quien publica no se entera de que le ofertaron. **Es el hueco
  más grande.**
- **Recordatorios de cita** (1 día / 1 hora). El cron corre cada 30 min y
  responde 200 (`reminders_1d: 0, reminders_1h: 0`: hay 1 sola cita en la base,
  del 20-ago), pero **solo escribe en la campana**.

---

## 5. Prueba en dispositivo — el guion que falta

Con dos cuentas de prueba (nunca cuentas reales), un iPhone con la 1.1 (6) de
TestFlight y un Android de la prueba cerrada:

1. En los dos: aceptar el permiso, cerrar sesión, iniciar sesión y confirmar
   que `profiles.fcm_token` no es NULL.
2. **App en segundo plano** (no abierta en el chat, porque la trampa §5.1 del
   16-sep suprime el aviso): mandar un mensaje de A a B → debe sonar en B.
3. Lo mismo con la app **cerrada** y tocar el aviso: debe abrir `/chat/<id>`
   sin quedar en un bucle (§3.5).
4. Agendar una cita → le suena al vendedor. Al comprador **no** (es conocido).
5. **Antes de que pasen 6 h**, correr:
   `SELECT status_code, left(content::text,160), created FROM net._http_response ORDER BY created DESC LIMIT 20;`
   Un 200 con `{"success":true}` = entregado a FCM. Un 200 con
   `{"ignored":true}` = sin token o con la preferencia apagada (parece éxito y
   no lo es). Un 401 que no venga de `notify_push` = Vault desalineado.

---

## 6. Notificaciones que vale la pena agregar

La regla de Javier: solo lo que se justifique con un flujo que ya existe. En
orden de valor:

| # | Aviso | Flujo existente | Nivel | Costo |
|---|---|---|---|---|
| 1 | **Te hicieron una oferta** a tu Solicitud | `request_responses` (vivo desde julio) | Alta | Bajo: fila en `notifications` + push |
| 2 | **Cita agendada, al comprador** | `notify_appointment_created` ya escribe su fila | Alta | Gratis con el cambio de arquitectura de abajo |
| 3 | **Recordatorio de cita 1 h antes** | cron `send-appointment-reminders` | Alta | Gratis con el cambio de abajo |
| 4 | Recordatorio de cita 1 día antes | el mismo cron | Media (sin sonido) | Gratis con el cambio de abajo |
| 5 | Solicitud de entrada a tu comunidad / te aceptaron | `comunidad_notifica` | Alta / Media | Gratis con el cambio de abajo |
| 6 | Venta completada: «deja tu reseña» | `notify_sale_completed` | Media | Gratis con el cambio de abajo |

**El cambio que abarata todo** (es el §6.2 del 16-sep y sigue vigente): **un
solo trigger de push sobre `notifications`**, y un mapa `tipo → prioridad,
enlace, grupo de preferencia` dentro de `send-push`. A partir de ahí cada aviso
nuevo es una línea en el mapa. Obliga a quitar a la vez `push_on_appointment_pgnet`
y `push_on_sale_pgnet`, o esos dos eventos sonarían dos veces (**tu firma**). El
nivel «Media» necesita un segundo canal de Android (`importance: 3`) y
`apns-priority: 5` sin sonido.

---

## 7. Recordatorios «persistentes» (la referencia de Alejandro)

Qué puede hacer cada pieza con lo que ya tiene VICINO:

| Capacidad | iOS | Android | ¿Encaja hoy? |
|---|---|---|---|
| **Push normal del servidor** (1 h / 1 día antes) | Sí | Sí | **Sí. Es el paso 1**: el cron ya existe, solo falta el cable del §6 |
| **Notificación local programada en el teléfono** (`@capacitor/local-notifications`) | Sí | Sí | Sí. Suena aunque no haya red. El reto es mantenerla sincronizada si la cita se cancela o se mueve |
| **Aviso fijo en la bandeja** (ongoing) | No existe | Sí (notificación ongoing; en Android 16, *Live Updates*) | Solo Android. Requiere código nativo |
| **Live Activity** en la pantalla de bloqueo y la Dynamic Island | ActivityKit + extensión de widget + tokens de Live Activity por APNs | — | **No por ahora**: el plan PT07 dice explícitamente que no se cree ActivityKit ni WidgetKit por una referencia |

Qué debería mostrar el aviso de una cita: **servicio, vendedor, hora y «en
1 h»**, y **nunca la dirección exacta**, por la regla de fuzzing a 100 m. Tocar
el aviso → `/citas`. Deja de mostrarse cuando pasa la hora o cuando la cita se
cancela.

**Recomendación**: hacer primero el push del servidor 1 h y 1 día antes (§6,
filas 3 y 4). Medir si alguien usa las citas: hoy hay **1 cita en toda la base**.
Una Live Activity para una función con una sola cita es construir para nadie.
Retomarlo en PT10 si las citas despegan.

---

## 8. Orden propuesto

1. **Hoy, sin firma**: desplegar `send-push` (§3.2). Correr la prueba en
   dispositivo (§5).
2. **Con tu firma**: `DROP` de `notify_push` y de sus dos triggers (§3.1).
   Antes de revocar G6K8JJCWA4, revisar Firebase (§3.4).
3. **Antes del candidato iOS**: arreglar el bucle de arranque en frío (§3.5),
   quitar los prefijos del token (§3.6) y verificar los entitlements del `.ipa`
   (§3.3).
4. **Siguiente bloque**: el trigger único sobre `notifications` + el aviso de
   ofertas a Solicitudes + los recordatorios de cita (§6).
5. **PT10**: notificaciones locales o Live Activity, solo si las citas tienen
   uso (§7).
