# Auditoría del 27 de agosto — lo que queda abierto

Todo lo cerrado está en los commits del día. Esto es solo lo que **no** se
cerró, con el motivo de por qué no.

Cada hallazgo se reprodujo ejerciéndolo contra producción dentro de un
`ROLLBACK`, no leyendo el código. Lo que aquí se afirma, se ejecutó.

---

## 1. Necesita tus manos — y el primero es urgente

### La `service_role` filtrada sigue viva

Ver [RUNBOOK-claves-filtradas.md](./RUNBOOK-claves-filtradas.md), que tiene los
siete pasos en orden. Resumen: la clave está en `8416eee` en el historial de
git, alcanzable desde cinco ramas, y sigue siendo válida porque el interruptor
de claves legacy está encendido.

Lo que descubrí verificándolo y cambia el procedimiento: **el vault guarda esa
misma clave** (`sha256 4c7efdff…`), y los triggers de push la usan. Apagar las
legacy sin preparar antes mata las push en silencio y tumba la web, porque el
cliente usa la clave `anon` legacy.

### No hay ningún límite de peticiones en producción

Faltan `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` en Vercel.
Comprobado: 48 peticiones seguidas a un endpoint limitado a 20/minuto pasaron
las 48. Login, escrituras, búsqueda, reportes y verificación de documento van
sin freno.

`enforce()` y `check()` ya avisan por consola y Sentry la primera vez que se
llaman sin limitador en producción, así que la ausencia dejó de ser silenciosa
— pero poner las dos variables es tuyo.

### Un ticket a soporte de Supabase

Tres superficies con permisos concedidos a `PUBLIC` que **no se pueden revocar
desde aquí**: sus dueños son `supabase_admin` y `supabase_storage_admin`. El
SQL exacto está en el runbook. La urgente es `spatial_ref_sys`, que responde
200 por la API pública y cuyo borrado tumba todo PostGIS.

### La app publicada en el App Store

- `aps-environment` está en `development` en `App.entitlements`. Una build de
  distribución con eso registra contra el APNs de pruebas: **las push no llegan
  a los usuarios del App Store**.
- `@sentry/capacitor` está excluido de iOS con la nota «re-incluir antes de
  release público» — y lleva publicado desde el 16 de junio. La app publicada
  no reporta ni un crash.
- Clasificación **4+** en un marketplace con chat, fotos y contenido de
  usuarios. Es riesgo de retirada en la próxima revisión.
- `applinks:www.vicinomarket.com` está declarado en los entitlements, pero
  `www` devuelve 308 en `/.well-known/`. Ni Apple ni Google siguen
  redirecciones para el archivo de asociación, así que los enlaces con `www`
  nunca abren la app.

---

## 2. Esperando tu visto bueno

### El `DROP` de los dos triggers de push duplicados

`sale_confirmations` y `bookings` tienen **dos** triggers de push cada una:
uno llama a `notify_push` y otro a `call_send_push_*`. Ambos disparan en el
mismo INSERT, así que la primera venta o reserva real generará la notificación
**duplicada**.

La migración `20260826090000` ya lo detectó y lo dejó explícitamente para tu
aprobación: *«Quitar el sobrante exige DROP, y eso necesita el visto bueno de
Pedro»*. No lo he deshecho por mi cuenta.

**El argumento que faltaba entonces:** `notify_push` manda
`headers: {"Content-Type": "application/json"}` y **ninguna `Authorization`**.
Los cuatro `call_send_push_*` sí mandan el bearer del vault. O sea que
`notify_push` es el camino viejo, y es la razón por la que `send-push` se
quedó sin puerta de entrada. En cuanto se despliegue el arreglo de `send-push`,
esos POST recibirán 401 igualmente.

Si lo apruebas:

```sql
DROP TRIGGER IF EXISTS on_sale_confirmation_inserted ON public.sale_confirmations;
DROP TRIGGER IF EXISTS on_booking_inserted ON public.bookings;
```

Los dos triggers se crearon a mano desde el panel — están comentados en
`20260604000003_more_push_triggers.sql`, nunca los creó una migración.

### El despliegue de `send-push`

El arreglo está en el repo y **sin desplegar a propósito**. Ver el runbook,
paso 5: desplegarlo antes de alinear el secreto haría que los triggers
recibieran 401 y las push murieran en silencio.

---

## 3. Real, pero el arreglo es arquitectónico

### Moderar contenido no retira sus fotos

Los buckets `review-media` y `product-media` son **públicos**: cualquiera con
la URL descarga el objeto sin token.

- Ocultar una reseña por moderación esconde la fila (`block_aware_reviews_select`
  hace su trabajo: anon ve 0 reseñas) pero **la foto sigue sirviéndose**.
  Comprobado: anon ve 0 filas y 1/1 de la foto.
- Una solicitud de compra cerrada oculta la fila y conserva la foto pública.

Arreglarlo de verdad significa pasar los buckets a privados y servir por URL
firmada, lo que rompe todas las URLs ya emitidas. La alternativa acotada es
borrar los objetos al moderar, que es destructivo e irreversible. Es una
decisión de producto, no un parche.

### CSP en `Report-Only` con `unsafe-inline` y `unsafe-eval`

Ninguna directiva bloquea nada, solo reporta a Sentry. Y aun promovida a
bloqueante, `script-src 'unsafe-inline' 'unsafe-eval'` deja la defensa contra
XSS nominal: una inyección ejecuta igual. Promoverla sin quitar antes esos dos
requiere auditar cada script inline de la app, y hacerlo a ciegas rompe la
página.

---

## 4. Deuda anotada, sin urgencia

- **10 funciones, 1 trigger y 3 índices viven en producción sin ninguna
  migración que los describa.** Entre ellas `manage_user_role`, que concede el
  rol de admin, y `admin_list_users`. Funcionan bien; el problema es que nunca
  pasaron por un diff ni por una revisión.
- **Un entorno reconstruido desde las migraciones queda *más* inseguro que
  producción**: `'Anyone can view appointments' USING(true)` nunca se dropea en
  el repo, y `'Authenticated upload review media'` no comprueba la carpeta. El
  repo dejó de describir producción en la dirección peligrosa.
- **`verification_consent` y `verification_document_purge_log` no las crea
  ninguna migración**, pero `20260826290000` depende de ellas. Como el cuerpo
  de una función PL/pgSQL no se valida al crearla, la migración se aplica sin
  ruido y el consentimiento biométrico (LFPDPPP) muere en un rebuild.
- **`20260320000002_profiles.sql` se editó después de aplicarse.** El ledger no
  guarda hash, así que un archivo editado tras aplicarse es invisible para
  cualquier comprobación basada en versiones. El efecto acabó siendo inocuo.
- **El tipo `Returns` del RPC del feed declara `precio: number`** y un anuncio
  de cotización despausado devuelve `NULL`. Hay 3 así, todos pausados hoy. El
  código ya es defensivo en los dos consumidores (`a.precio == null ? …` y
  `precio: number | null`), así que no rompe — pero el tipo miente, y el codegen
  de Supabase no sabe expresar nulabilidad en el retorno de una función.
- **`profiles.Row` promete 37 columnas** y un `SELECT *` revienta con `42501`
  porque los GRANT son por columna. Hoy no rompe nada: no hay un solo
  `.select('*')` sobre profiles en la app. Es la misma trampa que causó la saga
  de onboarding.
- **`tiene_consentimiento_biometrico(p_user_id)`** deja a cualquier sesión
  confirmar o negar un hecho sensible de un tercero. Hoy no hay filas que
  filtrar.
- **`get_booked_slots`** permite a un anónimo reconstruir la agenda de
  cualquier vendedor barriendo producto y fecha.
- **`increment_product_view`** no tiene freno ni idempotencia: un bucle sube
  `vistas_count` sin techo.
