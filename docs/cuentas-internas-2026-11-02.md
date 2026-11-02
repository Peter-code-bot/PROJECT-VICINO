# Cuentas internas: plan de aplicación en producción

Migraciones `20261102120000` a `20261102120400`. **No están aplicadas en
producción**; se probaron completas en staging
(`scripts/staging/probar-cuentas-internas.mjs`). El detalle con cifras y cuentas
concretas quedó fuera del repo, que es público: está en el reporte que recibieron
Pedro y Javier.

## Qué hace cada migración

1. `20261102120000_cuentas_internas`: crea la tabla privada `cuentas_internas`
   (`sintetica` / `equipo` / `prueba`), oculta las cuentas sintéticas con la bandera
   de moderación que ya respetan feed, búsqueda, mapa, ficha, tienda, solicitudes,
   comunidades, reseñas y podio, oculta sus comunidades y cierra la lectura por id de
   solicitudes de compradores ocultos. Las cuentas del equipo van por UUID: sus
   correos no se escriben en un repo público.
2. `20261102120100_neutralizar_ventas_de_prueba`: una venta con una cuenta interna en
   cualquier punta es de prueba. Oculta sus reseñas y las escritas por cuentas
   internas, y recalcula puntos, ventas, unidades y calificaciones (solo pueden
   **bajar**). También borra y recalcula los rankings. **En adelante**, una prueba se
   completa igual, pero no suma ni resta reputación, su reseña nace oculta y el
   ranking la ignora.
3. `20261102120200_semilla_villahermosa_en_cuenta_de_javier`: **la decide Javier.**
   Oculta las publicaciones y la comunidad que, por sus huellas, dejó en su cuenta el
   seed de Villahermosa del 26-sep. No toca nada que publique después.
4. `20261102120300_actividad_diaria`: `last_seen_at` deja de usarse. Nunca se
   actualizaba, y si se actualizara cualquiera sin sesión vería a qué hora entra cada
   persona, por `last_seen_at` y por `updated_at`. En su lugar queda `actividad_diaria`,
   privada, con una fila por cuenta y día que el proxy escribe una vez por cuenta,
   dispositivo y día.
5. `20261102120400_metricas_externas`: `metricas_semanales_externas(n)` y
   `metricas_resumen_externas()`. Solo cuentan cuentas externas y miden la actividad
   por acciones. Solo las pueden llamar `service_role` y `postgres`.

## Aplicación

`db push` sigue bloqueado: se aplica a mano, con la Management API o el SQL Editor,
**fuera de las 09:00 UTC**, que es cuando corre el cron de rankings.

1. **Respaldo** (solo lectura), justo antes:
   `node scripts/respaldo-cuentas-internas.mjs`. Deja `respaldo.json`,
   `restaurar.sql` y `conteos.json` en `.respaldos/<fecha>-produccion/`, fuera de git.
2. **Aplicar en orden** 120000, 120100, 120200 (si Javier dice que sí), 120300 y
   120400. Cada una trae su `DO $verify$` y un `lock_timeout` de 5 s: si algo no
   cuadra o no consigue un candado, aborta sin dejar nada a medias.
3. **Registrar en el ledger** (`supabase_migrations.schema_migrations`).
4. **Conteos de después**: `node scripts/respaldo-cuentas-internas.mjs --solo-conteos`,
   para compararlos con `conteos.json`. `filas_de_ranking_internas`,
   `perfiles_sinteticos_visibles` y `publicaciones_visibles_sinteticas` deben quedar
   en 0.
5. **Tipos**: `node scripts/gen-types.mjs` no debe dejar diff, porque el PR ya los
   trae. Con eso el check "Production database types" se pone verde y el PR se puede
   mergear. El merge despliega el cambio del proxy (`marcar_visto`), así que va
   **después** de aplicar.
6. **Smoke**: `node scripts/smoke-produccion.mjs`.
7. **Cifras para terceros**, de aquí en adelante, solo con
   `node scripts/db-query.mjs "select * from metricas_resumen_externas()"` y
   `node scripts/db-query.mjs "select * from metricas_semanales_externas(12)"`.

**Reversión**: `docs/rollback/20261102120*_rollback.sql`, de la última a la primera.
Las funciones de 120100 leen `cuentas_internas`; si la tabla se borra primero, cada
venta completada falla. Después va el `restaurar.sql` del respaldo, que solo deshace
lo que hicieron las migraciones: desoculta lo que ellas ocultaron, devuelve los
contadores sin bajar ninguno y repone las filas de ranking borradas sin pisar las
recalculadas.

## Mantenimiento

- **Cuenta interna nueva** (QA, una prueba de alguien del equipo):
  `insert into public.cuentas_internas (user_id, tipo, motivo) values ('<uuid>', 'equipo' | 'prueba' | 'sintetica', '<de quién y por qué>')`.
  Si es sintética, además `update public.profiles set is_hidden = true where id = '<uuid>'`.
  Mientras no esté en la tabla, cuenta como externa.
- **Ventas de cuentas del equipo**: hoy toda venta con una cuenta interna en
  cualquier punta es de prueba. Si alguien del equipo empieza a vender de verdad desde
  su cuenta, hay que decidir si esa reputación cuenta y cambiar el criterio en
  `check_sale_completion`, `update_user_rating_on_review`, `sync_reviews_visibility`
  y `handle_sale_cancellation`. Las métricas y el ranking se quedan como están.
- **`actividad_diaria`** no tiene caducidad todavía. El aviso de privacidad cubre
  "métricas de uso (frecuencia de inicio de sesión…)", pero conviene fijar una
  retención.
