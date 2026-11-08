# Proposal — Bandeja de WhatsApp (fase 2 de INT-CRM-20261104)

> Change: `2026-11-08-bandeja-whatsapp`. Rama `feat/bandeja-whatsapp-20261108` sobre
> `master` `ebc09e2`. **Trae codigo**: una migracion, un webhook, un cliente de la API de
> Meta, la bandeja del vendedor, una pantalla de admin y pruebas. **Nada aplicado en
> produccion, sin app en Meta todavia y con la pantalla apagada por bandera.**

## Why

La primera entrega de INT-CRM-20261104 (PR #85, en produccion desde el 8-nov-2026) puso
en la ficha de cada negocio los enlaces a Instagram, WhatsApp y Google Maps. El pendiente
decia: *despues, si el piloto lo justifica, una bandeja unificada*. Pedro pidio empezar a
construirla ya, con WhatsApp primero, porque es el canal por el que los negocios de VICINO
atienden de verdad. Esta change deja la infraestructura lista para un piloto con el numero
de prueba gratuito de Meta y un negocio, de modo que lo que falte sea solo lo humano
(cuentas, terminos, verificaciones) y no codigo.

Lo que se decidio NO hacer aqui, a proposito:

- Instagram, Messenger y resenas de Google: cada uno con su propia aprobacion de
  Meta/Google. Se decidira con lo que el piloto ensene.
- Plantillas (mensajes fuera de la ventana de 24 h): tienen costo por mensaje y proceso de
  aprobacion; el piloto solo responde dentro de la ventana.
- Adjuntos: se anuncian por tipo, no se descargan.
- Embedded Signup (que cada negocio conecte su numero real con un clic): exige que VICINO
  sea Tech Provider (Business Verification + App Review). Es la fase siguiente.

## Lo que hay hoy (leido, no supuesto)

- No existe ningun webhook de Meta ni tabla de mensajes externos. El chat interno
  (`chats`/`messages`, 20260320000009) es entre cuentas de VICINO y no sirve de molde: aqui
  el otro extremo es un numero de telefono y los mensajes entran por un tercero.
- Patrones de webhook en el repo: `/api/admin/report-webhook` (secreto compartido en
  cabecera, `timingSafeEqual`, 200 aunque falle el correo) y los crons con `CRON_SECRET`.
  Ninguno verifica una firma HMAC de un tercero.
- La `service_role` NO esta en Vercel (openspec/changes/2026-07-09-eradicate-vercel-
  service-role-key): una ruta que escriba sin sesion tiene que hacerlo por un RPC al que
  `anon` pueda llamar sin riesgo.
- Produccion tiene pgcrypto (`extensions.hmac`), supabase_vault (secretos `cron_secret`,
  `service_role_key`, `webhook_secret`), pg_cron (7 jobs como `postgres`) y la publicacion
  `supabase_realtime` con `chats`, `messages`, `notifications`, `sale_confirmations`.
  Comprobado con `scripts/db-probe.mjs` el 8-nov-2026.
- Los admins se deciden con `user_roles` / `has_role(uid, 'admin')`; las paginas de admin
  usan `requireAdminPage()` y las acciones `requireAdmin()`.
- `scripts/db-probe.mjs` rechaza la palabra END (no acepta PL/pgSQL) y
  `apply-migration.mjs --dry-run` solo imprime: ninguna herramienta del repo ejecuta una
  migracion con funciones antes de produccion.

## What changes

1. **Migracion `20261108180000_bandeja_whatsapp.sql`**: `canales_whatsapp` (numero ↔
   negocio), `conversaciones_whatsapp`, `mensajes_whatsapp`, `eventos_webhook_whatsapp`;
   RLS solo-lectura por `negocio_id`; RPC `ingerir_webhook_whatsapp` (ejecutable por
   `anon`, verifica la firma de Meta con el App Secret del Vault y escribe en una
   transaccion), `preparar_envio_whatsapp` / `cerrar_envio_whatsapp`,
   `marcar_leida_conversacion_whatsapp`, `conectar_canal_whatsapp` (admin),
   `cambiar_estado_canal_whatsapp` (admin o dueno); realtime; purgas a 7 y 180 dias.
2. **Webhook** `apps/web/app/api/webhooks/whatsapp/route.ts`: GET de verificacion
   (`WHATSAPP_VERIFY_TOKEN`), POST que reenvia el cuerpo crudo y la firma al RPC con la
   llave anon; frenos, topes y traduccion de codigos a HTTP.
3. **Cliente de Graph** `lib/whatsapp/graph.ts`: enviar texto y marcar leido, con los
   codigos de error de Meta traducidos a mensajes para la persona.
4. **Bandeja** `/seller/bandeja` y `/seller/bandeja/[id]`: lista con no leidos y estado de
   la ventana, hilo con estados de envio, respuesta, lectura automatica, refresco en vivo.
5. **Admin** `/admin/whatsapp`: conectar, pausar/reactivar y desconectar numeros (piloto).
6. **Bandera** `NEXT_PUBLIC_VICINO_BANDEJA_WHATSAPP=1` para pantalla y menus; el webhook
   funciona sin ella.
7. **Docs** `docs/BANDEJA-WHATSAPP-2026-11-08.md` con la lista de clics de Pedro;
   `scripts/whatsapp-simular-webhook.mjs` para probar la ruta sin Meta.

## Decisiones (D1-D14)

Estan en `design.md` y en el doc. Las que piden firma de Alejandro: **D1** (firma en
Postgres con Vault, llave anon, y antes en la ruta con `WHATSAPP_APP_SECRET` obligatorio),
**D2** (token unico del servidor en el piloto, solo `whatsapp_business_messaging`), **D4** (un
numero por negocio, conexion por admin, sin reasignacion: se desconecta y se vuelve a
conectar), **D8** (retencion 7/180 dias, conversaciones incluidas), **D10** (pausar = no
responder, sigue recibiendo; solo el equipo pausa/reactiva/desconecta) y **D11** (un envio
sin confirmar se queda pendiente, nunca se marca fallido).

## Revision adversarial (8-nov-2026)

Cinco revisores (seguridad, SQL, TypeScript/Next, privacidad y contrato, cobertura) y tres
jueces independientes por hallazgo: 53 sostenidos, 1 refutado, 0 criticos. Todos corregidos
en la rama; la lista con lo que cambio esta en `docs/BANDEJA-WHATSAPP-2026-11-08.md`
("Revision adversarial").

## Riesgos

- **Humano**: todo lo de Meta es de Pedro (cuenta, app, terminos, token, webhook). Sin eso
  el codigo no hace nada; con la bandera apagada no se ve.
- **SQL sin ejecutar en produccion**: se ejecuto en un Postgres 18 embebido que imita lo
  minimo de Supabase (`scripts/sql/arnes-bandeja-whatsapp/`, 120 comprobaciones). Lo que
  el local no imita (Vault real, PostgREST, realtime) lo cubre el VERIFY de la migracion y
  la prueba con el simulador.
- **Secreto en dos sitios** (Vercel y Vault, obligatorio en los dos): si se rota uno y no
  el otro, la ruta acepta, el RPC rechaza con P0401, se responde 401 y Sentry avisa en el
  acto; Meta reintenta mientras tanto. La lista de clics lo deja escrito.
- **Meta cambia la doc**: las URLs antiguas `/docs/whatsapp/cloud-api/*` ya redirigen a
  `/documentation/business-messaging/whatsapp/*`. Las fuentes citadas son las nuevas.

## Fuera de alcance

Plantillas, adjuntos, Embedded Signup, Instagram/Messenger, Google Business Profile,
pausa por el propio negocio (hoy solo el equipo; exigiria distinguir quien pauso), un
"latido" que avise si el webhook deja de recibir, paginar el hilo hacia atras.
