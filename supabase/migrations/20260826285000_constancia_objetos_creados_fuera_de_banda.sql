-- Constancia de dos objetos que viven en produccion sin archivo en el repo.
--
-- Encontrados el 12-sep-2026 al replicar las 152 migraciones del repo, en
-- orden, sobre un proyecto de Supabase vacio: la cadena se rompe en dos
-- sitios porque una migracion posterior da por hecho algo que NADIE creo.
--
--   1. public.verification_consent. 20260826290000 (RPC de consentimiento
--      biometrico) la lee y 20260826420000 la menciona, pero ningun archivo
--      la crea. Nacio en el Dashboard. DDL copiado del catalogo vivo
--      (columnas, defaults, FK, indice, RLS, dos policies y grants).
--
--   2. La policy "Buyers can book appointments" de public.appointments.
--      20260827110000 borra la policy floja ("Authenticated users can create")
--      y ASEGURA que esta quede como la unica de INSERT -- pero nadie la creo
--      en un archivo. Tambien nacio fuera de banda. Expresion copiada de
--      pg_policies.
--
-- Todo es IF NOT EXISTS / condicional: en produccion esta migracion no cambia
-- nada, solo deja escrito lo que ya hay y anota su version en el ledger. En un
-- proyecto vacio, permite que la cadena completa se aplique sin intervencion.
--
-- Los grants de verification_consent se copian TAL CUAL estan (anon con
-- INSERT/UPDATE/DELETE de tabla). No es lo que uno escribiria a mano, pero las
-- dos policies son TO authenticated y RLS esta activa, asi que anon no puede
-- hacer nada con ellos. Endurecerlos es otra migracion, no una constancia.
-- ---------------------------------------------------------------------------

create table if not exists public.verification_consent (
  id            uuid        not null default gen_random_uuid(),
  user_id       uuid        not null references public.profiles(id) on delete cascade,
  tipo          text        not null,
  aviso_version text        not null,
  aceptado_at   timestamptz not null default now(),
  user_agent    text,
  ip            inet,
  constraint verification_consent_pkey primary key (id)
);

create index if not exists idx_verification_consent_user_tipo
  on public.verification_consent (user_id, tipo);

alter table public.verification_consent enable row level security;

do $do$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'verification_consent'
       and policyname = 'Admin gestiona consentimientos'
  ) then
    create policy "Admin gestiona consentimientos"
      on public.verification_consent for all to authenticated
      using (exists (
        select 1 from public.user_roles
         where user_roles.user_id = (select auth.uid())
           and user_roles.role = 'admin'::public.app_role
      ));
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'verification_consent'
       and policyname = 'Usuario ve su propio consentimiento'
  ) then
    create policy "Usuario ve su propio consentimiento"
      on public.verification_consent for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'appointments'
       and policyname = 'Buyers can book appointments'
  ) then
    create policy "Buyers can book appointments"
      on public.appointments for insert to authenticated
      with check (
        (select auth.uid()) = buyer_id
        and buyer_id <> seller_id
        and exists (
          select 1 from public.products_services p
           where p.id = appointments.product_id
             and p.creador_id = appointments.seller_id
             and p.allow_appointments = true
             and p.estatus = 'disponible'::public.listing_status
             and p.is_hidden = false
        )
      );
  end if;
end
$do$;

grant select, insert, update, delete, references, trigger
  on public.verification_consent to anon, authenticated;
grant all on public.verification_consent to service_role;

-- ---------------------------------------------------------------------------
-- VERIFY:
--   SELECT count(*) FROM pg_policies WHERE tablename = 'verification_consent'; -- 2
--   SELECT count(*) FROM pg_policies
--    WHERE tablename = 'appointments' AND cmd = 'INSERT';                        -- 1
--   SELECT relrowsecurity FROM pg_class
--    WHERE oid = 'public.verification_consent'::regclass;                        -- true
-- ---------------------------------------------------------------------------
