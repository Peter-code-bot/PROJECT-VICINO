# Bandeja de WhatsApp (fase 2 de INT-CRM-20261104)

> Estado al 8-nov-2026: rama `feat/bandeja-whatsapp-20261108` sobre `master` `4c8e56b`.
> Codigo completo con pruebas y una revision adversarial corregida (53 hallazgos
> sostenidos, ver abajo); **nada aplicado en produccion** (migracion pendiente de Pedro) y
> **sin app en Meta todavia** (la crea Pedro con la cuenta de administracion de VICINO; ver
> la lista de clics). La pantalla esta detras de una bandera de build y apagada.

## Que es (y que no es) en el piloto

Un negocio conecta su numero de WhatsApp Business (Cloud API de Meta) a VICINO. Lo que
sus clientes le escriben a ese numero aparece en `/seller/bandeja`, con contador de
no leidos, y el negocio responde desde ahi. La respuesta sale por la API de Meta como si
la mandara desde su WhatsApp. Los estados (enviado, entregado, leido) vuelven solos.

Lo que el piloto **no** hace, a proposito:

- No conecta Instagram, Messenger ni resenas de Google. Cada uno exige su propia
  aprobacion de Meta/Google y se evaluara con lo que el piloto ensene.
- No envia plantillas: fuera de la **ventana de 24 horas** de WhatsApp (desde el ultimo
  mensaje del cliente) no se puede responder. La pantalla lo dice antes de escribir.
- No descarga adjuntos: una foto o un audio aparece como `[Imagen]` o `[Audio]` (y su
  pie de foto, si trae). El negocio los ve en su telefono, como siempre.
- No registra ediciones ni borrados de mensajes del cliente (se queda el original).
- Un numero por negocio, y en el piloto lo conecta el equipo de VICINO desde
  `/admin/whatsapp`. El numero es el **de prueba que regala Meta**: solo escribe a
  hasta 5 numeros autorizados y no cobra. Para numeros reales hace falta la fase
  siguiente (Embedded Signup), ver al final. Mientras la bandera este encendida, los
  demas vendedores ven la pantalla con un aviso honesto de que es un piloto con un solo
  numero.

## Como funciona

```
Cliente escribe al numero del negocio
  └─ Meta → POST https://vicinomarket.com/api/webhooks/whatsapp
       (cuerpo JSON + cabecera X-Hub-Signature-256 = sha256=HMAC(cuerpo, App Secret))
       └─ route.ts: freno por IP (resumida), WHATSAPP_APP_SECRET obligatorio, tope 3 MB,
          FIRMA verificada aqui (lo forjado muere en Vercel), forma minima del JSON
            └─ rpc ingerir_webhook_whatsapp(firma, cuerpo CRUDO)   [llave anon, sin sesion]
                 1. recalcula el HMAC con el App Secret del Vault ('whatsapp_app_secret');
                    si no coincide → P0401 (la ruta lo reporta: los dos secretos divergen)
                 2. huella sha256 del cuerpo → eventos_webhook_whatsapp (idempotente)
                 3. por cada messages[]: busca el canal por phone_number_id (pausado o no),
                    upsert conversaciones_whatsapp (canal, wa_id), insert mensajes_whatsapp
                    (unico por wamid), no_leidos+1, ultimo_entrante_at = ventana de 24 h
                 4. por cada statuses[]: avanza el estado del mensaje saliente (nunca
                    retrocede); si el mensaje aun no tiene wamid, lo guarda como huerfano
                 5. si el aviso no dejo nada (numero sin conectar, ruido) recorta el evento
            └─ 200 {ok, nuevos, estados, estados_sin_mensaje, sin_canal, ignorados, duplicado}

Negocio abre /seller/bandeja
  └─ SELECT conversaciones_whatsapp (RLS: negocio_id = auth.uid()) + realtime → router.refresh()
  └─ /seller/bandeja/[id]: los ULTIMOS 300 mensajes + <HiloWhatsApp>
       ├─ marcarLeidaWhatsApp → rpc marcar_leida_conversacion_whatsapp (+ palomitas azules via Graph)
       └─ responderWhatsApp(texto)
            1. rpc preparar_envio_whatsapp: dueno, canal activo, ventana de 24 h, 1-4096
               caracteres, ritmo por negocio → mensaje 'pendiente'
            2. Graph API: POST /{version}/{phone_number_id}/messages (token del servidor)
            3. rpc cerrar_envio_whatsapp: 'enviado' + wamid (y aplica el estado huerfano si
               Meta se adelanto), o 'fallido' + codigo de Meta. Si NO se pudo confirmar
               (sin red, tiempo agotado, 2xx sin id) se queda 'pendiente' y se avisa: no
               se invita a reenviar algo que quiza ya llego.
```

## Donde esta cada cosa

| Pieza | Archivo |
| --- | --- |
| Migracion (5 tablas, RLS, 7 RPC, realtime, 4 purgas) | `supabase/migrations/20261108180000_bandeja_whatsapp.sql` |
| Arnes que la ejecuta en un Postgres embebido (120 comprobaciones) | `scripts/sql/arnes-bandeja-whatsapp/` |
| Webhook (GET verificacion, POST avisos) | `apps/web/app/api/webhooks/whatsapp/route.ts` |
| Cliente de Graph (enviar texto, marcar leido; `server-only`) | `apps/web/lib/whatsapp/graph.ts` |
| Frases para la persona, etiquetas y constantes compartidas | `apps/web/lib/whatsapp/presentacion.ts` |
| Firma HMAC y comparacion en tiempo constante | `apps/web/lib/whatsapp/firma.ts` |
| Ventana de 24 h (calculo y etiquetas) | `apps/web/lib/whatsapp/ventana.ts` |
| Configuracion del servidor (token, version, verify token, app secret) | `apps/web/lib/whatsapp/config.ts` |
| Forma minima del webhook y del resumen (zod) | `apps/web/lib/whatsapp/webhook-schema.ts` |
| Bandera de build | `apps/web/lib/whatsapp/bandera.ts` (`NEXT_PUBLIC_VICINO_BANDEJA_WHATSAPP=1`) |
| Cliente Supabase sin sesion (llave anon) | `apps/web/lib/supabase/sin-sesion.ts` |
| Cubeta de freno por IP sin IP (HMAC con `VICINO_SAL_CUBETAS`) | `apps/web/lib/cubeta-ip.ts`; limitadores en `lib/rate-limit.ts` |
| Bandeja del vendedor | `apps/web/app/seller/bandeja/{page.tsx,[id]/page.tsx,hilo-whatsapp.tsx,refresco-bandeja.tsx,actions.ts}` |
| Admin: conectar, pausar/reactivar, desconectar | `apps/web/app/admin/whatsapp/{page.tsx,actions.ts,conectar-form.tsx}` |
| Menus | `components/layout/seller-sidebar.tsx`, `components/layout/admin-sidebar.tsx` |
| Tipos | `apps/web/types/database.types.ts` (editados a mano; regenerar tras aplicar la migracion) |
| Simular un aviso firmado contra la ruta | `scripts/whatsapp-simular-webhook.mjs` |
| Pruebas (61 casos nuevos) | `lib/whatsapp/*.test.ts`, `lib/cubeta-ip.test.ts`, `app/api/webhooks/whatsapp/route.test.ts`, `app/seller/bandeja/actions.test.ts`, `app/admin/whatsapp/actions.test.ts` |
| CI | job `unitarias` en `.github/workflows/security.yml` (`pnpm test` en apps/web) |

## Modelo de confianza y privacidad

- **La firma se verifica dos veces, a proposito.** Primero en la ruta, con
  `WHATSAPP_APP_SECRET` (obligatorio en Vercel): lo forjado muere ahi sin gastar un HMAC
  de hasta 3 MB ni una lectura del Vault. Despues en el RPC `ingerir_webhook_whatsapp`,
  con el App Secret del **Vault de Supabase** (`whatsapp_app_secret`): es la que manda,
  porque el RPC es ejecutable con la llave anon (publica) y cualquiera podria llamarlo sin
  pasar por la ruta. Si pasa la primera y falla la segunda (P0401), los dos secretos
  divergen: la ruta responde 401 y lo reporta a Sentry en el acto, porque si no Meta
  reintentaria 7 dias y luego descartaria los mensajes sin que nadie lo viera. Asi
  **Vercel no necesita la service_role key**.
- **Idempotencia**: huella sha256 del cuerpo (Meta reintenta hasta 7 dias lo que no ve con
  200) y unicidad por `wamid`. Un reintento responde 200 `duplicado: true` sin escribir.
- **Estados que se adelantan**: Meta puede mandar `sent`/`delivered` antes de que el
  servidor termine de registrar el envio; esos estados se guardan en
  `estados_huerfanos_whatsapp` y `cerrar_envio_whatsapp` los aplica al cerrar.
- **Quien ve que**: conversaciones y mensajes, **solo el negocio dueno** (RLS por
  `negocio_id`, atado al canal con FK compuestas para que no pueda divergir). El admin ve
  que numero esta conectado a que negocio, no los mensajes. `eventos_webhook_whatsapp` y
  `estados_huerfanos_whatsapp` no los lee ningun rol de cliente.
- **Lo que se guarda del cliente**: su numero (`wa_id`), el nombre de perfil que tiene en
  WhatsApp, el texto del mensaje (o el pie de una foto/video, el nombre de archivo de un
  documento, el nombre/direccion de una ubicacion compartida), el tipo, el momento y los
  estados. Del negocio: que usuario de VICINO respondio cada mensaje y quien conecto el
  numero. **No** se descargan adjuntos. El evento crudo de Meta se conserva 7 dias para
  depurar **solo si dejo algo en la bandeja**; el que no (numero sin conectar, ruido) se
  recorta a su resumen y a los `phone_number_id` que traia. Ese evento crudo incluye los
  campos `conversation`/`pricing` que Meta adjunta a los estados; no se usan para nada y se
  van con la purga.
- **Retencion**: eventos y estados huerfanos 7 dias; mensajes 180 dias; conversaciones 180
  dias sin actividad y ya sin mensajes (asi el numero, el nombre y el extracto del ultimo
  mensaje del cliente no quedan para siempre). Jobs de pg_cron
  `purgar-eventos-webhook-whatsapp` 04:41 UTC, `purgar-estados-huerfanos-whatsapp` 04:43,
  `purgar-mensajes-whatsapp` 04:47 y `purgar-conversaciones-whatsapp` 04:53. Se cambian en
  una migracion, sin tocar codigo.
- **Pausar** (solo el equipo, desde `/admin/whatsapp`): el negocio no puede responder y la
  bandeja se lo dice; lo que le escriban **se sigue guardando** (una pausa no puede costar
  mensajes: Meta no los volveria a mandar). **Desconectar** (solo el equipo) borra el
  numero con sus conversaciones y mensajes; es lo unico que permite volver a conectar ese
  numero a otro negocio. Reasignar a mano no hace falta y, si alguien lo hiciera por SQL,
  las FK compuestas arrastran conversaciones y mensajes al nuevo negocio.
- **Frenos**: webhook 600/min por IP resumida (un HMAC con `VICINO_SAL_CUBETAS`; sin la
  sal, sha256 pelado); respuestas 30/min por usuario y 30/min por negocio en el RPC; Meta
  limita ademas a un mensaje cada ~6 s por cliente (error 131056, se traduce). El RPC del
  webhook lleva `statement_timeout = 8s`.
- **El token de Meta** vive solo en Vercel (`WHATSAPP_ACCESS_TOKEN`), lo lee
  `lib/whatsapp/config.ts` (`server-only`) y nunca llega al navegador ni a la base. Solo
  necesita `whatsapp_business_messaging` (enviar y marcar leido); no se le pide
  `whatsapp_business_management` hasta que haga falta (Embedded Signup).
- **Lo que llega al navegador de un envio fallido** es solo el codigo (`error_codigo`),
  traducido por `mensajeParaUsuario`; el detalle crudo de Meta (ingles, `fbtrace`) se
  queda en la base y en Sentry.
- **Caso no atendido**: Meta puede omitir el numero del cliente (`from`) cuando este se
  identifica solo por nombre de usuario (identificador BSUID). El piloto lo cuenta como
  `ignorados` y no guarda el mensaje. Se revisa si aparece en la practica.

## Lista de clics de Pedro (todo esto es humano: cuentas, terminos, documentos, tarjeta)

Orden recomendado. Nada de esto pasa por el chat: tokens y secretos se copian directo de
Meta a Vercel/Supabase. Fuentes: developers.facebook.com/documentation/business-messaging/
whatsapp (Get started, Webhooks, Access tokens), consultadas el 8-nov-2026.

**A. Cuenta y app en Meta for Developers (una vez)**

1. Con la cuenta de Facebook de administracion de VICINO, registrarse como desarrollador
   en developers.facebook.com (acepta Platform Terms y Developer Policies; codigo al
   telefono y al correo). Hace falta un **business portfolio** de VICINO en Meta Business
   Suite; si no existe, lo pide ahi mismo.
2. developers.facebook.com/apps → **Create app** → nombre (p. ej. "VICINO Marketplace"),
   correo de contacto, caso de uso **"Connect with customers through WhatsApp"**, elegir el
   business portfolio de VICINO → Create app.
3. En la app: **WhatsApp → API Setup**. Meta crea solos una cuenta de prueba y un **numero
   de prueba** (+1 555 ...). Anotar (se pegan despues en `/admin/whatsapp`):
   - **Phone number ID** (del numero de prueba, campo "From").
   - **WhatsApp Business Account ID** (tambien llamado Messaging account ID).
4. En API Setup, campo **To → Manage phone number list → Add phone number**: agregar tu
   celular. WhatsApp te manda un codigo; se confirma ahi. Son **hasta 5 numeros**; solo esos
   pueden recibir del numero de prueba.
5. **App settings → Basic → App Secret → Show**: es el secreto con el que Meta firma los
   webhooks. Se copia a **dos** sitios: el Vault (paso 10) y Vercel (paso 14), con el
   MISMO valor. Si alguna vez se filtra, en esa misma pantalla se reinicia y se actualiza en
   los dos (si solo se cambia uno, la ruta responde 401 y Sentry avisa).

**B. Token permanente (System User), para que VICINO pueda RESPONDER**

El token de "Generate access token" de API Setup caduca en horas; no sirve para el piloto.

6. business.facebook.com/latest/settings → **Users → System users → Add**: nombre
   `vicino-bandeja`, rol **Employee** (no hace falta Admin).
7. En ese system user → **Assign assets**: la **app** (control total / Manage app) y la
   **cuenta de WhatsApp** de prueba (control total).
8. **Generate token** → elegir la app → caducidad **Never** (si Meta lo ofrece; si no, la
   mas larga, y anotar la fecha) → permiso **`whatsapp_business_messaging`** (es el unico que
   usa el piloto; `whatsapp_business_management` se agregara cuando llegue Embedded Signup)
   → Generate. Copiarlo directo a Vercel (paso 13). Meta no lo vuelve a mostrar.

**C. Supabase (desde el clon principal, que tiene el `.env`)**

9. Aplicar la migracion y regenerar tipos:

   ```bash
   node scripts/apply-migration.mjs supabase/migrations/20261108180000_bandeja_whatsapp.sql --dry-run
   ```

   ```bash
   node scripts/apply-migration.mjs supabase/migrations/20261108180000_bandeja_whatsapp.sql
   ```

   ```bash
   node scripts/gen-types.mjs
   ```

10. Crear el secreto en el **Vault**: Supabase Dashboard → **SQL Editor** (no en el chat,
    no en un archivo del repo) y ejecutar, pegando el App Secret del paso 5:

    ```sql
    select vault.create_secret('<APP SECRET DE META>', 'whatsapp_app_secret', 'App Secret de Meta para verificar los webhooks de WhatsApp');
    ```

    Comprobar con `select name, created_at from vault.secrets where name = 'whatsapp_app_secret';`
    (debe haber UNA fila; si hay varias, el RPC usa la mas reciente).

**D. Vercel (Production y Preview) → Settings → Environment Variables**

11. `NEXT_PUBLIC_VICINO_BANDEJA_WHATSAPP` = `1` (enciende la pantalla y las entradas del menu).
12. `WHATSAPP_VERIFY_TOKEN` = una cadena larga de **solo letras y digitos** que tu inventes
    (un `+` o `/` se perderia en la URL). En PowerShell:
    `-join ((1..32) | % { '{0:x2}' -f (Get-Random -Maximum 256) })` da 64 caracteres hex.
    La misma se pega en Meta en el paso E.
13. `WHATSAPP_ACCESS_TOKEN` = el token del paso 8.
14. `WHATSAPP_APP_SECRET` = el App Secret del paso 5 (mismo valor que el Vault). **Es
    obligatorio**: sin el, el webhook responde 503.
15. Recomendado: `VICINO_SAL_CUBETAS` = otra cadena larga al azar (para que las cubetas de
    los frenos por IP no sean reversibles). Opcional: `WHATSAPP_GRAPH_VERSION` (vacio = v27.0).
16. **Redeploy** (las variables se hornean en el build). Comprobar
    `https://vicinomarket.com/api/webhooks/whatsapp` → debe responder 403 "Forbidden"
    (sin parametros de Meta); si responde 503, falta `WHATSAPP_VERIFY_TOKEN`.

**E. Webhook en Meta**

17. En la app: **WhatsApp → Configuration → Webhook → Edit**: Callback URL
    `https://vicinomarket.com/api/webhooks/whatsapp`, Verify token = el del paso 12 →
    **Verify and save**. Si Meta dice que no pudo verificar, revisar el paso 16.
18. En **Webhook fields**, suscribir **`messages`** (es el que trae mensajes entrantes y
    estados). El boton **Test** manda un aviso con un numero ficticio: en VICINO cuenta
    como `sin_canal` y responde 200. Es lo esperado.
19. Comprobar que la app esta suscrita a la cuenta de WhatsApp (el boton Test no lo prueba):
    en el Graph API Explorer o con `curl`,
    `GET https://graph.facebook.com/v27.0/<WABA_ID>/subscribed_apps` con el token del paso
    8 debe listar tu app. Si no la lista,
    `POST https://graph.facebook.com/v27.0/<WABA_ID>/subscribed_apps` con el mismo token
    (respuesta `{"success": true}`). Sin esto, los pasos 17-18 salen bien y el 21 no llega
    nunca.

**F. Conectar el numero en VICINO**

20. Entrar a `https://vicinomarket.com/admin/whatsapp` con la cuenta admin → formulario:
    usuario de VICINO del negocio de prueba (tu cuenta vendedora, con o sin @, da igual la
    caja), Phone number ID y WhatsApp Business Account ID del paso 3, numero mostrado
    `+1 555 ...` → Conectar.

**G. Probar de verdad**

21. Desde el celular autorizado del paso 4, escribir al numero de prueba. En segundos
    aparece en `/seller/bandeja` (si la pestana estaba abierta, sola; si no, al entrar). Si
    en un minuto no llega nada, revisar el paso 19 antes que el codigo.
22. Abrir la conversacion, responder. Debe llegar al celular; en la bandeja la palomita
    pasa de una a dos y a azul cuando lo lees en el telefono (si el cliente esta en linea
    WhatsApp puede mandar `read` directo y la segunda palomita se ve ya azul).
23. Esperar mas de 24 h sin escribir desde el celular e intentar responder: la pantalla lo
    impide y, si se fuerza, el RPC lo rechaza (55000). Escribir desde el celular reabre.

Si algo no cuadra: `scripts/whatsapp-simular-webhook.mjs` (abajo) manda un aviso firmado sin
pasar por Meta y aisla si el problema esta en Meta o en VICINO.

## Como probar sin Meta

Con el App Secret en el entorno de la terminal (no en el repo):

```bash
node scripts/whatsapp-simular-webhook.mjs --url https://vicinomarket.com/api/webhooks/whatsapp
```

Esperado: `HTTP 200 {"ok":true,"duplicado":false,"nuevos":0,"estados":0,"estados_sin_mensaje":0,"sin_canal":1,"ignorados":0}`.
Con `--phone-number-id <el conectado>` el mensaje aparece en la bandeja de ese negocio
(es un mensaje de prueba real para el). Con `--estado <wamid>:delivered` se simula un
estado de un mensaje enviado.

Respuestas y su causa: 401 firma invalida (el secreto del entorno no es el de Vercel; o, si
Sentry recibio "secretos distintos", Vercel y el Vault no coinciden), 503 falta
`WHATSAPP_APP_SECRET` o el secreto en el Vault (o `WHATSAPP_VERIFY_TOKEN` en el GET), 400
cuerpo invalido (va a Sentry: la ruta ya lo habia validado), 429 freno, 500 fallo de la
base (va a Sentry y Meta reintenta).

### Como se verifico el SQL antes de produccion

`scripts/db-probe.mjs` no acepta PL/pgSQL (rechaza la palabra END) y el `--dry-run` de
`apply-migration.mjs` solo imprime. Por eso existe `scripts/sql/arnes-bandeja-whatsapp/`:
ejecuta la migracion completa en un **PostgreSQL 18 embebido** (paquete
`embedded-postgres`, con pgcrypto) imitando lo minimo de Supabase (roles
anon/authenticated, `auth.uid()`, `vault.decrypted_secrets`, `has_role`, `profiles`,
`user_roles`, publicacion realtime) y ejercita los RPC bajo roles reales. Hoy son 120
comprobaciones en verde: privilegios y RLS, firma valida/invalida/mal formada (P0401),
cuerpo no JSON y con U+0000, duplicados por cuerpo y por wamid, contactos que no son array,
timestamps del futuro, avisos fuera de orden, numero no conectado (evento recortado),
aislamiento entre dos negocios y el admin, preparar/cerrar envio, estados que no retroceden
y estados huerfanos (carrera con cerrar_envio), ventana de 24 h, ritmo, marcar leida,
pausa (solo admin; sigue recibiendo), desconectar un canal (cascada), FK compuestas y las
cuatro purgas.

```bash
cd scripts/sql/arnes-bandeja-whatsapp && npm install && npm run probar
```

El bloque VERIFY de la migracion reproduce lo esencial contra produccion.

## Decisiones tomadas en esta rama (se pueden revertir)

- **D1** La firma de Meta se verifica en Postgres con el secreto del Vault; la ruta usa la
  llave anon. Alternativa descartada: service_role en Vercel (regla del repo) o un
  segundo secreto compartido ruta→RPC. Tras la revision, la misma firma se verifica ANTES
  en la ruta con `WHATSAPP_APP_SECRET` (obligatorio): el Vault sigue siendo el que manda,
  Vercel solo evita que lo forjado llegue a la base; si discrepan, 401 + Sentry.
- **D2** El token de Meta es uno, del servidor, en Vercel, y solo con
  `whatsapp_business_messaging`. Cuando haya numeros de varios negocios (Embedded Signup)
  cada uno tendra su token por cliente, que ira al Vault y lo leera un RPC solo para el dueno.
- **D3** La ventana de 24 h se calcula con `ultimo_entrante_at` propio, no con
  `expiration_timestamp` de Meta (que desde Graph v24.0 ya no viene salvo en entradas
  gratuitas). Un timestamp del futuro se acota a ahora + 5 minutos.
- **D4** Un numero por negocio y conexion por admin. Reasignar un numero a otro negocio
  esta bloqueado en el RPC; el admin desconecta (borra en cascada) y vuelve a conectar. Las
  FK compuestas (canal, negocio) y (conversacion, negocio) impiden que la RLS diverja.
- **D5** Los estados solo avanzan (pendiente < enviado < entregado < leido; fallido
  siempre). Si llega `read` sin `delivered`, se acepta el salto, como documenta Meta. Un
  estado que llega antes de que el envio tenga wamid se guarda huerfano y se aplica al cerrar.
- **D6** Texto hasta 4096 caracteres (limite de WhatsApp); se manda `to` con `+`, como
  recomienda Meta para que no anteponga la lada del negocio.
- **D7** Lo que no es texto se registra por tipo con su pie; `edit` y `revoke` se ignoran;
  `from` ausente (usuario por nombre) se ignora.
- **D8** Retencion 7 dias (eventos y estados huerfanos), 180 dias (mensajes) y 180 dias sin
  actividad y sin mensajes (conversaciones). El evento que no dejo nada se recorta en el acto.
- **D9** Version de Graph por defecto v27.0 (4-nov-2026), explicita en cada llamada y
  configurable por entorno.
- **D10** Pausar = no responder; sigue recibiendo. Solo el equipo pausa, reactiva y
  desconecta (un control que el propio negocio pudiera deshacer no seria un control). El
  boton de pausa para el negocio es una decision aparte (T-53).
- **D11** Un envio que no se pudo confirmar (sin red, tiempo agotado, 2xx sin id) se queda
  'pendiente' y la pantalla pide esperar; nunca se marca 'fallido' ni se invita a reenviar.
- **D12** Al navegador solo viaja el codigo de un envio fallido, traducido por
  `mensajeParaUsuario`; el detalle crudo de Meta se queda en la base y en Sentry.
- **D13** Un fallo de firma es `P0401` (codigo propio) y no `42501`, para que un fallo de
  privilegios de verdad (perder el Vault) se vea como 500 en Sentry y no como "firmas malas".
- **D14** Las pruebas unitarias corren en CI (job `unitarias`); antes solo se corrian a mano.

## Revision adversarial (8-nov-2026)

Cinco revisores (seguridad, SQL, TypeScript/Next, privacidad y contrato, cobertura) y tres
jueces independientes por hallazgo (refutar, reproducir, impacto): **53 hallazgos
sostenidos, 1 refutado; 0 criticos**. Los de mas peso, ya corregidos en esta rama: el hilo
cargaba los 300 mensajes MAS VIEJOS; la hora de cada mensaje producia un error de
hidratacion; la burbuja de un envio fallido mostraba el detalle crudo de Meta; la retencion
no cubria `conversaciones_whatsapp`; un fallo del Vault se veia como "firmas malas" sin
Sentry; el usuario del negocio se buscaba distinguiendo mayusculas; un estado de Meta que
llegaba antes de cerrar el envio se perdia; un tiempo de espera cerraba como 'fallido' un
mensaje que quiza salio; la pausa descartaba mensajes sin posibilidad de recuperarlos; el
propio negocio podia deshacer una pausa del admin; sin `WHATSAPP_APP_SECRET` en Vercel
cualquier POST forjado costaba un HMAC y una lectura del Vault; `negocio_id` podia divergir
entre canal y conversaciones; el evento crudo guardaba 7 dias mensajes de numeros sin
conectar; el arnes SQL vivia fuera del repo y las pruebas no corrian en CI. El resto fueron
robustez, textos y documentacion, tambien corregidos.

## Pendientes y fase siguiente

Del piloto (Pedro / Alejandro):

- Pasos A-G de arriba; despues, revision visual de la bandeja (Alejandro) y probar en el
  Android con la app instalada (es WebView: deberia verse igual que en la web).
- Decidir si el negocio puede pausar su propio numero desde la bandeja (hoy solo el
  equipo; exigiria distinguir quien pauso).
- Metodo de pago en la cuenta de WhatsApp Business: no hace falta con el numero de
  prueba, si con numeros reales (Meta lo exige desde el 30-sep-2026; hay 1,000 mensajes
  de servicio gratis al mes por numero).
- Un "latido": avisar si hay canales activos y el webhook no recibe nada en 24 h
  (pg_cron o un check de Sentry). Hoy, si Meta deja de mandar, nadie se entera hasta que
  un negocio lo nota.
- Paginar hacia atras en el hilo (hoy se muestran los ultimos 300 y se dice).

Siguiente fase, cuando el piloto lo justifique (todo investigado el 8-nov-2026):

- **Numeros reales de cada negocio con Embedded Signup**: VICINO como Tech Provider →
  Business Verification de VICINO + App Review con acceso avanzado a
  `whatsapp_business_messaging` y `whatsapp_business_management` (video + descripcion
  por permiso, ~24 h) + Facebook Login for Business (configuracion v5). El negocio hace
  clic, Meta devuelve `code` → se canjea por un token por cliente (BISU, sin caducidad) →
  `POST /<WABA_ID>/subscribed_apps` → registrar el numero con PIN. Limite inicial: 10
  negocios nuevos por 7 dias (200 con verificacion). Hay sandbox de 30 dias para probar.
- Plantillas aprobadas para responder fuera de las 24 h (tienen costo por mensaje).
- Adjuntos: descargar con el token desde Graph a un bucket privado.
- Instagram (Messaging API: acceso avanzado + App Review) y Messenger; resenas de Google
  (Business Profile API: formulario de acceso, perfil verificado).
