# Design — Bandeja de WhatsApp

## Flujo de datos

```
Meta → POST /api/webhooks/whatsapp  (cuerpo JSON crudo + X-Hub-Signature-256)
  route.ts
    1. freno por IP resumida (rl:wa-webhook, 600/min, sin analitica; HMAC con VICINO_SAL_CUBETAS)
    2. WHATSAPP_APP_SECRET obligatorio (si falta: 503 + Sentry)
    3. tope 3 MB (cabecera y bytes)
    4. FIRMA verificada aqui con ese secreto (timingSafeEqual) → 401 si no coincide, sin tocar la base
    5. JSON parseable, forma minima (object + entry[]); otro `object` → 200 ignorado
    6. rpc ingerir_webhook_whatsapp(p_firma, p_cuerpo CRUDO) con la llave anon (sin sesion)
         a. formato de la firma; HMAC-SHA256 con vault.decrypted_secrets['whatsapp_app_secret'];
            comparacion por resumenes (tiempo constante); fallo → P0401
         b. jsonb (si falla, reintento sin el escape \u0000); `object` con IS DISTINCT FROM
         c. huella sha256(cuerpo) → eventos_webhook_whatsapp (ON CONFLICT → duplicado)
         d. UN cerrojo pg_advisory_xact_lock('whatsapp:webhook')
         e. entry[].changes[field=messages].value (typeof comprobado en cada nivel):
              canal por metadata.phone_number_id, pausado o no (si no existe: sin_canal)
              messages[] → upsert conversacion (canal, wa_id) + insert mensaje (UNIQUE wamid)
                + contadores; ultimo_mensaje_texto solo si es el mas reciente; timestamp acotado
              statuses[] → avanza el estado del saliente (nunca retrocede, solo su negocio);
                sin fila con ese wamid → estados_huerfanos_whatsapp (el de mayor rango)
         f. resumen {duplicado, nuevos, estados, estados_sin_mensaje, sin_canal, ignorados}
            → eventos.resultado; si no dejo nada, eventos.cuerpo se recorta (sin contenido)
    7. 200 + resumen | 401 (P0401: secretos distintos → Sentry) | 400 (22023 → Sentry)
       | 503 (55000 → Sentry) | 500 (42501 y otros → Sentry; Meta reintenta)

Vendedor → /seller/bandeja (RSC)        → SELECT conversaciones (RLS) + <RefrescoBandeja> (realtime → refresh)
         → /seller/bandeja/[id] (RSC)   → SELECT conversacion + ULTIMOS 300 mensajes (RLS) → <HiloWhatsApp>
              marcarLeidaWhatsApp → rpc marcar_leida (no_leidos=0, devuelve ultimo wamid) → Graph mark-as-read (mejor esfuerzo)
              responderWhatsApp → rpc preparar (dueno, activo, ventana, 1-4096, ritmo) → Graph POST /messages
                                → rpc cerrar (enviado+wamid, aplica huerfano | fallido+codigo)
                                → o NADA si no se pudo confirmar (queda pendiente; Sentry warning)

Admin → /admin/whatsapp → rpc conectar_canal_whatsapp / cambiar_estado_canal_whatsapp / eliminar_canal_whatsapp
                          (has_role admin dentro de los tres)
```

## Modelo de confianza

| Quien llama | Con que | Que puede hacer | Quien lo decide |
| --- | --- | --- | --- |
| Meta (o cualquiera) | llave anon, sin sesion | `ingerir_webhook_whatsapp` | la ruta con `WHATSAPP_APP_SECRET` y, de forma autoritativa, el HMAC con el App Secret del Vault; sin firma valida, P0401 y cero filas |
| Negocio con sesion | JWT authenticated | SELECT de lo suyo; preparar/cerrar/marcar sobre lo suyo | RLS `negocio_id = auth.uid()` y los mismos checks dentro de cada RPC |
| Admin | JWT authenticated + `user_roles` | SELECT de canales; conectar, pausar/reactivar, desconectar | `public.has_role(uid, 'admin')` dentro del RPC |
| Servidor Next | `WHATSAPP_ACCESS_TOKEN` (Vercel, server-only, solo whatsapp_business_messaging) | hablar con Graph | solo tras un `preparar` que ya valido al dueno |

Por que la firma se verifica en Postgres y no (solo) en Next: la service_role no esta en
Vercel, y un RPC ejecutable por `anon` es la unica forma de escribir sin sesion. Si la
verificacion viviera solo en la ruta, cualquiera con la llave anon podria llamar al RPC con
un cuerpo inventado. Con el HMAC dentro del RPC, el RPC mismo es la frontera. La
verificacion de la ruta no es opcional por otra razon: sin ella, cualquier POST forjado le
cuesta a la base un HMAC de hasta 3 MB y una lectura del Vault. Y cuando la ruta acepta y
la base rechaza, no es un atacante: los dos secretos divergen, y se reporta.

## Datos

```
canales_whatsapp          negocio_id UNIQUE → profiles; phone_number_id UNIQUE (digitos); waba_id; numero_mostrado; estado activo|pausado; conectado_por; UNIQUE (id, negocio_id)
conversaciones_whatsapp   canal_id → canales; negocio_id (repetido para RLS e indice); wa_id; nombre_perfil; ultimo_mensaje_texto(≤160); ultimo_mensaje_at; ultimo_entrante_at; no_leidos; UNIQUE(canal_id, wa_id); UNIQUE (id, negocio_id); FK (canal_id, negocio_id) → canales ON UPDATE CASCADE
mensajes_whatsapp         conversacion_id; negocio_id; direccion entrante|saliente; wamid UNIQUE (NULL solo en 'pendiente'); tipo (lista cerrada + unknown); texto(≤4096); estado; error_codigo/detalle; contexto_wamid; enviado_por; marca_tiempo; FK (conversacion_id, negocio_id) → conversaciones ON UPDATE CASCADE
eventos_webhook_whatsapp  huella sha256 UNIQUE; cuerpo jsonb (recortado si no dejo nada); resultado jsonb; recibido_at
estados_huerfanos_whatsapp wamid PK; negocio_id; estado; error_codigo/detalle; recibido_at
```

Estados de un saliente: `pendiente(0) → enviado(1) → entregado(2) → leido(3)`; `fallido(9)`
siempre aplica. Un aviso de Meta solo avanza (`whatsapp_rango_estado`). `recibido` es el
unico estado de un entrante (CHECKs cruzados). Un estado sin fila se guarda huerfano y
`cerrar_envio_whatsapp` lo aplica al poner el wamid.

Ventana de 24 h: `ultimo_entrante_at` propio (GREATEST con cada entrante, acotado a ahora
+ 5 min). No se usa `expiration_timestamp` de Meta porque desde Graph v24.0 el objeto
`conversation` se omite salvo en entradas gratuitas.

Indices: `(negocio_id, ultimo_mensaje_at DESC NULLS LAST)` para la lista;
`(conversacion_id, marca_tiempo DESC)` para el hilo; `(marca_tiempo)` para la purga;
`(negocio_id, created_at DESC)` para el ritmo y el ON DELETE de profiles; `(enviado_por)`
parcial; `(recibido_at)` en eventos y huerfanos.

## Errores (SQLSTATE → HTTP / UI)

| SQLSTATE | Significado | Ruta | Accion del vendedor |
| --- | --- | --- | --- |
| P0401 | firma invalida en la base (propio) | 401 + Sentry (secretos distintos) | — |
| 42501 | sin sesion / no admin / sin EXECUTE / privilegios perdidos | 500 + Sentry | "Necesitas iniciar sesión." |
| 22023 | dato invalido (mensaje escrito para la persona, con acentos via E'') | 400 + Sentry | tal cual |
| 55000 | estado: ventana cerrada, canal pausado, ritmo, falta secreto | 503 (solo secreto) + Sentry | tal cual |
| P0002 | no es suya / no existe | — | tal cual ("No se encontró la conversación.") |
| 23505 | numero o negocio ya conectado (admin; solo los que escribimos nosotros) | — | tal cual |
| otro | fallo | 500 + Sentry | generico + Sentry |

## Tres capas, un patron (como en 2026-11-08-enlaces-negocio)

| Capa | Donde | Para que |
| --- | --- | --- |
| Next | zod (`responderSchema`, `conectarSchema`, `cuerpoWebhookMetaSchema`) y la firma con `WHATSAPP_APP_SECRET` | rechazar basura antes de la base y dar el mensaje de su campo |
| RPC | los siete RPC | las mismas reglas aunque alguien llame a PostgREST directo |
| CHECK/UNIQUE/FK | las cinco tablas | ultima linea, sin mensaje amable |

## Lo que se probo y como

- 61 pruebas unitarias nuevas (firma, ventana, Graph via `cargarReal`, config, presentacion,
  cubeta por IP, ruta con `cargarReal`, acciones del vendedor y del admin con `cargarReal`);
  288/288 en la suite de `apps/web`, que ahora tambien corre en CI (`pnpm test`).
- La migracion completa, en un PostgreSQL 18 embebido con pgcrypto y una imitacion minima
  de Supabase, con 120 comprobaciones bajo `SET LOCAL ROLE anon|authenticated` y
  `request.jwt.claims` (`scripts/sql/arnes-bandeja-whatsapp/`, `npm run probar`).
- `pnpm type-check` (web y shared), ESLint de lo tocado; build de produccion en el preview de
  Vercel del PR #98 (en local solo sobre la version previa a la revision).
- Revision adversarial: 5 revisores + 3 jueces por hallazgo; 53 sostenidos, 0 criticos;
  48 corregidos del todo y 5 en parte (lista en docs/BANDEJA-WHATSAPP-2026-11-08.md).

## Decisiones

- **D1** Firma en Postgres con el Vault; llave anon. La ruta verifica ANTES con
  `WHATSAPP_APP_SECRET` (obligatorio); discrepancia → 401 + Sentry.
- **D2** Un token de servidor en Vercel para el piloto, solo `whatsapp_business_messaging`;
  por negocio (Vault + RPC) cuando haya Embedded Signup.
- **D3** Ventana de 24 h con `ultimo_entrante_at` propio, acotado al futuro.
- **D4** Un numero por negocio; conecta el admin; no se reasigna (se desconecta con
  `eliminar_canal_whatsapp` y se vuelve a conectar); FK compuestas atan negocio y canal.
- **D5** Estados que solo avanzan; `read` sin `delivered` se acepta; los que se adelantan
  se guardan huerfanos.
- **D6** Texto ≤ 4096; `to` con `+`.
- **D7** Adjuntos por tipo con pie; `edit`/`revoke` ignorados; `from` ausente ignorado.
- **D8** Retencion 7 dias (eventos, huerfanos) / 180 dias (mensajes; conversaciones sin
  actividad ni mensajes); el evento que no dejo nada se recorta en el acto.
- **D9** Graph v27.0 por defecto, explicita y configurable.
- **D10** Pausar = no responder; sigue recibiendo; solo admin pausa, reactiva y desconecta.
- **D11** Envio sin confirmar → 'pendiente', sin invitar a reenviar.
- **D12** Al cliente solo el codigo del fallo, traducido; el detalle en la base y Sentry.
- **D13** P0401 para la firma; 42501 reservado a privilegios.
- **D14** Pruebas unitarias en CI.
