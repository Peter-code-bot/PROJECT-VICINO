# Arnes de la bandeja de WhatsApp

Ejecuta `supabase/migrations/20261108180000_bandeja_whatsapp.sql` completa en un
PostgreSQL embebido (paquete `embedded-postgres`, con pgcrypto) imitando lo minimo
de Supabase que la migracion toca (roles `anon`/`authenticated`/`service_role`,
`auth.uid()`, `vault.decrypted_secrets`, `extensions.hmac`, `has_role`, `profiles`,
`user_roles`, la publicacion `supabase_realtime`) y ejercita los RPC bajo roles
reales con `SET LOCAL ROLE` + `request.jwt.claims`.

Existe porque `scripts/db-probe.mjs` no acepta PL/pgSQL (rechaza la palabra END) y
`scripts/apply-migration.mjs --dry-run` solo imprime: sin esto, los seis RPC no se
pueden ejercitar antes de produccion.

```bash
cd scripts/sql/arnes-bandeja-whatsapp && npm install && npm run probar
```

Levanta un servidor en el puerto 54329 en una carpeta temporal `data-db/` (se borra
al terminar), imprime una linea `ok`/`FALLO` por comprobacion y sale con 0 solo si
todo esta en verde. No tiene nada que ver con produccion ni lee ningun `.env`.

Las comprobaciones cubren: privilegios y RLS, firma valida/invalida/mal formada
(P0401), cuerpo no JSON y con U+0000, duplicados por cuerpo y por wamid, contactos
que no son array, timestamps del futuro, avisos fuera de orden, numero no conectado
(evento recortado), aislamiento entre dos negocios y el admin, preparar/cerrar envio,
estados que no retroceden y estados huerfanos (carrera con cerrar_envio), ventana de
24 h, ritmo, marcar leida, pausa (solo admin; sigue recibiendo, no responde),
desconectar un canal (cascada), FK compuestas y las cuatro purgas.
