# Runbook — la clave de servicio filtrada, y por qué no basta con apagar el interruptor

**Estado: ABIERTO.** Escrito el 27 de agosto de 2026 durante la auditoría de backend.
Todo lo de aquí está comprobado contra producción, no deducido.

---

## Qué pasa

La clave `service_role` del proyecto está en el historial de git, en
`8416eee:apps/web/check_grants.js` (y en `check_grants2.js`, `check_policies.js`,
`check_profiles.js` del mismo commit). Sigue siendo válida.

- **sha256:** `4c7efdff…`
- **Alcance:** salta la RLS en todas las tablas, lista y borra usuarios de Auth,
  acceso completo a Storage. Sobre producción.
- **Alcanzable desde:** `origin/master` y al menos cinco ramas más. Cada clon de
  cada colaborador, cada runner de CI y la integración de Vercel la tienen.
- **Válida hasta:** 2036.

Borrar los archivos en `9a88580` los sacó del árbol, no del historial. Lo único
que mata esta clave es **apagar las claves legacy** en Settings → API.

---

## Por qué no se puede apagar el interruptor sin más

Comprobado el 27 de agosto: `GET /v1/projects/<ref>/api-keys/legacy` devuelve
`{"enabled": true}`. Y **dos cosas vivas dependen de las claves legacy**:

| Quién | Qué clave usa | Si se apaga legacy sin preparar |
|---|---|---|
| El cliente web (`vicinomarket.com`) | anon legacy, `sha256 065202c5…`, servida en el bundle | La web deja de funcionar entera |
| Los triggers `call_send_push_*` | `vault.service_role_key`, que **es la clave filtrada** `4c7efdff…` | Las push mueren **en silencio** |

Lo del silencio no es una figura retórica: `call_send_push_*` captura con
`EXCEPTION WHEN OTHERS` y solo emite un `RAISE WARNING`. Nadie se enteraría
hasta que alguien preguntara por qué ya no llegan notificaciones.

Lo que **no** depende de legacy, comprobado una por una:

- Las 6 Edge Functions usan `SB_SECRET_KEY`, que es del formato nuevo.
- Los cron jobs usan `vault.cron_secret`, que es un secreto aparte.
- En el bundle del navegador solo viaja la clave `anon` (`role: anon`
  verificado decodificando el payload). La de servicio **no** está ahí.

---

## El orden correcto

Cada paso deja el sistema funcionando. No se apaga nada hasta el paso 6.

### 1. Clave publicable nueva para la web

En Settings → API ya existen cuatro claves `publishable`. Elige una (o crea
otra) y ponla en Vercel como `NEXT_PUBLIC_SUPABASE_ANON_KEY`.

### 2. Redesplegar la web y comprobar por contenido

```bash
node scripts/smoke-produccion.mjs
```

Las 8 comprobaciones tienen que salir en verde. **Un 200 no prueba nada** —
ese fue exactamente el P0 del 26 de agosto, con el sitio respondiendo 200 y el
feed vacío.

### 3. Cambiar el secreto que usan los triggers de push

`vault.service_role_key` guarda hoy la clave filtrada. Hay que sustituirlo por
una clave `secret` del formato nuevo:

```sql
SELECT vault.update_secret(
  (SELECT id FROM vault.secrets WHERE name = 'service_role_key'),
  '<la clave sb_secret_ nueva>'
);
```

Ejecútalo desde el SQL Editor del panel, **no** desde la terminal: tu shell es
PowerShell y PSReadLine guarda el historial de la línea de comandos.

### 4. Alinear el secreto de la Edge Function

```bash
node scripts/alinear-secreto-push.mjs           # mira y reporta
node scripts/alinear-secreto-push.mjs --escribir # iguala PUSH_WEBHOOK_SECRET al del vault
```

El valor no pasa por la línea de comandos ni se imprime: se lee del vault y se
escribe por la Management API dentro del mismo proceso. Lo único que sale por
pantalla es formato, longitud y los primeros doce caracteres del sha256.

### 5. Desplegar `send-push` con su puerta

El arreglo ya está en el repo (`supabase/functions/send-push/index.ts`), **sin
desplegar a propósito**: desplegarlo antes del paso 4 haría que los triggers
recibieran 401 y las push murieran en silencio.

```bash
npx supabase functions deploy send-push --project-ref oxxdkwywprkfghhbnoto
```

Comprobar las dos direcciones:

```bash
# Sin autorización: tiene que dar 401
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  https://oxxdkwywprkfghhbnoto.supabase.co/functions/v1/send-push \
  -H "Content-Type: application/json" -d '{}'
```

Y que una push real siga llegando: manda un mensaje de chat de prueba entre dos
cuentas y comprueba que llega al teléfono. Si no llega, mira
`net._http_response` — es la única evidencia, y se autoborra a las 6 horas.

### 6. Ahora sí: apagar las claves legacy

Settings → API → desactivar legacy. Ese es el momento en que la clave filtrada
deja de servir para nada.

### 7. Comprobar que la clave vieja está muerta

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

## Lo que queda después, y es opcional

Purgar el historial de git con `git filter-repo` y forzar que todos vuelvan a
clonar. **Es secundario**: una vez apagadas las legacy, la clave del historial
es una cadena inútil. Reescribir el historial rompe los clones de todo el
mundo, así que solo tiene sentido si además os preocupa que alguien la haya
copiado a otro sitio antes de la rotación.

---

## Los otros dos secretos que también hay que atender

- **`x-webhook-secret`** quedó expuesto en la terminal el 26 de agosto. Rotar.
- **`apps/web/tests/storage-state.json`** contuvo una cookie de sesión de la
  cuenta de pruebas. El archivo **nunca llegó a git** (comprobado: cero commits
  lo tocan, y está en `.gitignore:54`), pero la sesión conviene regenerarla.
