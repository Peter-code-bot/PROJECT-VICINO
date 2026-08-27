# Runbook — la clave de servicio filtrada

**Estado: ABIERTO.** Escrito el 27 de agosto de 2026 y **corregido el mismo día**
tras una segunda verificación que encontró un error grave en la primera versión.
Ver la nota al final: seguir la versión anterior habría dejado sin servicio a las
seis Edge Functions.

Todo lo de aquí está comprobado ejerciéndolo contra producción.

---

## La clave está en TRES sitios, no en uno

La `service_role` legacy (`sha256 4c7efdff9273…`, JWT, válida hasta 2036) da
bypass total de RLS, administración de Auth y acceso completo a Storage. Vive en:

| Dónde | Quién la usa | Cómo se descubrió |
|---|---|---|
| Historial de git, `8416eee:apps/web/check_grants.js` | nadie, pero cualquiera con el repo la tiene | escaneo del historial |
| `vault.service_role_key` | los 4 triggers `call_send_push_*` | sha256 idéntico |
| `SB_SECRET_KEY` en los secretos de Edge Functions | **las 6 Edge Functions** | sha256 idéntico |

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
   de Edge Functions, y **`SB_PUBLISHABLE_KEY` → la publicable**. Después
   redesplegar las seis funciones y comprobar que responden.

5. **`vault.service_role_key` → la misma clave secreta nueva**, desde el SQL
   Editor del panel (no desde la terminal: tu shell es PowerShell y PSReadLine
   guarda el historial).

   ```sql
   SELECT vault.update_secret(
     (SELECT id FROM vault.secrets WHERE name = 'service_role_key'),
     '<la clave sb_secret_ nueva>'
   );
   ```

6. **Alinear el secreto de `send-push` y desplegarlo:**

   ```bash
   node scripts/alinear-secreto-push.mjs --escribir
   npx supabase functions deploy send-push --project-ref oxxdkwywprkfghhbnoto
   ```

   Y comprobar que sin autorización devuelve **401** — hoy devuelve 500 «Chat
   not found», lo que significa que ejecuta el cuerpo entero sin credencial.

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

Mitigante de contexto: el repo es **privado**, con 2 colaboradores y 0 forks.

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
