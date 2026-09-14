# Runbook — la clave de servicio filtrada

**Estado: ABIERTO.** Escrito el 27 de agosto de 2026 y **corregido el mismo día**
tras una segunda verificación que encontró un error grave en la primera versión.
Ver la nota al final: seguir la versión anterior habría dejado sin servicio a las
seis Edge Functions.

Todo lo de aquí está comprobado ejerciéndolo contra producción.

---

## Hecho el 28 de agosto: `send-push` ya tiene puerta

Está desplegada y verificada:

| Prueba | Resultado |
|---|---|
| POST sin autorización | **401** `{"error":"unauthorized"}` |
| POST con un bearer falso | **401** |
| POST con el secreto que mandan los triggers | pasa la puerta |

Antes, un POST anónimo ejecutaba la función entera y consultaba la base con la
`service_role`. Cualquiera con un `chat_id` real podía mandar una notificación
con el texto que quisiera a la pantalla de bloqueo de otra persona.

**Se creó `PUSH_WEBHOOK_SECRET`** en los secretos de Edge Functions. Contiene el
**mismo valor que `SB_SECRET_KEY`**, o sea la clave filtrada — no añade
exposición nueva, pero **hay que rotarlo junto con las demás** en el paso 4.

### Y una equivocación mía que costó unos minutos de push caídas

Antes de desplegar quise comprobar si el secreto del vault y el que espera la
función coincidían. Leí el vault por SQL (valor crudo, 219 caracteres) y los
secretos por la Management API (64 caracteres), concluí que eran distintos, y
"arreglé" el vault poniéndole el valor de 64.

**La API de secretos no devuelve el valor: devuelve su `sha256`.** Los 64
caracteres eran un digest. Metí un digest en el vault, los triggers empezaron a
mandar un bearer que no era ningún secreto, y la puerta recién desplegada los
rechazó con 401.

El despliegue por sí solo habría funcionado perfectamente. Lo que rompió las
push fue arreglar algo que no estaba roto.

Se restauró desde un respaldo tomado antes del cambio y se verificó en las tres
direcciones. **No se perdió ninguna notificación**: `net._http_response` no
registra ni un 401 en esa ventana, solo seis `200` del cron de recordatorios, o
sea que no se intentó ni un envío mientras estuvo rota.

Para comparar un secreto con el digest que devuelve la API, hay que hashear el
otro lado, no comparar en crudo:

```bash
sha256(valor_del_vault) == value_que_devuelve_la_api
```

---

## La clave está en TRES sitios, no en uno

La `service_role` legacy (`sha256 4c7efdff9273…`, JWT, válida hasta 2036) da
bypass total de RLS, administración de Auth y acceso completo a Storage. Vive en:

| Dónde | Quién la usa | Cómo se descubrió |
|---|---|---|
| Historial de git, `8416eee:apps/web/check_grants.js` | nadie, pero cualquiera con el repo la tiene | escaneo del historial |
| `vault.service_role_key` | los 4 triggers `call_send_push_*` | sha256 idéntico |
| `SB_SECRET_KEY` en los secretos de Edge Functions | **las 6 Edge Functions** | sha256 idéntico |
| `PUSH_WEBHOOK_SECRET` (creado el 28-ago) | `send-push` | mismo valor que `SB_SECRET_KEY` |

**Los nombres mienten.** `SB_SECRET_KEY` suena a formato nuevo `sb_secret_` y
contiene el JWT legacy. `SB_PUBLISHABLE_KEY` contiene la `anon` legacy. Solo los
nombres se migraron en julio; los valores no. Y la descripción del secreto en el
vault dice literalmente *«sb_secret para triggers pg_net → send-push (rotado
2026-07)»* — ni es `sb_secret`, ni está rotada.

Lo que Supabase inyecta por su cuenta (`SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` dentro de las Edge Functions) **sí** son las claves
nuevas. La plataforma migró lo suyo; lo que quedó atrás es lo que se puso a mano.

---

## No hay forma de matar solo la de servicio

Comprobado contra la Management API:

- `GET /api-keys/legacy` expone **un único booleano** que gobierna `anon` y
  `service_role` a la vez.
- Las rutas por clave (`DELETE /api-keys/{id}`) validan el id como UUID, y los
  ids legacy son las cadenas `anon` y `service_role`. No se pueden borrar
  individualmente.
- Revocar la clave de firma HS256 invalida **las dos** legacy a la vez, y
  Supabase exige apagarlas antes de revocarla.
- No existe lista de revocación ni forma de que la pasarela rechace un JWT
  concreto.

Así que apagar las legacy es todo o nada, y hay que preparar antes cada
consumidor.

---

## Lo que se rompe si apagas legacy hoy

| Consumidor | Clave que usa | Consecuencia |
|---|---|---|
| Cliente web + SSR (`NEXT_PUBLIC_SUPABASE_ANON_KEY`, los 3 entornos de Vercel) | anon legacy | **el sitio entero deja de funcionar** |
| Las 6 Edge Functions (`SB_SECRET_KEY`) | service_role legacy | borrado de cuenta, rankings, recordatorios, purga de documentos y push, todo caído |
| `delete-account`, además, vía `SB_PUBLISHABLE_KEY` | anon legacy | el borrado de cuenta que exigen Apple y Google |
| Los 4 triggers de push (`vault.service_role_key`) | service_role legacy | las notificaciones mueren **en silencio** |
| `SUPABASE_SERVICE_ROLE_KEY` en Vercel | **sin verificar** | desconocido — es el hueco del plan |

**Lo que NO se rompe**, comprobado uno por uno:

- Las **sesiones de usuario**: el JWKS anuncia únicamente ES256 y las claves de
  firma están `HS256=previously_used` / `ES256=in_use`. Los tokens de usuario ya
  se firman con la asimétrica. **Nadie se desloguea.**
- Las **apps nativas** de iOS y Android: son un envoltorio Capacitor que carga
  `https://vicinomarket.com` por `server.url` y no llevan ninguna clave horneada.
  Un solo despliegue web las cubre. **No hay que republicar en las tiendas.**
- Dos de los cron (`restore-spatial-ref-sys`, `expire-purchase-requests`), que
  son SQL puro.
- GitHub Actions, que solo usa el PAT `sbp_` de la Management API.
- Sentry y Resend, que tienen sus propias claves.

---

## La clave publicable es un reemplazo directo, y está probado

No es una suposición. Se comparó la `anon` legacy contra las cuatro claves
publicables del proyecto:

- **18 de 18 pruebas** con el mismo código de estado y el mismo número de filas:
  el RPC del feed, `count_nearby_vendors`, `SELECT` sobre `products_services`,
  `categories`, `/auth/v1/settings`, Storage y el WebSocket de Realtime.
- El cuerpo del RPC del feed es **byte-idéntico**: 792 bytes con las dos.
- **Mapea al rol `anon`**, probado con discriminador: en las cuatro tablas donde
  `authenticated` tiene `SELECT` y `anon` no (`notifications`, `user_roles`,
  `seller_verification`, `legal_acceptances`), ambas devuelven `42501`. Si
  mapeara a `authenticated` habría devuelto 200.
- Probado con el cliente real `@supabase/supabase-js 2.99.3` del propio repo, no
  con `curl`: feed, count, selects, `getSession`, `getUser` y Realtime
  `SUBSCRIBED`, idéntico con las dos.

Única diferencia encontrada, y es benigna: `GET /auth/v1/user` sin sesión
devuelve `403 bad_jwt` con la legacy y `401 no_authorization` con la publicable,
porque la legacy *es* un JWT y GoTrue intenta parsearla. `supabase-js` normaliza
las dos a `Auth session missing!`, y no hay código en `apps/web/lib/supabase` que
se bifurque por esos estados.

---

## El orden correcto

Cada paso deja el sistema funcionando. El interruptor es lo último.

1. **Verificar el formato de `SUPABASE_SERVICE_ROLE_KEY` en Vercel.** Es el
   único consumidor sin comprobar. Si es legacy, hay que migrarlo también.

   Este paso es solo inspección y no lleva redeploy propio. Si el valor resulta
   ser legacy, el cambio se hace junto con el paso 2 para que el redeploy del
   paso 3 recoja los dos.

2. **`NEXT_PUBLIC_SUPABASE_ANON_KEY` → una clave publicable**, en los tres
   entornos de Vercel. Una sola variable, sin cambio de código: `client.ts`,
   `server.ts` y el proxy la leen de `process.env`.

3. **Redesplegar y comprobar por contenido**, no por código de estado:

   ```bash
   node scripts/smoke-produccion.mjs
   ```

   Las 8 comprobaciones en verde, y que el bundle servido ya traiga
   `sb_publishable_` y ningún `eyJ`.

4. **`SB_SECRET_KEY` → una clave secreta nueva** (`sb_secret_…`) en los secretos
   de Edge Functions, **`SB_PUBLISHABLE_KEY` → la publicable**, y
   **`PUSH_WEBHOOK_SECRET` → la misma clave secreta nueva que `SB_SECRET_KEY`**.
   Los tres en la misma pasada. Después redesplegar las seis funciones y
   comprobar que responden.

   ⚠️ Desde que este paso redespliega hasta que termine el paso 5, los triggers
   mandan el valor viejo y `send-push` espera el nuevo: las push devuelven 401.
   Pasos 4 y 5 van seguidos. Al terminar, revisar `net._http_response` en busca
   de 401 en esa ventana.

5. **`vault.service_role_key` → la misma clave secreta nueva**, desde el SQL
   Editor del panel (no desde la terminal: tu shell es PowerShell y PSReadLine
   guarda el historial).

   ```sql
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'service_role_key'),
     '<la clave sb_secret_ nueva>'
   );
   ```

6. **`send-push` ya está desplegada con su puerta** (28-ago). Lo único que
   queda aquí es que `PUSH_WEBHOOK_SECRET` reciba la clave nueva en el paso 4,
   igual que `SB_SECRET_KEY`, y redesplegar:

   ```bash
   npx supabase functions deploy send-push --project-ref oxxdkwywprkfghhbnoto
   ```

   Después comprobar las dos direcciones: sin autorización **401**, y con el
   secreto del vault que **pase**.

7. **Comprobar que ya nada usa legacy**: manda un mensaje de prueba entre dos
   cuentas y que llegue la push; borra una cuenta de prueba; corre
   `node scripts/check-fallos-silenciosos.mjs`.

8. **Ahora sí: apagar las claves legacy.** Settings → API. Ese es el momento en
   que la clave filtrada deja de servir para nada.

9. **Comprobar que está muerta:**

   ```bash
   node -e "
   const k = require('child_process').execSync('git show 8416eee:apps/web/check_grants.js',{encoding:'utf8'}).match(/eyJ[\w-]+\.[\w-]+\.[\w-]+/)[0];
   fetch('https://oxxdkwywprkfghhbnoto.supabase.co/auth/v1/admin/users?page=1&per_page=1',
     {headers:{apikey:k, Authorization:'Bearer '+k}})
     .then(r => console.log('la clave filtrada devuelve HTTP', r.status, r.status===401?'-> MUERTA':'-> SIGUE VIVA'));
   "
   ```

   Tiene que dar **401**.

---

## Purgar el historial de git es secundario

Se puede hacer con `git filter-repo`, pero conviene saber lo que cuesta y lo que
no da:

- **No desactiva la clave.** Ya se borró del árbol en `9a88580` y sigue viva.
- Reescribe todas las referencias y obliga a `push --force`. **Rompe los clones
  de Alejandro y de Javier**, que tienen que volver a clonar.
- La clave lleva meses ahí: quien haya clonado ya la tiene en su disco.

Una vez apagadas las legacy, la cadena del historial es inútil. Purgar solo tiene
sentido si además preocupa que alguien la copiara antes de la rotación.

> **ESE MITIGANTE YA NO EXISTE.** La primera versión de este documento decía
> «el repo es privado, con 2 colaboradores y 0 forks», y eso fue lo que
> justificó esperar. Comprobado el 13 de septiembre de 2026:
>
> ```
> gh repo view Peter-code-bot/PROJECT-VICINO --json visibility,isPrivate,forkCount
> {"forkCount":0,"isPrivate":false,"visibility":"PUBLIC"}
> ```
>
> El repositorio es **PÚBLICO**. El commit `8416eee` sigue en el historial con
> la clave de servicio dentro de `apps/web/check_grants.js`, y sus claims son
> `role: service_role`, `ref: oxxdkwywprkfghhbnoto`, vigente hasta **2036**.
> Las claves legacy siguen encendidas (`GET /v1/projects/<ref>/api-keys/legacy`
> → `{"enabled":true}`), así que esa clave **funciona hoy**.
>
> Cualquiera puede clonar, extraerla y administrar Auth, Storage y toda la base
> saltándose RLS. No hay ventana de mantenimiento que justifique posponerlo.
>
> Mitigación de coste cero mientras se ejecuta la rotación, reversible en diez
> segundos:
>
> ```bash
> gh repo edit Peter-code-bot/PROJECT-VICINO --visibility private
> ```
>
> No sustituye a apagar legacy —purgar o esconder el historial **no desactiva
> la clave**, como ya dice la sección de arriba— pero reduce la superficie
> mientras tanto.

---

## Corrección de la primera versión de este documento

La versión de esta mañana decía:

> «Lo que **no** depende de legacy, comprobado una por una: las 6 Edge Functions
> usan `SB_SECRET_KEY`, que es del formato nuevo.»

**Era falso, y seguirlo habría dejado sin servicio a las seis Edge Functions.**
El error fue mío y de método: comprobé qué *nombre* de variable lee cada función
y di por hecho que el nombre describía el valor. No lo abrí. Un segundo pase que
comparó el `sha256` del valor encontró que `SB_SECRET_KEY` contiene exactamente
la clave filtrada.

Es la misma forma de error que este documento persigue: **dar por cierta la
etiqueta en vez de ejercer la cosa.** Dejo la corrección escrita en vez de
borrarla, porque el modo de fallo importa más que el dato.

---

## Los otros dos secretos que también hay que atender

- **`x-webhook-secret`** quedó expuesto en la terminal el 26 de agosto. Rotar.
- **`apps/web/tests/storage-state.json`** contuvo una cookie de sesión de la
  cuenta de pruebas. El archivo **nunca llegó a git** (cero commits lo tocan, y
  está en `.gitignore:54`), pero la sesión conviene regenerarla.


---

## 13 de septiembre: el secreto de firma también salió, y qué significa

Este runbook se escribió el 27 de agosto persiguiendo la clave de servicio. El
**12 de septiembre** salió además el `jwt_secret` del proyecto: al leer la
configuración de PostgREST por la Management API
(`GET /v1/projects/<ref>/postgrest`) la respuesta lo incluye, y se imprimió en
una transcripción. No se usó.

Hay que declararlo aparte porque con el runbook tal cual alguien puede hacer
los nueve pasos, dar el incidente por cerrado y dejar el secreto vigente:
**apagar las legacy no regenera por sí solo el secreto de firma.**

**Alcance real:** con el `jwt_secret` se pueden firmar JWT HS256 arbitrarios
—de cualquier usuario, con cualquier rol— mientras el proyecto siga aceptando
HS256.

**Y una corrección que abarata la decisión.** `docs/PENDIENTES-PEDRO-2026-09-12.md`
decía que rotar el secreto «invalida todas las sesiones activas». **Es falso**,
y comprobado el 13-sep:

```
curl -s https://oxxdkwywprkfghhbnoto.supabase.co/auth/v1/.well-known/jwks.json
→ algoritmos: ES256/EC   (solo ES256)
```

Los tokens de usuario ya se firman con la asimétrica. Rotar el HS256 **no
desloguea a nadie**. Esa frase convertía una rotación barata en una que parecía
exigir ventana nocturna — justo el tipo de error que deja un crítico abierto
otra semana. La ventana de riesgo real son los pasos 4-5, en los que las push
devuelven 401.

### Paso 10 — regenerar el secreto de firma

Después de apagar las legacy (paso 8):

*Settings → API → JWT Settings → **Generate a new JWT secret***

**Comprobación de muerte**, análoga a la del paso 9: firmar un JWT HS256 con el
secreto viejo y pedir cualquier cosa a `/rest/v1/`. Debe responder **401**. Si
responde 200, la rotación no surtió efecto.

---

## Inventario completo de consumidores (verificado el 13-sep-2026)

El runbook cubría cinco. Estos son los doce, con lo que hay que hacer en cada uno.

### AFECTADOS por la rotación — hay que actualizarlos (5)

| # | Consumidor | Cómo se actualiza |
|---|---|---|
| 1 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` en Vercel (Production, Preview, Development) | Panel de Vercel + **redeploy** (es `NEXT_PUBLIC_`: se inlinea en el build) |
| 2 | `SUPABASE_SERVICE_ROLE_KEY` en Vercel | Panel. **Antes**, inspeccionar su formato (paso 1 del runbook): sigue siendo *el hueco declarado del plan* |
| 3 | Secretos de Edge Functions: `SB_SECRET_KEY` (7 lecturas), `SB_PUBLISHABLE_KEY` (1), `PUSH_WEBHOOK_SECRET` (1) | Panel de Supabase + `supabase functions deploy` de las 6 |
| 4 | `vault.service_role_key` | SQL Editor. Lo leen los 4 triggers de push (`20260826090000`, `20260604000005`) |
| 5 | `apps/web/.env.local` | Edición manual en la máquina de Pedro |

> El #2 es el que puede morder: `lib/supabase/admin.ts` lo lee y tiene **dos
> importadores vivos** — `app/actions/verify-document.ts` y
> `app/admin/verifications/page.tsx`. Si ese valor es una clave legacy, apagar
> legacy tumba la verificación de documentos y el panel de admin, y el runbook
> no lo preveía.

### NO AFECTADOS — comprobados uno por uno (7)

| # | Qué | Por qué no |
|---|---|---|
| 6 | `.env` de la raíz | Es el PAT `sbp_` de la Management API: otra credencial |
| 7 | Secreto `SUPABASE_ACCESS_TOKEN` de GitHub Actions | Ídem |
| 8 | Variables de usuario de Windows `VICINO_SUPABASE_PAT`, `VICINO_SENTRY_TOKEN` | Ídem; `.mcp.json` las referencia por nombre |
| 9 | `apps/web/android` | Cero claves horneadas |
| 10 | `apps/web/ios` | Cero claves horneadas |
| 11 | `vault.cron_secret` | Secreto propio, no derivado del JWT |
| 12 | `vault.webhook_secret` | Secreto propio, no derivado del JWT |

**Consecuencia práctica para las tiendas:** `capacitor.config.ts` carga
`url: 'https://vicinomarket.com'`, o sea que la app móvil consume el bundle
remoto. Un despliegue web cubre también a los usuarios de Android e iOS: **no
hay que republicar el AAB ni pasar por revisión** para completar la rotación.
