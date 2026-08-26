# Cron en VICINO — runbook

Trabajos programados con `pg_cron` dentro del proyecto Supabase `oxxdkwywprkfghhbnoto`.
Sin valores ni tokens: este archivo describe dónde viven, no cuáles son.

---

## ⚠️ Antes de tocar nada: el riesgo del nombre

**No apliques `supabase/migrations/20260531000001_pg_cron_schedules.sql` contra producción sin cambiarle el nombre del job primero.**

El archivo declara el job como `send-appointment-reminders-30min` — [`20260531000001_pg_cron_schedules.sql:79`](./migrations/20260531000001_pg_cron_schedules.sql), y también en las líneas 73 y 98.

En producción el job se llama **`send-appointment-reminders`**, sin sufijo.

Los nombres de job son la clave de `cron.unschedule`. El archivo abre con un `PERFORM cron.unschedule('send-appointment-reminders-30min')` (línea 73) que **no encontraría** el job real, se tragaría el error en su bloque `EXCEPTION`, y acto seguido crearía un **segundo** job con el nombre `-30min`. Resultado: los recordatorios de cita se enviarían **dos veces cada 30 minutos**.

Esto significa que el job de producción **no lo creó este archivo**. No sabemos cuál fue el origen. Antes de reconciliar repo y base hay que decidir cuál de los dos nombres es el bueno y alinear el archivo, no la base.

---

## Los trabajos

| Job | Horario | Qué hace | Migración |
|---|---|---|---|
| `expire-confirmations-6h` | `0 */6 * * *` — cada 6 h | `POST` a la edge function `expire-confirmations` | [`20260531000001:46-61`](./migrations/20260531000001_pg_cron_schedules.sql) |
| `send-appointment-reminders` | `*/30 * * * *` — cada 30 min | `POST` a la edge function `send-appointment-reminders` | **ninguna** — el archivo declara otro nombre (ver arriba) |
| `expire-purchase-requests` | `*/15 * * * *` — cada 15 min | `UPDATE purchase_requests SET status='expired'` | [`20260710000001:306-315`](./migrations/20260710000001_purchase_requests.sql) |
| `purge-verification-documents-hourly` | por confirmar | purga de documentos de verificación | **ninguna** en el repo |

Notas:

- La ventana del recordatorio de 1 h dentro de la función es de 45–75 min antes de la cita, por eso el cron debe dispararse **al menos** cada 30 min o se pierde la ventana. La de 1 día es más ancha (23–25 h) y la granularidad de 30 min la cubre de sobra.
- **`expire-purchase-requests` no hace HTTP.** Es un `UPDATE` directo, no usa el secreto y **nunca aparece en `net._http_response`**. Si lo buscas ahí y no está, no es un fallo.
- `purge-verification-documents-hourly` pertenece al flujo de verificación de identidad. No lo toques sin hablar con Alejandro.

---

## El secreto

Los dos jobs que llaman edge functions mandan `Authorization: Bearer <CRON_SECRET>`.

**Dónde vive, según el repo** ([`20260531000001:86-88`](./migrations/20260531000001_pg_cron_schedules.sql)): el `command` del job no lleva el valor, lleva una subconsulta que lo resuelve **en cada disparo**:

```
'Authorization', 'Bearer ' || (
  SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret'
)
```

Es lookup **por nombre**, no por id.

### Los dos lados que deben coincidir

```
Supabase Vault  (nombre 'cron_secret')  ──emite──▶  Bearer del request
                                                          │
                                                          ▼
Supabase Edge Functions env (CRON_SECRET) ──valida──▶  200 o 401
```

Si esos dos no coinciden, cada disparo recibe **401**. El vault seguirá teniendo un valor y el job seguirá activo: el síntoma solo se ve en `net._http_response`.

**Vercel es un circuito aparte.** El `CRON_SECRET` de Vercel protege la ruta HTTP `apps/web/app/api/cron/recompute-rankings`, que la dispara Vercel Cron, no `pg_cron`. No pasa por el vault ni por estas edge functions. **No hace falta que su valor coincida** con el de aquí, aunque históricamente se usó el mismo.

### Rotarlo

Cambia el vault y las Edge Functions **en la misma ventana**, en cualquier orden: entre un cambio y el otro los disparos devuelven 401 y se reintentan al ciclo siguiente. No hace falta reprogramar los jobs: el `command` resuelve el vault en cada disparo, así que toma el valor nuevo solo.

**Advertencia:** eso vale para los jobs creados por este archivo. El job real de `send-appointment-reminders` no lo creó, así que **no sabemos si su `command` lee del vault o trae el valor incrustado**. Revísalo antes de rotar — y no pegues esa salida en ningún chat ni ticket.

---

## Diagnosticar

`pg_net` registra cada respuesta HTTP en `net._http_response`. Es la única traza de lo que hacen los jobs.

**Nunca incluyas la columna `command` de `cron.job` en una salida que vayas a compartir.** Puede acarrear el valor del secreto.

```sql
-- ultimos 20 disparos: status y error
SELECT id, created, status_code, error_msg
FROM net._http_response
ORDER BY created DESC
LIMIT 20;
```

```sql
-- estado de los jobs, sin la columna command
SELECT jobid, jobname, schedule, active
FROM cron.job
ORDER BY jobname;
```

```sql
-- ultima corrida de cada job (LEFT JOIN para ver los que nunca corrieron)
SELECT DISTINCT ON (j.jobid)
       j.jobname, j.active, d.status, d.start_time, d.return_message
FROM cron.job j
LEFT JOIN cron.job_run_details d ON d.jobid = j.jobid
ORDER BY j.jobid, d.start_time DESC NULLS LAST;
```

### Cómo leerlo

| Síntoma | Causa probable |
|---|---|
| `status_code` 401 o 403 | el vault y las Edge Functions no coinciden |
| `status_code` NULL y `error_msg` con contenido | ni siquiera hubo respuesta HTTP: DNS, red, o la función no está desplegada |
| El job existe pero `job_run_details` está vacío | nunca disparó — revisa `active`, y que `pg_cron` esté sobre la base correcta |
| El job no aparece en `cron.job` | nunca se creó, o se creó con otro nombre |
| Nada en `net._http_response` para `expire-purchase-requests` | esperado: ese job no hace HTTP |

Si el secreto falta del vault, el job igual se registra y cada disparo recibe 401 desde la edge function (el check del bearer rechaza la cadena vacía) — visible y seguro de depurar. Está documentado en [`20260531000001:17-20`](./migrations/20260531000001_pg_cron_schedules.sql).

---

## Deuda conocida

1. **Divergencia de nombre** en `send-appointment-reminders` — arriba de todo.
2. **Dos jobs sin migración**: el de recordatorios (por la divergencia) y `purge-verification-documents-hourly`, que no aparece en ningún archivo del repo. Mientras sigan así, un entorno nuevo no los tendría.
3. **`expire-purchase-requests` se agenda dentro de un `DO` condicionado** a que exista la extensión `pg_cron` ([`20260710000001:308`](./migrations/20260710000001_purchase_requests.sql)). En un entorno sin la extensión se salta en silencio y las solicitudes nunca expiran.

---

*Procedencia: los horarios y el manejo del secreto salen de los archivos de migración citados. El nombre real de `send-appointment-reminders` y la existencia de `purge-verification-documents-hourly` salen de consultas contra producción. El horario de ese último está sin confirmar.*
