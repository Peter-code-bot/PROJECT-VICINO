# Migraciones pendientes del 27-sep-2026 (rama `fix/base-pendiente-27-sep`)

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
