# Cuentas internas: plan de aplicación en producción

Migraciones `20261102120000` a `20261102120400`. **No están aplicadas en
producción**; se probaron completas en staging
(`scripts/staging/probar-cuentas-internas.mjs`). El detalle con cifras y cuentas
concretas quedó fuera del repo, que es público: está en el reporte que recibieron
Pedro y Javier.

## Puesta al día con master (18-nov-2026)

- La rama integra master hasta el PR #107. Ninguna migración nueva de master toca
  lo que estas cambian: las cinco funciones de 120100 y la policy de
  `purchase_requests` siguen en producción idénticas a las copias de
  `docs/rollback/` (comparado contra `pg_get_functiondef` en solo lectura), así
  que el orden de los timestamps no importa.
- Staging al día con producción (se le aplicaron las 7 migraciones de master) y
  `probar-cuentas-internas.mjs` otra vez en verde de punta a punta.
- `apps/web/types/database.types.ts` es exactamente el de producción más lo que
  agregan estas cinco: aplicadas, `node scripts/gen-types.mjs --check` pasa.
- Relación con #106 y #107: el contador del panel
  (`lib/admin/cuentas-fuera-de-metricas.ts`) excluye un subconjunto de lo que
  marca 120000 (todas sus cuentas están en `cuentas_internas`), y el bloqueo de
  inicio de sesión de las `@demo.vicino.mx` es complementario a ocultarlas. Una
  vez aplicadas, el panel puede leer la tabla en lugar de su lista.

**Cuándo cambia lo público.** En cuanto se aplican 120000 a 120200, no al
mergear: el sitio y las vistas previas de Vercel leen la misma base de
producción. El merge solo despliega el proxy (`marcar_visto`) y los tipos.

**Lo que sigue visible a propósito.** Lo que publican las cuentas del equipo
(`equipo`) sigue en público: puede ser venta real. Si una publicación del equipo
es de prueba, se pausa desde la app o se oculta con la moderación; no hace falta
otra migración.

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

`db push` sigue bloqueado: se aplica una por una con `scripts/apply-migration.mjs`,
**fuera de las 09:00 UTC**, que es cuando corre el cron de rankings.

1. **Respaldo** (solo lectura), justo antes:
   `node scripts/respaldo-cuentas-internas.mjs`. Deja `respaldo.json`,
   `restaurar.sql` y `conteos.json` en `.respaldos/<fecha>-produccion/`, fuera de git.
2. **Aplicar en orden** 120000, 120100, 120200 (si Javier dice que sí), 120300 y
   120400, cada una con
   `node scripts/apply-migration.mjs <archivo>.sql` (primero con `--dry-run`).
   La herramienta mete el archivo y su fila del ledger en la misma transacción.
   Cada migración trae su `DO $verify$` y un `lock_timeout` de 5 s: si algo no
   cuadra o no consigue un candado, aborta sin dejar nada a medias.
3. **Ledger**: comprobar que quedaron las cinco (o cuatro) versiones en
   `supabase_migrations.schema_migrations`.
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
