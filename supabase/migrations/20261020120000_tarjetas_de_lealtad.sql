-- Tarjetas de lealtad por sellos, con copia sincronizada en Apple Wallet y
-- Google Wallet. Fase B del plan de Alejandro (20-oct-2026): el motor.
--
-- NO APLICADA. Se aplica con
--   node scripts/apply-migration.mjs supabase/migrations/20261020120000_tarjetas_de_lealtad.sql
-- (el script envuelve el archivo en BEGIN/COMMIT y registra el ledger, por eso
-- aqui no hay begin/commit propios) y despues `node scripts/gen-types.mjs`.
-- Javier pide staging antes de prod: scripts/staging/lib.mjs sirve para eso.
--
-- ---------------------------------------------------------------------------
-- PRINCIPIOS (del PDF, seccion 4 y 6)
--
-- 1. El saldo oficial vive aqui. Los pases de Wallet muestran una copia; ni el
--    QR ni el saldo visible en el telefono autorizan nada por si mismos.
-- 2. Ningun cliente escribe un saldo. authenticated solo tiene SELECT sobre
--    programas publicados, sus membresias y sus eventos; TODO lo demas (alta,
--    sello, canje, reversa, pases, cola) pasa por RPC SECURITY DEFINER que
--    toma la identidad de auth.uid() y valida en servidor.
-- 3. Idempotencia por diseno: una venta = un sello (indice unico por origen),
--    un canje = una clave del cliente, una reversa por evento. Repetir una
--    llamada devuelve el mismo resultado, no un duplicado.
-- 4. La historia no se borra: cancelar o revertir inserta un evento
--    compensatorio.
-- 5. La cola de Wallet (outbox) se escribe en la MISMA transaccion que cambia
--    el saldo, con version creciente, para que un trabajo viejo no pise datos
--    nuevos.
--
-- Supabase concede por defecto ALL a anon/authenticated en cada tabla nueva y
-- EXECUTE a PUBLIC en cada funcion nueva. Por eso cada objeto de abajo lleva su
-- REVOKE explicito y luego el GRANT minimo. Tres incidentes de este repo
-- vinieron de grants olvidados; el bloque DO del final lo comprueba.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. TABLAS
-- ===========================================================================

create table public.loyalty_programs (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'borrador'
    check (status in ('borrador', 'activo', 'pausado', 'archivado')),
  nombre text not null check (length(nombre) between 1 and 32),
  premio text not null check (length(premio) between 1 and 60),
  meta_sellos integer not null default 5 check (meta_sellos between 3 and 20),
  condiciones text check (condiciones is null or length(condiciones) <= 500),
  color text not null default '#1F5A4E' check (color ~ '^#[0-9A-Fa-f]{6}$'),
  plantilla text not null default 'clasica'
    check (plantilla in ('clasica', 'sellos', 'minimal')),
  version_actual integer not null default 0 check (version_actual >= 0),
  publicado_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.loyalty_programs is
  'Programa de lealtad por sellos de un negocio. UN programa vivo por vendedor (indice parcial). Solo se escribe por RPC.';
-- Un programa vivo por negocio (v1 del PDF). "archivado" queda reservado para
-- entregas futuras: hoy ninguna RPC archiva.
create unique index loyalty_programs_uno_por_negocio
  on public.loyalty_programs (seller_id) where status <> 'archivado';

create table public.loyalty_program_versions (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  version integer not null check (version >= 1),
  nombre text not null,
  premio text not null,
  meta_sellos integer not null,
  condiciones text,
  publicado_at timestamptz not null default now(),
  unique (program_id, version)
);
comment on table public.loyalty_program_versions is
  'Foto inmutable de las reglas en cada publicacion. Cambiar reglas no borra derechos acumulados: la membresia guarda la version que acepto.';

create table public.loyalty_memberships (
  id uuid primary key default gen_random_uuid(),
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  customer_profile_id uuid not null references public.profiles(id) on delete cascade,
  -- Identificador opaco del QR. Localiza la membresia; no suma ni canjea nada.
  public_id text not null unique default ('vl_' || replace(gen_random_uuid()::text, '-', '')),
  version_aceptada integer not null,
  sellos_disponibles integer not null default 0 check (sellos_disponibles >= 0),
  sellos_totales integer not null default 0 check (sellos_totales >= 0),
  premios_canjeados integer not null default 0 check (premios_canjeados >= 0),
  -- Crece con cada cambio de saldo; es la version que viaja a la cola de Wallet.
  wallet_version bigint not null default 0,
  status text not null default 'activa' check (status in ('activa', 'revocada')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, customer_profile_id)
);
comment on table public.loyalty_memberships is
  'Tarjeta individual de un cliente en un programa. Saldo cacheado; la verdad es loyalty_events.';
create index loyalty_memberships_cliente on public.loyalty_memberships (customer_profile_id);

create table public.loyalty_events (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.loyalty_memberships(id) on delete cascade,
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  tipo text not null check (tipo in ('earn', 'redeem', 'reverse', 'adjust')),
  -- Delta con signo: earn +1, redeem -meta, reverse el opuesto del original.
  sellos integer not null check (sellos <> 0),
  actor_id uuid references public.profiles(id) on delete set null,
  motivo text check (motivo is null or length(motivo) <= 200),
  origen_tipo text check (origen_tipo in ('sale_confirmation', 'redemption', 'event')),
  origen_id uuid,
  created_at timestamptz not null default now(),
  check ((origen_tipo is null) = (origen_id is null))
);
comment on table public.loyalty_events is
  'Bitacora de sellos. Una venta = un sello, un canje = un redeem, una reversa por evento: lo garantiza loyalty_events_origen_unico.';
create unique index loyalty_events_origen_unico
  on public.loyalty_events (tipo, origen_tipo, origen_id) where origen_id is not null;
create index loyalty_events_membership on public.loyalty_events (membership_id, created_at desc);
create index loyalty_events_program on public.loyalty_events (program_id, created_at desc);

create table public.loyalty_redemptions (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.loyalty_memberships(id) on delete cascade,
  program_id uuid not null references public.loyalty_programs(id) on delete cascade,
  version integer not null,
  premio text not null,
  costo_sellos integer not null check (costo_sellos > 0),
  status text not null default 'pendiente'
    check (status in ('pendiente', 'canjeado', 'cancelado', 'expirado')),
  clave_idempotencia uuid not null,
  -- Desafio de un solo uso: el cliente lo muestra, el negocio lo teclea.
  codigo text not null check (codigo ~ '^[0-9]{6}$'),
  expires_at timestamptz not null,
  confirmed_by uuid references public.profiles(id) on delete set null,
  confirmed_at timestamptz,
  event_id uuid references public.loyalty_events(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, clave_idempotencia)
);
comment on table public.loyalty_redemptions is
  'Canjes. El codigo solo sale por loyalty_mi_tarjeta al titular; el negocio nunca lo lee, lo teclea.';
create unique index loyalty_redemptions_pendiente_unico
  on public.loyalty_redemptions (membership_id) where status = 'pendiente';
create unique index loyalty_redemptions_codigo_pendiente
  on public.loyalty_redemptions (program_id, codigo) where status = 'pendiente';
create index loyalty_redemptions_program on public.loyalty_redemptions (program_id, created_at desc);

create table public.wallet_passes (
  id uuid primary key default gen_random_uuid(),
  membership_id uuid not null references public.loyalty_memberships(id) on delete cascade,
  proveedor text not null check (proveedor in ('apple', 'google')),
  serial_number text not null,
  -- Apple: token del web service de actualizacion (cabecera ApplePass).
  authentication_token text,
  -- Google: LoyaltyClass y LoyaltyObject.
  class_id text,
  object_id text,
  version_deseada bigint not null default 1,
  version_sincronizada bigint not null default 0,
  emitido_at timestamptz,
  -- Apple: primer registro de dispositivo. Emitido NO es guardado.
  guardado_at timestamptz,
  ultimo_error text,
  ultimo_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (membership_id, proveedor),
  unique (proveedor, serial_number)
);
comment on table public.wallet_passes is
  'Un pase por membresia y proveedor. Emitir un archivo o enlace no prueba que se guardo: guardado_at solo lo pone el registro de Apple.';

create table public.wallet_update_jobs (
  id bigint generated always as identity primary key,
  membership_id uuid not null references public.loyalty_memberships(id) on delete cascade,
  version bigint not null,
  status text not null default 'pendiente'
    check (status in ('pendiente', 'procesando', 'hecho', 'fallido')),
  intentos integer not null default 0,
  siguiente_intento_at timestamptz not null default now(),
  ultimo_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.wallet_update_jobs is
  'Outbox de sincronizacion con Wallet. Se escribe en la misma transaccion que el saldo; un trabajo vivo por membresia, con version creciente.';
create unique index wallet_update_jobs_vivo_unico
  on public.wallet_update_jobs (membership_id) where status in ('pendiente', 'procesando');
create index wallet_update_jobs_cola
  on public.wallet_update_jobs (siguiente_intento_at) where status = 'pendiente';

create table public.apple_device_registrations (
  device_library_identifier text not null,
  pass_id uuid not null references public.wallet_passes(id) on delete cascade,
  push_token text not null,
  created_at timestamptz not null default now(),
  primary key (device_library_identifier, pass_id)
);
comment on table public.apple_device_registrations is
  'Dispositivos registrados por pase segun el protocolo de Apple. Privado: solo service_role. Tope de 5 por pase (trigger).';
create index apple_device_registrations_pass on public.apple_device_registrations (pass_id);

-- Quien tiene el token de su propio pase puede registrar "dispositivos" sin
-- fin y convertir cada sello en miles de avisos APNs. Cinco por pase: al
-- entrar el sexto se va el mas viejo.
create or replace function public.apple_registros_tope()
returns trigger language plpgsql as $fn$
begin
  delete from public.apple_device_registrations r
    where r.pass_id = new.pass_id
      and r.device_library_identifier <> new.device_library_identifier
      and r.device_library_identifier in (
        select device_library_identifier from public.apple_device_registrations
        where pass_id = new.pass_id and device_library_identifier <> new.device_library_identifier
        order by created_at desc offset 4);
  return new;
end;
$fn$;
create trigger apple_device_registrations_tope
  before insert on public.apple_device_registrations
  for each row execute function public.apple_registros_tope();

-- Lo que el disparador de ventas no pudo registrar. Sin esto un fallo seria un
-- WARNING en un log que nadie lee (el modo de fallo favorito de este repo).
-- El negocio lo ve en su panel y lo repite con loyalty_sello_desde_venta.
create table public.loyalty_sellos_fallidos (
  sale_id uuid primary key references public.sale_confirmations(id) on delete cascade,
  seller_id uuid not null,
  buyer_id uuid not null,
  error text,
  created_at timestamptz not null default now()
);
comment on table public.loyalty_sellos_fallidos is
  'Ventas completadas cuyo sello fallo en el disparador. Privado; el negocio las ve por loyalty_resumen_negocio y las repite con loyalty_sello_desde_venta.';
create index loyalty_sellos_fallidos_seller on public.loyalty_sellos_fallidos (seller_id, created_at desc);

-- updated_at
create trigger loyalty_programs_updated_at before update on public.loyalty_programs
  for each row execute function public.handle_updated_at();
create trigger loyalty_memberships_updated_at before update on public.loyalty_memberships
  for each row execute function public.handle_updated_at();
create trigger loyalty_redemptions_updated_at before update on public.loyalty_redemptions
  for each row execute function public.handle_updated_at();
create trigger wallet_passes_updated_at before update on public.wallet_passes
  for each row execute function public.handle_updated_at();
create trigger wallet_update_jobs_updated_at before update on public.wallet_update_jobs
  for each row execute function public.handle_updated_at();

-- Versiones inmutables. DELETE solo llega por cascada (cuenta o programa
-- borrados); un UPDATE no tiene camino legitimo.
create or replace function public.loyalty_versiones_inmutables()
returns trigger language plpgsql as $fn$
begin
  raise exception 'Las versiones publicadas de un programa son inmutables' using errcode = '42501';
end;
$fn$;
create trigger loyalty_program_versions_inmutables
  before update on public.loyalty_program_versions
  for each row execute function public.loyalty_versiones_inmutables();

-- ===========================================================================
-- 2. RLS Y PRIVILEGIOS DE TABLA
-- ===========================================================================

alter table public.loyalty_programs enable row level security;
alter table public.loyalty_program_versions enable row level security;
alter table public.loyalty_memberships enable row level security;
alter table public.loyalty_events enable row level security;
alter table public.loyalty_redemptions enable row level security;
alter table public.wallet_passes enable row level security;
alter table public.wallet_update_jobs enable row level security;
alter table public.apple_device_registrations enable row level security;

alter table public.loyalty_sellos_fallidos enable row level security;
revoke all on table public.loyalty_programs, public.loyalty_program_versions,
  public.loyalty_memberships, public.loyalty_events, public.loyalty_redemptions,
  public.wallet_passes, public.wallet_update_jobs, public.apple_device_registrations,
  public.loyalty_sellos_fallidos
  from public, anon, authenticated;
revoke all on sequence public.wallet_update_jobs_id_seq from public, anon, authenticated;

-- Lectura publica SOLO de programas publicados; el dueno ve el suyo siempre.
create policy loyalty_programs_lectura on public.loyalty_programs for select
  using (status = 'activo' or seller_id = (select auth.uid()));
grant select on table public.loyalty_programs to anon, authenticated;

-- El cliente lee su membresia; el negocio, las de su programa.
create policy loyalty_memberships_lectura on public.loyalty_memberships for select
  using (
    customer_profile_id = (select auth.uid())
    or exists (
      select 1 from public.loyalty_programs p
      where p.id = loyalty_memberships.program_id and p.seller_id = (select auth.uid())
    )
  );
grant select on table public.loyalty_memberships to authenticated;

create policy loyalty_events_lectura on public.loyalty_events for select
  using (
    exists (
      select 1 from public.loyalty_memberships m
      where m.id = loyalty_events.membership_id and m.customer_profile_id = (select auth.uid())
    )
    or exists (
      select 1 from public.loyalty_programs p
      where p.id = loyalty_events.program_id and p.seller_id = (select auth.uid())
    )
  );
grant select on table public.loyalty_events to authenticated;

-- loyalty_program_versions, loyalty_redemptions, wallet_passes,
-- wallet_update_jobs y apple_device_registrations: sin policies ni grants.
-- Solo las RPC (owner) y service_role (BYPASSRLS) las tocan.

-- ===========================================================================
-- 3. HELPERS INTERNOS (sin EXECUTE para clientes; los llaman las RPC)
-- ===========================================================================

create or replace function public.loyalty_actor()
returns uuid language plpgsql stable security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := (select auth.uid());
begin
  if v_actor is null or (select vicino_guard.cuenta_suspendida()) then
    raise exception 'No autorizado' using errcode = '42501';
  end if;
  return v_actor;
end;
$fn$;

-- El unico camino que cambia un saldo. Bloquea la membresia, rechaza saldo
-- negativo, inserta el evento y actualiza los contadores cacheados.
create or replace function public.loyalty_aplicar_evento(
  p_membership_id uuid, p_tipo text, p_sellos integer, p_actor uuid,
  p_motivo text, p_origen_tipo text, p_origen_id uuid
) returns public.loyalty_events language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_m public.loyalty_memberships%rowtype;
  v_e public.loyalty_events%rowtype;
begin
  if p_tipo is null or p_tipo not in ('earn', 'redeem', 'reverse', 'adjust')
     or p_sellos is null or p_sellos = 0 then
    raise exception 'Evento invalido' using errcode = '22023';
  end if;
  select * into v_m from public.loyalty_memberships where id = p_membership_id for update;
  if not found then
    raise exception 'Membresia no disponible' using errcode = 'PT404';
  end if;
  if v_m.sellos_disponibles + p_sellos < 0 then
    raise exception 'Sellos insuficientes' using errcode = 'PT409', hint = 'saldo_insuficiente';
  end if;
  insert into public.loyalty_events (membership_id, program_id, tipo, sellos, actor_id, motivo, origen_tipo, origen_id)
    values (p_membership_id, v_m.program_id, p_tipo, p_sellos, p_actor, p_motivo, p_origen_tipo, p_origen_id)
    returning * into v_e;
  update public.loyalty_memberships set
    sellos_disponibles = sellos_disponibles + p_sellos,
    sellos_totales = greatest(0, sellos_totales + case
      when p_tipo = 'earn' then p_sellos
      when p_tipo = 'reverse' and p_sellos < 0 then p_sellos
      else 0 end),
    premios_canjeados = greatest(0, premios_canjeados + case
      when p_tipo = 'redeem' then 1
      when p_tipo = 'reverse' and p_sellos > 0 then -1
      else 0 end)
  where id = p_membership_id;
  return v_e;
end;
$fn$;

-- Outbox. Sube la version de la membresia siempre; encola solo si existe
-- algun pase (sin pase no hay nada que sincronizar). Un trabajo vivo por
-- membresia: si ya hay uno, se le sube la version en vez de duplicarlo.
create or replace function public.loyalty_encolar_wallet(p_membership_id uuid)
returns void language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_version bigint;
begin
  update public.loyalty_memberships set wallet_version = wallet_version + 1
    where id = p_membership_id returning wallet_version into v_version;
  if not found then return; end if;
  if not exists (select 1 from public.wallet_passes where membership_id = p_membership_id) then
    return;
  end if;
  insert into public.wallet_update_jobs as j (membership_id, version)
    values (p_membership_id, v_version)
    on conflict (membership_id) where status in ('pendiente', 'procesando')
    do update set version = greatest(j.version, excluded.version), siguiente_intento_at = now();
end;
$fn$;

-- Al pase y al negocio solo viaja el primer nombre: profiles.nombre trae el
-- nombre completo de Google y una tarjeta puede fotografiarse.
create or replace function public.loyalty_nombre_corto(p_nombre text)
returns text language sql immutable parallel safe as $fn$
  select left(split_part(coalesce(nullif(btrim(p_nombre), ''), 'Cliente'), ' ', 1), 24);
$fn$;

-- Todo lo que un pase necesita mostrar, en un solo sitio. Lo usan la tarjeta
-- del cliente, la emision y el procesador de la cola.
create or replace function public.wallet_snapshot_membresia(p_membership_id uuid)
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $fn$
  select jsonb_build_object(
    'membership', jsonb_build_object(
      'id', m.id, 'public_id', m.public_id, 'status', m.status,
      'sellos_disponibles', m.sellos_disponibles, 'sellos_totales', m.sellos_totales,
      'premios_canjeados', m.premios_canjeados, 'wallet_version', m.wallet_version,
      'version_aceptada', m.version_aceptada, 'created_at', m.created_at),
    'program', jsonb_build_object(
      'id', p.id, 'nombre', p.nombre, 'premio', p.premio, 'meta_sellos', p.meta_sellos,
      'condiciones', p.condiciones, 'color', p.color, 'plantilla', p.plantilla,
      'status', p.status, 'version_actual', p.version_actual),
    'cliente', jsonb_build_object('id', c.id, 'nombre', public.loyalty_nombre_corto(c.nombre)),
    'negocio', jsonb_build_object(
      'id', s.id,
      'nombre', public.profile_public_name(s.nombre, s.es_vendedor, s.seller_type, s.nombre_negocio),
      'foto', s.foto))
  from public.loyalty_memberships m
  join public.loyalty_programs p on p.id = m.program_id
  join public.profiles c on c.id = m.customer_profile_id
  join public.profiles s on s.id = p.seller_id
  where m.id = p_membership_id;
$fn$;

-- Una venta completada = un sello, si el negocio tiene programa activo y el
-- comprador ya tenia tarjeta. Idempotente por venta.
create or replace function public.loyalty_registrar_venta_interna(
  p_venta public.sale_confirmations, p_actor uuid
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_p public.loyalty_programs%rowtype;
  v_m public.loyalty_memberships%rowtype;
  v_e public.loyalty_events%rowtype;
begin
  if p_venta.id is null then
    raise exception 'Datos invalidos' using errcode = '22023';
  end if;
  if p_venta.status <> 'completed' then
    return jsonb_build_object('ok', false, 'motivo', 'venta_no_completada');
  end if;
  select * into v_p from public.loyalty_programs
    where seller_id = p_venta.seller_id and status = 'activo';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sin_programa_activo');
  end if;
  select * into v_m from public.loyalty_memberships
    where program_id = v_p.id and customer_profile_id = p_venta.buyer_id and status = 'activa';
  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sin_membresia');
  end if;
  if exists (
    select 1 from public.loyalty_events
    where tipo = 'earn' and origen_tipo = 'sale_confirmation' and origen_id = p_venta.id
  ) then
    return jsonb_build_object('ok', true, 'repeated', true, 'membership_id', v_m.id);
  end if;
  v_e := public.loyalty_aplicar_evento(v_m.id, 'earn', 1, p_actor, 'Compra confirmada', 'sale_confirmation', p_venta.id);
  perform public.loyalty_encolar_wallet(v_m.id);
  return jsonb_build_object('ok', true, 'repeated', false, 'membership_id', v_m.id, 'event_id', v_e.id);
exception when unique_violation then
  -- Dos confirmaciones casi simultaneas de la misma venta: la segunda ve el
  -- indice unico, no un sello doble.
  return jsonb_build_object('ok', true, 'repeated', true, 'membership_id', v_m.id);
end;
$fn$;

-- El disparador NUNCA tumba la venta: si el sello falla, queda un WARNING en
-- el log y el negocio puede repetirlo con loyalty_sello_desde_venta.
create or replace function public.loyalty_tras_venta_completada()
returns trigger language plpgsql security definer
set search_path = public, pg_temp as $fn$
begin
  begin
    perform public.loyalty_registrar_venta_interna(new, null);
  exception when others then
    raise warning 'loyalty: no se registro el sello de la venta % (%: %)', new.id, sqlstate, sqlerrm;
    insert into public.loyalty_sellos_fallidos (sale_id, seller_id, buyer_id, error)
      values (new.id, new.seller_id, new.buyer_id, left(sqlstate || ' ' || sqlerrm, 500))
      on conflict (sale_id) do update set error = excluded.error, created_at = now();
  end;
  return null;
end;
$fn$;
-- AFTER UPDATE a secas, no "OF status": complete_sale_on_mutual_confirm pone
-- status='completed' en un BEFORE y el UPDATE del cliente no nombra esa
-- columna, asi que un disparador "OF status" no se enteraria.
create trigger loyalty_sello_por_venta
  after update on public.sale_confirmations
  for each row
  when (new.status = 'completed' and old.status is distinct from new.status)
  execute function public.loyalty_tras_venta_completada();

revoke all on function public.loyalty_actor() from public, anon, authenticated;
revoke all on function public.loyalty_aplicar_evento(uuid, text, integer, uuid, text, text, uuid) from public, anon, authenticated;
revoke all on function public.loyalty_encolar_wallet(uuid) from public, anon, authenticated;
revoke all on function public.wallet_snapshot_membresia(uuid) from public, anon, authenticated;
revoke all on function public.loyalty_nombre_corto(text) from public, anon, authenticated;
revoke all on function public.apple_registros_tope() from public, anon, authenticated;
revoke all on function public.loyalty_registrar_venta_interna(public.sale_confirmations, uuid) from public, anon, authenticated;
revoke all on function public.loyalty_tras_venta_completada() from public, anon, authenticated;
revoke all on function public.loyalty_versiones_inmutables() from public, anon, authenticated;
grant execute on function public.wallet_snapshot_membresia(uuid) to service_role;

-- ===========================================================================
-- 4. RPC DEL NEGOCIO
-- ===========================================================================

-- Crea el borrador o actualiza el programa vivo. Si ya esta publicado y
-- cambian las reglas (nombre, premio, meta, condiciones), nace una version.
create or replace function public.loyalty_programa_guardar(
  p_nombre text, p_premio text, p_meta_sellos integer,
  p_condiciones text default null, p_color text default null, p_plantilla text default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_nombre text := nullif(btrim(coalesce(p_nombre, '')), '');
  v_premio text := nullif(btrim(coalesce(p_premio, '')), '');
  v_condiciones text := nullif(btrim(coalesce(p_condiciones, '')), '');
  v_color text := coalesce(p_color, '#1F5A4E');
  v_plantilla text := coalesce(p_plantilla, 'clasica');
  v_p public.loyalty_programs%rowtype;
  v_cambia_reglas boolean;
  v_cambia_pase boolean;
  v_membership_id uuid;
begin
  if not exists (select 1 from public.profiles where id = v_actor and es_vendedor is true) then
    raise exception 'Solo un vendedor puede tener un programa de lealtad' using errcode = '42501';
  end if;
  if v_nombre is null or length(v_nombre) > 32
     or v_premio is null or length(v_premio) > 60
     or p_meta_sellos is null or p_meta_sellos < 3 or p_meta_sellos > 20
     or (v_condiciones is not null and length(v_condiciones) > 500)
     or v_color !~ '^#[0-9A-Fa-f]{6}$'
     or v_plantilla not in ('clasica', 'sellos', 'minimal') then
    raise exception 'Datos invalidos' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('loyalty:programa:' || v_actor::text, 0));
  select * into v_p from public.loyalty_programs
    where seller_id = v_actor and status <> 'archivado' for update;
  if not found then
    insert into public.loyalty_programs (seller_id, nombre, premio, meta_sellos, condiciones, color, plantilla)
      values (v_actor, v_nombre, v_premio, p_meta_sellos, v_condiciones, v_color, v_plantilla)
      returning * into v_p;
    return to_jsonb(v_p);
  end if;
  v_cambia_reglas := v_p.nombre is distinct from v_nombre
    or v_p.premio is distinct from v_premio
    or v_p.meta_sellos is distinct from p_meta_sellos
    or v_p.condiciones is distinct from v_condiciones;
  if v_p.status in ('activo', 'pausado') and v_cambia_reglas
     and (select count(*) from public.loyalty_program_versions
          where program_id = v_p.id and publicado_at > now() - interval '1 day') >= 10 then
    -- Sin tope, un vendedor podria hinchar la tabla de versiones a voluntad.
    raise exception 'Demasiados cambios de reglas hoy' using errcode = 'PT409', hint = 'demasiadas_versiones';
  end if;
  v_cambia_pase := v_cambia_reglas or v_p.color is distinct from v_color;
  update public.loyalty_programs set
    nombre = v_nombre, premio = v_premio, meta_sellos = p_meta_sellos,
    condiciones = v_condiciones, color = v_color, plantilla = v_plantilla,
    version_actual = case
      when status in ('activo', 'pausado') and v_cambia_reglas then version_actual + 1
      else version_actual end
    where id = v_p.id returning * into v_p;
  -- Lo que se ve en el pase cambio: cada tarjeta con pase entra a la cola.
  if v_cambia_pase then
    for v_membership_id in
      select m.id from public.loyalty_memberships m
      where m.program_id = v_p.id
        and exists (select 1 from public.wallet_passes w where w.membership_id = m.id)
    loop
      perform public.loyalty_encolar_wallet(v_membership_id);
    end loop;
  end if;
  if v_p.status in ('activo', 'pausado') and v_cambia_reglas then
    insert into public.loyalty_program_versions (program_id, version, nombre, premio, meta_sellos, condiciones)
      values (v_p.id, v_p.version_actual, v_p.nombre, v_p.premio, v_p.meta_sellos, v_p.condiciones);
  end if;
  return to_jsonb(v_p);
end;
$fn$;

-- borrador -> activo (publica, version 1); activo <-> pausado. Idempotente.
create or replace function public.loyalty_programa_estado(p_estado text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_p public.loyalty_programs%rowtype;
begin
  if p_estado is null or p_estado not in ('activo', 'pausado') then
    raise exception 'Estado invalido' using errcode = '22023';
  end if;
  select * into v_p from public.loyalty_programs
    where seller_id = v_actor and status <> 'archivado' for update;
  if not found then
    raise exception 'No tienes un programa de lealtad' using errcode = 'PT404';
  end if;
  if v_p.status = p_estado then
    return to_jsonb(v_p);
  end if;
  if v_p.status = 'borrador' then
    if p_estado <> 'activo' then
      raise exception 'Un borrador solo puede publicarse' using errcode = 'PT409', hint = 'transicion_invalida';
    end if;
    update public.loyalty_programs
      set status = 'activo', version_actual = 1, publicado_at = now()
      where id = v_p.id returning * into v_p;
    insert into public.loyalty_program_versions (program_id, version, nombre, premio, meta_sellos, condiciones)
      values (v_p.id, 1, v_p.nombre, v_p.premio, v_p.meta_sellos, v_p.condiciones);
    return to_jsonb(v_p);
  end if;
  update public.loyalty_programs set status = p_estado where id = v_p.id returning * into v_p;
  return to_jsonb(v_p);
end;
$fn$;

-- Teclea el codigo que el cliente muestra. Descuenta los sellos y cierra el
-- canje en una sola transaccion. Repetir el mismo codigo en la hora siguiente
-- devuelve el mismo resultado (doble lectura en caja).
create or replace function public.loyalty_canje_confirmar(p_codigo text)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_p public.loyalty_programs%rowtype;
  v_r public.loyalty_redemptions%rowtype;
  v_m public.loyalty_memberships%rowtype;
  v_e public.loyalty_events%rowtype;
  v_cliente text;
begin
  if p_codigo is null or p_codigo !~ '^[0-9]{6}$' then
    raise exception 'Codigo invalido' using errcode = '22023';
  end if;
  select * into v_p from public.loyalty_programs
    where seller_id = v_actor and status in ('activo', 'pausado');
  if not found then
    raise exception 'No tienes un programa publicado' using errcode = 'PT404';
  end if;
  select * into v_r from public.loyalty_redemptions
    where program_id = v_p.id and codigo = p_codigo and status = 'pendiente';
  if not found then
    select * into v_r from public.loyalty_redemptions
      where program_id = v_p.id and codigo = p_codigo and status = 'canjeado'
        and confirmed_at > now() - interval '1 hour'
      order by confirmed_at desc limit 1;
    if found then
      select public.loyalty_nombre_corto(c.nombre) into v_cliente
        from public.loyalty_memberships m join public.profiles c on c.id = m.customer_profile_id
        where m.id = v_r.membership_id;
      return jsonb_build_object('redemption', to_jsonb(v_r), 'cliente', v_cliente, 'repeated', true);
    end if;
    raise exception 'Codigo no valido' using errcode = 'PT404', hint = 'codigo_no_encontrado';
  end if;
  -- Mismo orden de bloqueo que loyalty_canje_iniciar: membresia y luego canje.
  select * into v_m from public.loyalty_memberships where id = v_r.membership_id for update;
  select * into v_r from public.loyalty_redemptions where id = v_r.id for update;
  if v_r.status <> 'pendiente' then
    raise exception 'El canje ya no esta pendiente' using errcode = 'PT409', hint = 'canje_cerrado';
  end if;
  if v_r.expires_at < now() then
    raise exception 'El codigo expiro' using errcode = 'PT409', hint = 'codigo_expirado';
  end if;
  if v_m.status <> 'activa' then
    raise exception 'Membresia revocada' using errcode = 'PT409', hint = 'revocada';
  end if;
  if v_m.sellos_disponibles < v_r.costo_sellos then
    raise exception 'Sellos insuficientes' using errcode = 'PT409', hint = 'sellos_insuficientes';
  end if;
  v_e := public.loyalty_aplicar_evento(v_m.id, 'redeem', -v_r.costo_sellos, v_actor,
    'Premio canjeado: ' || v_r.premio, 'redemption', v_r.id);
  update public.loyalty_redemptions
    set status = 'canjeado', confirmed_by = v_actor, confirmed_at = now(), event_id = v_e.id
    where id = v_r.id returning * into v_r;
  -- Con el premio entregado, la tarjeta pasa a las reglas vigentes.
  update public.loyalty_memberships
    set version_aceptada = greatest(version_aceptada, v_r.version) where id = v_m.id;
  perform public.loyalty_encolar_wallet(v_m.id);
  select public.loyalty_nombre_corto(nombre) into v_cliente
    from public.profiles where id = v_m.customer_profile_id;
  return jsonb_build_object('redemption', to_jsonb(v_r), 'cliente', v_cliente, 'repeated', false);
end;
$fn$;

-- Recuperacion manual del sello de una venta propia (si el disparador fallo).
create or replace function public.loyalty_sello_desde_venta(p_sale_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_venta public.sale_confirmations%rowtype;
  v_resultado jsonb;
begin
  if p_sale_id is null then
    raise exception 'Datos invalidos' using errcode = '22023';
  end if;
  select * into v_venta from public.sale_confirmations where id = p_sale_id;
  if not found or v_venta.seller_id <> v_actor then
    raise exception 'Venta no disponible' using errcode = 'PT404';
  end if;
  v_resultado := public.loyalty_registrar_venta_interna(v_venta, v_actor);
  -- Con el sello puesto (o sin nada que poner), la venta sale de la lista de fallidas.
  delete from public.loyalty_sellos_fallidos where sale_id = p_sale_id;
  return v_resultado;
end;
$fn$;

-- Evento compensatorio. Nunca borra. Una reversa por evento.
create or replace function public.loyalty_revertir_evento(p_event_id uuid, p_motivo text default null)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_e public.loyalty_events%rowtype;
  v_rev public.loyalty_events%rowtype;
  v_motivo text := coalesce(nullif(btrim(coalesce(p_motivo, '')), ''), 'Reversa');
begin
  if p_event_id is null or length(v_motivo) > 200 then
    raise exception 'Datos invalidos' using errcode = '22023';
  end if;
  select e.* into v_e from public.loyalty_events e
    join public.loyalty_programs p on p.id = e.program_id
    where e.id = p_event_id and p.seller_id = v_actor;
  if not found then
    raise exception 'Evento no disponible' using errcode = 'PT404';
  end if;
  if v_e.tipo not in ('earn', 'redeem') then
    raise exception 'Ese evento no se puede revertir' using errcode = 'PT409', hint = 'no_reversible';
  end if;
  if exists (
    select 1 from public.loyalty_events
    where tipo = 'reverse' and origen_tipo = 'event' and origen_id = v_e.id
  ) then
    raise exception 'Ese evento ya fue revertido' using errcode = 'PT409', hint = 'ya_revertido';
  end if;
  begin
    v_rev := public.loyalty_aplicar_evento(v_e.membership_id, 'reverse', -v_e.sellos, v_actor, v_motivo, 'event', v_e.id);
  exception when unique_violation then
    raise exception 'Ese evento ya fue revertido' using errcode = 'PT409', hint = 'ya_revertido';
  when sqlstate 'PT409' then
    -- El sello ya se gasto en un premio: resolverlo es una decision de
    -- producto (seccion 6 del PDF), no un UPDATE silencioso del saldo.
    raise exception 'Esos sellos ya se canjearon por un premio' using errcode = 'PT409', hint = 'ya_canjeado';
  end;
  perform public.loyalty_encolar_wallet(v_e.membership_id);
  return to_jsonb(v_rev);
end;
$fn$;

create or replace function public.loyalty_resumen_negocio()
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_p public.loyalty_programs%rowtype;
begin
  select * into v_p from public.loyalty_programs
    where seller_id = v_actor and status <> 'archivado';
  if not found then
    return jsonb_build_object('program', null);
  end if;
  return jsonb_build_object(
    'program', to_jsonb(v_p),
    'metricas', jsonb_build_object(
      'miembros', (select count(*) from public.loyalty_memberships where program_id = v_p.id and status = 'activa'),
      'sellos_emitidos', (select coalesce(sum(sellos), 0) from public.loyalty_events where program_id = v_p.id and tipo = 'earn'),
      'canjes', (select count(*) from public.loyalty_redemptions where program_id = v_p.id and status = 'canjeado'),
      'canjes_pendientes', (select count(*) from public.loyalty_redemptions
        where program_id = v_p.id and status = 'pendiente' and expires_at >= now())),
    'eventos', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', e.id, 'tipo', e.tipo, 'sellos', e.sellos, 'motivo', e.motivo,
        'created_at', e.created_at, 'membership_id', e.membership_id,
        'cliente', public.loyalty_nombre_corto(c.nombre),
        'revertido', exists (
          select 1 from public.loyalty_events r
          where r.tipo = 'reverse' and r.origen_tipo = 'event' and r.origen_id = e.id)
      ) order by e.created_at desc)
      from (
        select * from public.loyalty_events where program_id = v_p.id
        order by created_at desc limit 20
      ) e
      join public.loyalty_memberships m on m.id = e.membership_id
      join public.profiles c on c.id = m.customer_profile_id
    ), '[]'::jsonb),
    'ventas_sin_sello', coalesce((
      select jsonb_agg(jsonb_build_object('sale_id', f.sale_id, 'created_at', f.created_at, 'error', left(f.error, 120))
        order by f.created_at desc)
      from (
        select * from public.loyalty_sellos_fallidos where seller_id = v_actor
        order by created_at desc limit 10
      ) f
    ), '[]'::jsonb),
    'canjes_recientes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', r.id, 'status', r.status, 'premio', r.premio, 'costo_sellos', r.costo_sellos,
        'confirmed_at', r.confirmed_at, 'created_at', r.created_at, 'expires_at', r.expires_at,
        'cliente', public.loyalty_nombre_corto(c.nombre)
      ) order by r.created_at desc)
      from (
        select * from public.loyalty_redemptions where program_id = v_p.id
        order by created_at desc limit 10
      ) r
      join public.loyalty_memberships m on m.id = r.membership_id
      join public.profiles c on c.id = m.customer_profile_id
    ), '[]'::jsonb)
  );
end;
$fn$;

-- ===========================================================================
-- 5. RPC DEL CLIENTE
-- ===========================================================================

-- Alta idempotente: varios clics, una tarjeta.
create or replace function public.loyalty_inscribirse(p_program_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_p public.loyalty_programs%rowtype;
  v_m public.loyalty_memberships%rowtype;
begin
  if p_program_id is null then
    raise exception 'Datos invalidos' using errcode = '22023';
  end if;
  select * into v_p from public.loyalty_programs where id = p_program_id and status = 'activo';
  if not found then
    raise exception 'Programa no disponible' using errcode = 'PT404';
  end if;
  if v_p.seller_id = v_actor then
    raise exception 'No puedes unirte a tu propio programa' using errcode = 'PT409', hint = 'propio_programa';
  end if;
  insert into public.loyalty_memberships (program_id, customer_profile_id, version_aceptada)
    values (v_p.id, v_actor, v_p.version_actual)
    on conflict (program_id, customer_profile_id) do nothing;
  select * into v_m from public.loyalty_memberships
    where program_id = v_p.id and customer_profile_id = v_actor;
  if v_m.status <> 'activa' then
    raise exception 'Membresia revocada' using errcode = 'PT409', hint = 'revocada';
  end if;
  return jsonb_build_object(
    'membership', to_jsonb(v_m),
    'program', jsonb_build_object('id', v_p.id, 'seller_id', v_p.seller_id, 'nombre', v_p.nombre,
      'premio', v_p.premio, 'meta_sellos', v_p.meta_sellos, 'color', v_p.color, 'plantilla', v_p.plantilla));
end;
$fn$;

create or replace function public.loyalty_mis_tarjetas()
returns jsonb language sql stable security definer
set search_path = public, pg_temp as $fn$
  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'public_id', m.public_id, 'status', m.status,
      'sellos_disponibles', m.sellos_disponibles, 'sellos_totales', m.sellos_totales,
      'premios_canjeados', m.premios_canjeados, 'created_at', m.created_at,
      'program', jsonb_build_object('id', p.id, 'nombre', p.nombre, 'premio', p.premio,
        'meta_sellos', p.meta_sellos, 'color', p.color, 'plantilla', p.plantilla, 'status', p.status),
      'negocio', jsonb_build_object('id', s.id,
        'nombre', public.profile_public_name(s.nombre, s.es_vendedor, s.seller_type, s.nombre_negocio),
        'foto', s.foto)
    ) order by m.created_at desc), '[]'::jsonb)
  from public.loyalty_memberships m
  join public.loyalty_programs p on p.id = m.program_id
  join public.profiles s on s.id = p.seller_id
  where m.customer_profile_id = (select auth.uid()) and p.status <> 'archivado';
$fn$;

-- VOLATILE a proposito: expira los canjes vencidos antes de contestar.
create or replace function public.loyalty_mi_tarjeta(p_membership_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_m public.loyalty_memberships%rowtype;
  v_p public.loyalty_programs%rowtype;
begin
  if p_membership_id is null then
    raise exception 'Datos invalidos' using errcode = '22023';
  end if;
  select * into v_m from public.loyalty_memberships
    where id = p_membership_id and customer_profile_id = v_actor;
  if not found then
    raise exception 'Tarjeta no disponible' using errcode = 'PT404';
  end if;
  update public.loyalty_redemptions set status = 'expirado'
    where membership_id = v_m.id and status = 'pendiente' and expires_at < now();
  select * into v_p from public.loyalty_programs where id = v_m.program_id;
  return public.wallet_snapshot_membresia(v_m.id) || jsonb_build_object(
    'meta_canje', public.loyalty_meta_canje(v_p, v_m),
    'canje_pendiente', (
      select jsonb_build_object('id', r.id, 'codigo', r.codigo, 'expires_at', r.expires_at,
        'premio', r.premio, 'costo_sellos', r.costo_sellos)
      from public.loyalty_redemptions r
      where r.membership_id = v_m.id and r.status = 'pendiente'),
    'eventos', coalesce((
      select jsonb_agg(jsonb_build_object('id', e.id, 'tipo', e.tipo, 'sellos', e.sellos,
        'motivo', e.motivo, 'created_at', e.created_at) order by e.created_at desc)
      from (
        select * from public.loyalty_events where membership_id = v_m.id
        order by created_at desc limit 20
      ) e), '[]'::jsonb),
    'pases', coalesce((
      select jsonb_agg(jsonb_build_object('proveedor', w.proveedor, 'emitido_at', w.emitido_at,
        'guardado_at', w.guardado_at))
      from public.wallet_passes w where w.membership_id = v_m.id), '[]'::jsonb));
end;
$fn$;

-- La meta que se le cobra a una membresia: la vigente, salvo que la version que
-- acepto fuera mas barata. Subir la meta no borra derechos acumulados (PDF,
-- seccion 4); al canjear, la membresia pasa a la version vigente.
-- plpgsql y no sql: una funcion SQL llamada desde otra puede evaluarse con los
-- permisos del que llama y ver loyalty_program_versions vacia por RLS.
create or replace function public.loyalty_meta_canje(p_program public.loyalty_programs, p_membership public.loyalty_memberships)
returns integer language plpgsql stable security definer
set search_path = public, pg_temp as $fn$
declare
  v_meta_aceptada integer;
begin
  select v.meta_sellos into v_meta_aceptada from public.loyalty_program_versions v
    where v.program_id = p_program.id and v.version = p_membership.version_aceptada;
  return least(p_program.meta_sellos, coalesce(v_meta_aceptada, p_program.meta_sellos));
end;
$fn$;
revoke all on function public.loyalty_meta_canje(public.loyalty_programs, public.loyalty_memberships) from public, anon, authenticated;

-- Inicia un canje: reserva un codigo de un solo uso con 15 minutos de vida.
-- La misma clave devuelve el mismo canje; un pendiente vigente tambien.
create or replace function public.loyalty_canje_iniciar(p_membership_id uuid, p_clave uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_m public.loyalty_memberships%rowtype;
  v_p public.loyalty_programs%rowtype;
  v_r public.loyalty_redemptions%rowtype;
  v_codigo text;
  v_i integer;
  v_costo integer;
begin
  if p_membership_id is null or p_clave is null then
    raise exception 'Datos invalidos' using errcode = '22023';
  end if;
  select * into v_m from public.loyalty_memberships
    where id = p_membership_id and customer_profile_id = v_actor for update;
  if not found then
    raise exception 'Tarjeta no disponible' using errcode = 'PT404';
  end if;
  if v_m.status <> 'activa' then
    raise exception 'Membresia revocada' using errcode = 'PT409', hint = 'revocada';
  end if;
  select * into v_p from public.loyalty_programs where id = v_m.program_id;
  if v_p.status <> 'activo' then
    raise exception 'El programa no esta activo' using errcode = 'PT409', hint = 'programa_inactivo';
  end if;
  update public.loyalty_redemptions set status = 'expirado'
    where membership_id = v_m.id and status = 'pendiente' and expires_at < now();
  select * into v_r from public.loyalty_redemptions
    where membership_id = v_m.id and clave_idempotencia = p_clave;
  if found then
    return jsonb_build_object('redemption', to_jsonb(v_r), 'repeated', true);
  end if;
  select * into v_r from public.loyalty_redemptions
    where membership_id = v_m.id and status = 'pendiente';
  if found then
    return jsonb_build_object('redemption', to_jsonb(v_r), 'repeated', true);
  end if;
  v_costo := public.loyalty_meta_canje(v_p, v_m);
  if v_m.sellos_disponibles < v_costo then
    raise exception 'Sellos insuficientes' using errcode = 'PT409', hint = 'sellos_insuficientes';
  end if;
  -- 6 digitos sacados de gen_random_uuid (no de random()); reintenta si choca
  -- con otro pendiente del mismo programa.
  for v_i in 1..25 loop
    v_codigo := lpad((abs(('x' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))::bit(32)::bigint) % 1000000)::text, 6, '0');
    exit when not exists (
      select 1 from public.loyalty_redemptions
      where program_id = v_p.id and codigo = v_codigo and status = 'pendiente');
    v_codigo := null;
  end loop;
  if v_codigo is null then
    raise exception 'No se pudo generar un codigo, intenta de nuevo' using errcode = 'PT409', hint = 'reintentar';
  end if;
  insert into public.loyalty_redemptions
    (membership_id, program_id, version, premio, costo_sellos, clave_idempotencia, codigo, expires_at)
    values (v_m.id, v_p.id, v_p.version_actual, v_p.premio, v_costo, p_clave, v_codigo,
      now() + interval '15 minutes')
    returning * into v_r;
  return jsonb_build_object('redemption', to_jsonb(v_r), 'repeated', false);
end;
$fn$;

create or replace function public.loyalty_canje_cancelar(p_redemption_id uuid)
returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_r public.loyalty_redemptions%rowtype;
begin
  if p_redemption_id is null then
    raise exception 'Datos invalidos' using errcode = '22023';
  end if;
  select r.* into v_r from public.loyalty_redemptions r
    join public.loyalty_memberships m on m.id = r.membership_id
    where r.id = p_redemption_id and m.customer_profile_id = v_actor
    for update of r;
  if not found then
    raise exception 'Canje no disponible' using errcode = 'PT404';
  end if;
  if v_r.status = 'pendiente' then
    update public.loyalty_redemptions set status = 'cancelado'
      where id = v_r.id returning * into v_r;
  end if;
  return to_jsonb(v_r);
end;
$fn$;

-- Prepara (o recupera) el registro del pase del titular y devuelve todo lo
-- que hace falta para construirlo. El archivo/enlace lo arma el servidor.
create or replace function public.wallet_pase_preparar(
  p_membership_id uuid, p_proveedor text, p_class_id text default null, p_object_id text default null
) returns jsonb language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_actor uuid := public.loyalty_actor();
  v_m public.loyalty_memberships%rowtype;
  v_w public.wallet_passes%rowtype;
begin
  if p_membership_id is null or p_proveedor is null or p_proveedor not in ('apple', 'google')
     or (p_class_id is not null and p_class_id !~ '^[0-9]+\.[A-Za-z0-9._-]{1,180}$')
     or (p_object_id is not null and p_object_id !~ '^[0-9]+\.[A-Za-z0-9._-]{1,180}$')
     or (p_proveedor = 'apple' and (p_class_id is not null or p_object_id is not null)) then
    raise exception 'Datos invalidos' using errcode = '22023';
  end if;
  select * into v_m from public.loyalty_memberships
    where id = p_membership_id and customer_profile_id = v_actor for update;
  if not found then
    raise exception 'Tarjeta no disponible' using errcode = 'PT404';
  end if;
  if v_m.status <> 'activa' then
    raise exception 'Membresia revocada' using errcode = 'PT409', hint = 'revocada';
  end if;
  insert into public.wallet_passes as w
    (membership_id, proveedor, serial_number, authentication_token, class_id, object_id,
     version_deseada, version_sincronizada, emitido_at)
    values (v_m.id, p_proveedor, 'vicino-' || v_m.id::text,
      case when p_proveedor = 'apple'
        then replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '') end,
      p_class_id, p_object_id, greatest(v_m.wallet_version, 1), greatest(v_m.wallet_version, 1), now())
    on conflict (membership_id, proveedor) do update set
      class_id = coalesce(excluded.class_id, w.class_id),
      object_id = coalesce(excluded.object_id, w.object_id),
      version_deseada = greatest(w.version_deseada, excluded.version_deseada),
      version_sincronizada = greatest(w.version_deseada, excluded.version_deseada),
      emitido_at = coalesce(w.emitido_at, excluded.emitido_at),
      ultimo_error = null, ultimo_error_at = null
    returning * into v_w;
  return jsonb_build_object('pass', to_jsonb(v_w), 'snapshot', public.wallet_snapshot_membresia(v_m.id));
end;
$fn$;

revoke all on function public.loyalty_programa_guardar(text, text, integer, text, text, text) from public, anon;
revoke all on function public.loyalty_programa_estado(text) from public, anon;
revoke all on function public.loyalty_canje_confirmar(text) from public, anon;
revoke all on function public.loyalty_sello_desde_venta(uuid) from public, anon;
revoke all on function public.loyalty_revertir_evento(uuid, text) from public, anon;
revoke all on function public.loyalty_resumen_negocio() from public, anon;
revoke all on function public.loyalty_inscribirse(uuid) from public, anon;
revoke all on function public.loyalty_mis_tarjetas() from public, anon;
revoke all on function public.loyalty_mi_tarjeta(uuid) from public, anon;
revoke all on function public.loyalty_canje_iniciar(uuid, uuid) from public, anon;
revoke all on function public.loyalty_canje_cancelar(uuid) from public, anon;
revoke all on function public.wallet_pase_preparar(uuid, text, text, text) from public, anon;
grant execute on function public.loyalty_programa_guardar(text, text, integer, text, text, text) to authenticated;
grant execute on function public.loyalty_programa_estado(text) to authenticated;
grant execute on function public.loyalty_canje_confirmar(text) to authenticated;
grant execute on function public.loyalty_sello_desde_venta(uuid) to authenticated;
grant execute on function public.loyalty_revertir_evento(uuid, text) to authenticated;
grant execute on function public.loyalty_resumen_negocio() to authenticated;
grant execute on function public.loyalty_inscribirse(uuid) to authenticated;
grant execute on function public.loyalty_mis_tarjetas() to authenticated;
grant execute on function public.loyalty_mi_tarjeta(uuid) to authenticated;
grant execute on function public.loyalty_canje_iniciar(uuid, uuid) to authenticated;
grant execute on function public.loyalty_canje_cancelar(uuid) to authenticated;
grant execute on function public.wallet_pase_preparar(uuid, text, text, text) to authenticated;

-- ===========================================================================
-- 6. RPC DEL PROCESADOR DE LA COLA (solo service_role)
-- ===========================================================================

create or replace function public.wallet_jobs_tomar(p_limite integer default 20)
returns setof public.wallet_update_jobs language sql volatile security definer
set search_path = public, pg_temp as $fn$
  update public.wallet_update_jobs j
    set status = 'procesando', intentos = j.intentos + 1
    from (
      -- Un trabajo que se quedo en 'procesando' (funcion cortada por tiempo)
      -- vuelve a tomarse a los 5 minutos; si no, ni el ni los cambios de esa
      -- membresia se sincronizarian nunca.
      select id from public.wallet_update_jobs
      where (status = 'pendiente' and siguiente_intento_at <= now())
         or (status = 'procesando' and updated_at < now() - interval '5 minutes')
      order by siguiente_intento_at
      for update skip locked
      limit greatest(1, least(coalesce(p_limite, 20), 100))
    ) s
    where j.id = s.id
    returning j.*;
$fn$;

-- Cierra un trabajo. Si la version subio mientras se procesaba, vuelve a la
-- cola en vez de darse por hecho con datos viejos. Fallos: reintento con
-- retroceso exponencial hasta 8 intentos.
create or replace function public.wallet_job_terminar(
  p_id bigint, p_version_procesada bigint, p_ok boolean, p_error text default null
) returns void language plpgsql security definer
set search_path = public, pg_temp as $fn$
declare
  v_j public.wallet_update_jobs%rowtype;
begin
  select * into v_j from public.wallet_update_jobs where id = p_id for update;
  if not found then return; end if;
  if p_ok then
    if v_j.version > coalesce(p_version_procesada, 0) then
      update public.wallet_update_jobs
        set status = 'pendiente', siguiente_intento_at = now(), ultimo_error = null
        where id = p_id;
    else
      update public.wallet_update_jobs set status = 'hecho', ultimo_error = null where id = p_id;
    end if;
  elsif v_j.intentos >= 8 then
    update public.wallet_update_jobs
      set status = 'fallido', ultimo_error = left(p_error, 500) where id = p_id;
  else
    update public.wallet_update_jobs
      set status = 'pendiente',
          siguiente_intento_at = now() + (power(2, v_j.intentos) * interval '1 minute'),
          ultimo_error = left(p_error, 500)
      where id = p_id;
  end if;
end;
$fn$;

revoke all on function public.wallet_jobs_tomar(integer) from public, anon, authenticated;
revoke all on function public.wallet_job_terminar(bigint, bigint, boolean, text) from public, anon, authenticated;
grant execute on function public.wallet_jobs_tomar(integer) to service_role;
grant execute on function public.wallet_job_terminar(bigint, bigint, boolean, text) to service_role;

-- ===========================================================================
-- 7. VERIFICACION EN LA MISMA MIGRACION
-- ===========================================================================

do $verify$
declare
  v_dup text;
begin
  if has_table_privilege('anon', 'public.loyalty_memberships', 'SELECT')
     or has_table_privilege('anon', 'public.loyalty_redemptions', 'SELECT')
     or has_table_privilege('authenticated', 'public.loyalty_redemptions', 'SELECT')
     or has_table_privilege('authenticated', 'public.wallet_passes', 'SELECT')
     or has_table_privilege('authenticated', 'public.wallet_update_jobs', 'SELECT')
     or has_table_privilege('authenticated', 'public.apple_device_registrations', 'SELECT')
     or has_table_privilege('authenticated', 'public.loyalty_program_versions', 'SELECT')
     or has_table_privilege('authenticated', 'public.loyalty_sellos_fallidos', 'SELECT') then
    raise exception 'lealtad: lectura abierta de mas';
  end if;
  if has_table_privilege('authenticated', 'public.loyalty_programs', 'INSERT')
     or has_table_privilege('authenticated', 'public.loyalty_programs', 'UPDATE')
     or has_table_privilege('authenticated', 'public.loyalty_memberships', 'INSERT')
     or has_table_privilege('authenticated', 'public.loyalty_memberships', 'UPDATE')
     or has_table_privilege('authenticated', 'public.loyalty_events', 'INSERT')
     or has_table_privilege('anon', 'public.loyalty_programs', 'INSERT') then
    raise exception 'lealtad: escritura directa abierta';
  end if;
  if not has_table_privilege('anon', 'public.loyalty_programs', 'SELECT')
     or not has_table_privilege('authenticated', 'public.loyalty_memberships', 'SELECT')
     or not has_table_privilege('authenticated', 'public.loyalty_events', 'SELECT') then
    raise exception 'lealtad: faltan grants de lectura';
  end if;
  if has_function_privilege('anon', 'public.loyalty_inscribirse(uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.wallet_jobs_tomar(integer)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.loyalty_aplicar_evento(uuid,text,integer,uuid,text,text,uuid)', 'EXECUTE')
     or has_function_privilege('authenticated', 'public.loyalty_encolar_wallet(uuid)', 'EXECUTE')
     or not has_function_privilege('authenticated', 'public.loyalty_mi_tarjeta(uuid)', 'EXECUTE') then
    raise exception 'lealtad: privilegios de funciones incorrectos';
  end if;
  select string_agg(proname, ', ') into v_dup from (
    select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'loyalty\_%' or p.proname like 'wallet\_%')
    group by p.proname having count(*) > 1
  ) d;
  if v_dup is not null then
    raise exception 'lealtad: funciones duplicadas (300 en PostgREST): %', v_dup;
  end if;
end;
$verify$;

notify pgrst, 'reload schema';
