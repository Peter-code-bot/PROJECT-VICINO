-- Reversion de 20261118140000_bloquear_cuentas_demo.sql
--
-- Desbloquea las cuentas @demo.vicino.mx. OJO: su contraseña esta publicada en
-- supabase/seed-v2.sql y seed-dev.sql; desbloquearlas sin cambiarla vuelve a
-- dejar que cualquiera inicie sesion con ellas en produccion.
--
-- Correr en el SQL Editor como postgres. Despues, si se quiere volver a aplicar
-- la migracion con scripts/apply-migration.mjs, hay que borrar su fila del
-- ledger (la herramienta se niega a reaplicar una version):
--   DELETE FROM supabase_migrations.schema_migrations WHERE version = '20261118140000';

UPDATE auth.users
   SET banned_until = NULL
 WHERE lower(email) LIKE '%@demo.vicino.mx';
