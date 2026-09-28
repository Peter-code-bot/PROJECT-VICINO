# Migraciones del 27-sep-2026 — APLICADAS en producción el 28-sep-2026 (01:03-01:06 CDMX)

> Aplicadas una por una con `scripts/apply-migration.mjs`, con autorización expresa
> de Pedro en el chat. Ledger de prod: 184 versiones, máxima `20260927180000`.
> `gen-types --check` en verde. Verificación de cada una en solo lectura y humo con
> la clave anon (abajo). Lo que sigue es la guía original, como registro.

Ninguna está aplicada en producción. Todas salieron de hallazgos confirmados en
solo lectura contra prod (revisión adversarial del 27-sep con verificación
escéptica). El código que las acompaña ya está en `master`.

Aplicar en este orden, una por una, con:

```bash
node scripts/apply-migration.mjs <archivo>
```

| # | Archivo | Qué arregla | Riesgo / nota |
|---|---|---|---|
| 1 | `20260927140000_categoria_id_desde_el_slug.sql` | Rankings: las publicaciones de la app tienen `categoria_id` NULL y no cuentan. El trigger lo deriva SIEMPRE del slug (un id que mande el cliente no cuenta) y revoca el UPDATE de la columna. Backfill de 11 filas. | Mueve `updated_at` de esas 11 filas. Pruebas: `npx tsx scripts/test-migraciones-27-sep.ts` (PGlite local, 15/15 las cinco) y `scripts/staging/probar-categoria-id.mjs` (staging, dentro de ROLLBACK). |
| 2 | `20260927150000_quitar_notify_push_sin_autorizacion.sql` | Quita `notify_push()`: manda a send-push sin autorización y deja un 401 por venta o reserva. El push real (`push_on_sale_pgnet`, `push-on-booking`) sigue. | Reversión en `docs/rollback/`. El verify exige que el push real exista. |
| 3 | `20260927160000_resenas_sin_columnas_forjables.sql` | Quien reseña podía insertar `respuesta`, `created_at` y un `product_id` ajeno. INSERT solo de las 8 columnas de la app y la policy exige el producto de la venta. | Requiere el código de master (la reseña toma `product_id` de la venta): ya está. Reversión en `docs/rollback/`. |
| 4 | `20260927170000_seller_rankings_sin_ingresos_publicos.sql` | Con la clave anon se leían los ingresos mensuales de cada vendedor. Público solo `category_id` y `period`. | El podio sale de RPC SECURITY DEFINER (el verify lo comprueba). Reversión en `docs/rollback/`. |
| 5 | `20260927180000_ranking_mes_en_hora_de_cdmx.sql` | El mes del ranking se cortaba en UTC: lo de 18:00-24:00 CDMX del último día contaba en el mes siguiente. | Va con el arreglo H4 del cron (ya en master). Después: `select recompute_seller_rankings('<mes actual>')` y el anterior. |

Después de cada una: `node scripts/gen-types.mjs --check` (ninguna cambia columnas
ni firmas visibles, debería seguir en verde).

Smoke después de la 4: `/rankings` sin sesión sigue mostrando categorías y podio;
`GET /rest/v1/seller_rankings?select=ingresos` con la clave anon da 42501.

Prueba de las cinco sin nada remoto (esquema mínimo en PGlite, roles anon y
authenticated, cada ataque y cada camino legítimo):

```bash
npx tsx scripts/test-migraciones-27-sep.ts
```

Las ramas `fix/ranking-categoria-id` y `fix/quitar-notify-push` quedan
sustituidas por esta (la de ranking tenía el trigger que respetaba un
`categoria_id` explícito).


## Resultado en producción (28-sep-2026)

| # | Verificación en prod |
|---|---|
| 1 | 0 publicaciones con `categoria_id` NULL; `authenticated` sin UPDATE de la columna; trigger SECURITY DEFINER activo. |
| 2 | `notify_push` no existe; siguen `push_on_sale_pgnet`, `push-on-booking`, `push_on_message_pgnet`, `push_on_appointment_pgnet`. |
| 3 | Sin INSERT de `respuesta`/`created_at`; con INSERT de `product_id`/`fotos`; UPDATE de `respuesta` intacto; la policy comprueba `product_id`. |
| 4 | anon: `select=ingresos` → 42501; `select=category_id,period` → 200; `get_ranking_hiperlocal` → 200 con 10 filas cerca de Villahermosa; `/rankings` 200. |
| 5 | La función corta el mes en `America/Mexico_City`, sin sobrecargas, EXECUTE solo `service_role`. |

No hizo falta recalcular agosto: 0 ventas, reseñas y chats en la franja del 31-ago de 18:00 a
24:00 CDMX. Septiembre lo recalcula el cron diario (09:00 UTC) con la ventana nueva.
Nota: desde Puebla el ranking de septiembre sale vacío porque sus vendedores están a 567 km o
más (Villahermosa); es el comportamiento hiperlocal esperado, no efecto de estas migraciones.
