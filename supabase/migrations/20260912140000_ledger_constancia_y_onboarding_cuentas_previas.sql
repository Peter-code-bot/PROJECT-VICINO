-- Dos arreglos de datos y dos filas de constancia en el ledger.
--
-- 1. LEDGER. 20260903240000_registro_manual_activar_modo_vendedor y
--    20260905100000_onboarding_por_pasos se aplicaron a mano (lo dicen sus
--    propias cabeceras) y sus efectos ESTAN en produccion -- comprobado el
--    12-sep-2026: activar_modo_vendedor(text x6) y guardar_paso_onboarding
--    existen, y profiles tiene onboarding_camino, onboarding_paso e
--    intereses -- pero supabase_migrations.schema_migrations no las tiene.
--    El reporte del 6-sep decia "147 filas y ninguna pendiente"; eran 147
--    filas y DOS pendientes. Se anotan aqui, con ON CONFLICT por si alguien
--    las anoto entre medias, para que el ledger deje de mentir sobre esas dos.
--    (apply-migration.mjs anota esta misma migracion en la misma transaccion.)
--
-- 2. ONBOARDING. Seis cuentas tenian has_seen_onboarding = false cuando entro
--    el onboarding por pasos (20260905100000): la de revision de tiendas
--    (reviewconsolevicino@gmail.com, creada el 11-jun), dos vendedores y tres
--    cuentas sin un solo inicio de sesion. La intencion escrita en ese codigo
--    es que la bandera "se escribe al final del ultimo paso" para cuentas que
--    ENTRAN por el flujo nuevo; las anteriores no eligieron camino ni paso
--    (onboarding_camino y onboarding_paso son NULL en las seis) y el layout
--    del marketplace las manda a /bienvenida en cada visita. Para la cuenta
--    de revision eso es, ademas, la primera pantalla que veria el revisor de
--    la tienda. Se marcan como vistas todas las cuentas creadas ANTES del
--    6-sep-2026 que sigan en false: son exactamente esas seis hoy, y la fecha
--    deja fuera a cualquier cuenta que este a mitad del onboarding nuevo.
-- ---------------------------------------------------------------------------

insert into supabase_migrations.schema_migrations (version, name)
values
  ('20260903240000', 'registro_manual_activar_modo_vendedor'),
  ('20260905100000', 'onboarding_por_pasos')
on conflict (version) do nothing;

update public.profiles
   set has_seen_onboarding = true
 where has_seen_onboarding = false
   and created_at < '2026-09-06 00:00:00+00'
   and onboarding_paso is null;

-- ---------------------------------------------------------------------------
-- VERIFY (solo lectura, despues de aplicar):
--
--   SELECT count(*) FROM supabase_migrations.schema_migrations
--    WHERE version IN ('20260903240000', '20260905100000');          -- 2
--
--   SELECT count(*) FROM public.profiles
--    WHERE has_seen_onboarding = false
--      AND created_at < '2026-09-06 00:00:00+00';                    -- 0
--
--   SELECT p.has_seen_onboarding FROM auth.users u
--     JOIN public.profiles p ON p.id = u.id
--    WHERE u.email = 'reviewconsolevicino@gmail.com';                 -- true
--
--   -- y ningun archivo de master queda fuera del ledger:
--   -- comparar ls supabase/migrations con SELECT version FROM ... (152 vs 152
--   -- tras aplicar las cinco de hoy y las tres de comunidades)
-- ---------------------------------------------------------------------------
