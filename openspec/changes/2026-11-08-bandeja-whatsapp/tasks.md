# Tasks — Bandeja de WhatsApp

> Estado al 8-nov-2026 en la rama `feat/bandeja-whatsapp-20261108` (worktree
> `startup-marketplace-enlaces`, base `ebc09e2`, actualizada sobre `4c8e56b` = PR #88).
> Lo que necesita a Meta, a produccion o una decision queda marcado como pendiente de
> Pedro o de Alejandro.

## FASE 0 — GATE 0

- [x] T-00 Rama desde `origin/master` `ebc09e2` (lo que corre produccion tras el PR #85);
      merge de `4c8e56b` (PR #88) antes del PR.
- [x] T-01 Leer el DDL del chat interno (20260320000009), los patrones de webhook
      (`report-webhook`, crons con `CRON_SECRET`), `lib/supabase/admin.ts` y el change
      `2026-07-09-eradicate-vercel-service-role-key` (la service_role no esta en Vercel).
- [x] T-02 Sondear produccion (solo lectura, `db-probe.mjs`): pgcrypto en `extensions`,
      `extensions.hmac(bytea,bytea,text)`, Vault con `cron_secret`/`service_role_key`/
      `webhook_secret`, `has_role(uuid, app_role)`, publicacion realtime, 7 jobs de pg_cron
      como `postgres`, PostgreSQL 17.6.
- [x] T-03 Documentacion oficial de Meta (8-nov-2026, cuatro lectores): verificacion GET,
      firma HMAC, payload de `messages` y `statuses`, reintentos 7 dias, 3 MB, envio de
      texto, mark-as-read, `to` con `+`, ventana de 24 h, numero de prueba, System User
      token, App Secret, Embedded Signup (Tech Provider, App Review, limites).

## FASE 1 — Datos

- [x] T-10 Migracion `20261108180000_bandeja_whatsapp.sql`: 5 tablas (incluida
      `estados_huerfanos_whatsapp`), RLS, 7 RPC + 2 ayudantes, FK compuestas, realtime,
      4 jobs de purga, bloque VERIFY.
- [x] T-11 `database.types.ts` editado a mano (5 tablas, 9 funciones, FK compuestas).
- [x] T-12 Arnes `scripts/sql/arnes-bandeja-whatsapp/` (PostgreSQL embebido con pgcrypto
      imitando Supabase): 120 comprobaciones bajo roles reales en verde.
- [ ] T-13 **Pedro**: `node scripts/apply-migration.mjs supabase/migrations/20261108180000_bandeja_whatsapp.sql`
      (antes `--dry-run`), luego `node scripts/gen-types.mjs` y el bloque VERIFY.
- [ ] T-14 **Pedro**: crear el secreto `whatsapp_app_secret` en el Vault desde el SQL
      Editor con el App Secret de la app de Meta (docs, paso 10).

## FASE 2 — Servidor

- [x] T-20 `lib/whatsapp/{config,firma,ventana,graph,webhook-schema,bandera,presentacion}.ts`,
      `lib/supabase/sin-sesion.ts`, `lib/cubeta-ip.ts` (HMAC con `VICINO_SAL_CUBETAS`),
      dos limitadores nuevos.
- [x] T-21 Webhook `app/api/webhooks/whatsapp/route.ts` (GET verificacion; POST: secreto
      obligatorio, firma verificada en la ruta y en el RPC, codigos → HTTP + Sentry).
- [x] T-22 Acciones `app/seller/bandeja/actions.ts` (responder con 'sin confirmar',
      marcar leida) y `app/admin/whatsapp/actions.ts` (conectar sin distinguir mayusculas,
      pausar/reactivar, desconectar).
- [x] T-23 Pruebas: `firma` (5), `ventana` (6), `graph` (8), `config` (2), `presentacion` (4),
      `cubeta-ip` (2), `route` (13), `actions` del vendedor (12), `actions` del admin (9)
      = 61 nuevas; suite completa 288/288.
- [x] T-24 CI: job `unitarias` en `.github/workflows/security.yml` y script `pnpm test`.

## FASE 3 — Pantallas

- [x] T-30 `/seller/bandeja` (lista, no leidos, ventana, vacio con aviso honesto del piloto,
      aviso pausado), `/seller/bandeja/[id]` (ULTIMOS 300 mensajes; `<HiloWhatsApp>`:
      burbujas, estados, hora sin error de hidratacion, ventana en vivo, respuesta,
      lectura automatica, sin confirmar / fallido traducido), `<RefrescoBandeja>` realtime.
- [x] T-31 `/admin/whatsapp` (lista de canales, formulario de conexion, pausar/reactivar y
      desconectar con confirmacion y resultado visible).
- [x] T-32 Entradas de menu (vendedor y admin) detras de `NEXT_PUBLIC_VICINO_BANDEJA_WHATSAPP`.
- [x] T-33 `pnpm type-check` (web y shared) y ESLint de lo tocado en limpio.
- [x] T-34 Build de produccion en verde: en local sobre la version previa a la revision y en el
      preview de Vercel del PR #98 sobre la version final. En local no se repitio: regla de la
      laptop tras los pantallazos 0x9F del 8-nov (lo cubren el preview y la CI).
- [x] T-35 Revision adversarial (seguridad, SQL, TypeScript, privacidad/contrato, cobertura)
      con tres jueces por hallazgo: 53 sostenidos (5 altos, 21 medios, 27 bajos), 0 criticos;
      48 corregidos del todo y 5 en parte (lista y lo que falta en
      docs/BANDEJA-WHATSAPP-2026-11-08.md).

## FASE 4 — Meta y Vercel (Pedro; docs, pasos A-G)

- [ ] T-40 Cuenta de desarrollador + app "Connect with customers through WhatsApp" +
      business portfolio de VICINO.
- [ ] T-41 API Setup: Phone number ID y WhatsApp Business Account ID del numero de
      prueba; agregar su celular como destinatario (codigo).
- [ ] T-42 System User (Employee) + token permanente con `whatsapp_business_messaging`
      → `WHATSAPP_ACCESS_TOKEN` en Vercel.
- [ ] T-43 Vercel: `NEXT_PUBLIC_VICINO_BANDEJA_WHATSAPP=1`, `WHATSAPP_VERIFY_TOKEN` (solo
      letras y digitos), `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_APP_SECRET` (obligatorio),
      `VICINO_SAL_CUBETAS` (recomendado); redeploy.
- [ ] T-44 Meta → Configuration: Callback URL + Verify token → Verify and save →
      suscribir `messages` → Test (200 con `sin_canal: 1`) → comprobar `subscribed_apps`.
- [ ] T-45 `/admin/whatsapp`: conectar el numero de prueba a la cuenta vendedora de Pedro.
- [ ] T-46 Prueba real desde el celular autorizado: entrante, respuesta, palomitas,
      ventana cerrada tras 24 h.
- [ ] T-47 `node scripts/whatsapp-simular-webhook.mjs --url https://vicinomarket.com/api/webhooks/whatsapp`
      → `200 {"ok":true,...,"sin_canal":1}`.

## FASE 5 — Cierre

- [ ] T-50 **Alejandro**: revision visual de la bandeja y del hilo; firmar D1, D2, D4, D8,
      D10 y D11.
- [ ] T-51 PR #98 a `master`, abierto el 8-nov. Tras T-13: `node scripts/gen-types.mjs`, commit al
      PR (la CI de tipos pasa a verde) y merge con el OK de Pedro (sin merge hasta que T-13/T-14 y
      T-43 esten hechos: el codigo
      selecciona tablas nuevas solo detras de la bandera, pero el webhook responderia 503
      sin el Vault y Meta reintentaria 7 dias).
- [ ] T-52 Archivar el change y promover `specs/bandeja-whatsapp/spec.md`.
- [ ] T-53 Decidir: boton de pausa para el propio negocio (exige distinguir quien pauso);
      metodo de pago en la cuenta de WhatsApp Business; fecha para evaluar Embedded
      Signup; "latido" si no llegan webhooks en 24 h; paginar el hilo hacia atras; freno de
      clics de la fase 1 con HMAC; revalidar la lista solo si cambia; E2E de la bandeja.
