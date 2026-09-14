-- La cuota que protege el saldo de OpenAI deja de depender de Redis.
--
-- EL PROBLEMA. verify-document.ts termina siempre en una llamada de vision de
-- OpenAI: cada invocacion cuesta dinero real de la cuenta del proyecto. El
-- unico freno es `enforce(verificacionRateLimit, ...)`, y enforce FALLA
-- ABIERTO por dos caminos distintos:
--
--   1. sin credenciales de Upstash, makeLimiter devuelve null y enforce sale
--      por `if (!limit) return { ok: true }`;
--   2. con credenciales, un timeout o un 5xx de Upstash cae en el catch, que
--      tambien devuelve `{ ok: true }`.
--
-- El fail-open es la decision correcta para casi todo lo demas de ese archivo
-- -- no se le cierra la app a nadie porque parpadee una dependencia -- pero
-- para el unico limite que protege DINERO es exactamente al reves: si el
-- guardia no esta, lo que hay que hacer es no gastar.
--
-- Y hoy no es hipotetico: Vercel Production no tiene UPSTASH_REDIS_REST_URL ni
-- UPSTASH_REDIS_REST_TOKEN, asi que ese enforce entra por el camino 1 en cada
-- llamada. O sea que el gasto de IA no tiene ningun tope.
--
-- LA SOLUCION es mover la cuota a donde SI hay disponibilidad: Postgres. Si la
-- base esta caida, la accion no puede hacer nada util de todos modos (ni leer
-- la imagen, ni guardar el resultado), asi que fallar cerrado aqui no quita
-- funcionalidad que se pudiera prestar.
--
-- El molde es el ledger de cuota de comunidades (20260912200000): tabla de
-- eventos + RPC SECURITY DEFINER que cuenta y anota en la misma llamada.
--
-- Cinco por hora es holgado para el caso legitimo: una persona se verifica una
-- vez, y si le sale mal reintenta un par de veces con otra foto. Es el mismo
-- numero que ya declaraba verificacionRateLimit; lo que cambia no es el limite,
-- es que ahora existe de verdad.

create table if not exists public.verificacion_ia_consumo (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references public.profiles(id) on delete cascade,
  created_at  timestamptz not null default now()
);

comment on table public.verificacion_ia_consumo is
  'Ledger de llamadas de vision de IA por usuario. Lo escribe SOLO consumir_cuota_verificacion_ia(); sirve para topar el gasto de OpenAI sin depender de Redis.';

create index if not exists verificacion_ia_consumo_user_reciente
  on public.verificacion_ia_consumo (user_id, created_at desc);

create index if not exists verificacion_ia_consumo_created_at
  on public.verificacion_ia_consumo (created_at);

-- RLS activada y CERO policies, a proposito: nadie llega a esta tabla por
-- PostgREST. La unica escritura pasa por la RPC de abajo, que es SECURITY
-- DEFINER y por tanto no evalua policies. Sin GRANT tampoco hay lectura: el
-- usuario no tiene por que poder contar ni borrar sus propios consumos, que es
-- justo como se saltaria la cuota.
alter table public.verificacion_ia_consumo enable row level security;

revoke all on public.verificacion_ia_consumo from anon, authenticated;

-- ---------------------------------------------------------------------------
-- Consume una unidad de cuota y dice si se puede gastar.
--
-- Cuenta y anota en la MISMA llamada, bajo una llave advisory del propio
-- usuario: sin ella, cinco peticiones simultaneas leerian las cinco un conteo
-- de 0 y pasarian las cinco. Es el mismo error que la cuota de intenciones de
-- compra evita con el mismo mecanismo.
--
-- Devuelve jsonb en vez de boolean para poder decir cuanto queda y cuando se
-- libera, que es lo que la pantalla necesita para no mentirle a la persona.
-- ---------------------------------------------------------------------------
create or replace function public.consumir_cuota_verificacion_ia()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_actor   uuid;
  v_usados  integer;
  v_tope    constant integer := 5;
  v_libera  timestamptz;
begin
  v_actor := (select auth.uid());
  if v_actor is null then
    raise exception 'unauthenticated' using errcode = '42501';
  end if;

  -- Serializa por usuario dentro de esta transaccion. Por USUARIO y no global:
  -- dos personas verificandose a la vez no tienen por que esperarse.
  perform pg_advisory_xact_lock(hashtextextended('verificacion:ia:' || v_actor::text, 0));

  select count(*) into v_usados
    from public.verificacion_ia_consumo c
   where c.user_id = v_actor
     and c.created_at > now() - interval '1 hour';

  if v_usados >= v_tope then
    select min(c.created_at) + interval '1 hour' into v_libera
      from public.verificacion_ia_consumo c
     where c.user_id = v_actor
       and c.created_at > now() - interval '1 hour';

    return jsonb_build_object(
      'permitido', false,
      'restantes', 0,
      'se_libera_en', v_libera
    );
  end if;

  insert into public.verificacion_ia_consumo (user_id) values (v_actor);

  return jsonb_build_object(
    'permitido', true,
    'restantes', v_tope - v_usados - 1,
    'se_libera_en', null
  );
end;
$$;

comment on function public.consumir_cuota_verificacion_ia() is
  'Topa a 5/hora las llamadas de vision de IA por usuario. Cuenta y anota en la misma llamada bajo llave advisory del actor. El actor es auth.uid(), nunca un argumento.';

revoke all on function public.consumir_cuota_verificacion_ia() from public, anon;
grant execute on function public.consumir_cuota_verificacion_ia() to authenticated;

-- Purga. Las filas solo sirven durante una hora; sin esto la tabla crece para
-- siempre guardando algo que ya no se consulta. Se limpia de forma perezosa en
-- cada consumo, con una probabilidad baja, para no pagar un DELETE en cada
-- llamada ni depender de que alguien programe un cron.
create or replace function public.purgar_verificacion_ia_consumo()
returns void
language sql
security definer
set search_path to 'public'
as $$
  delete from public.verificacion_ia_consumo
   where created_at < now() - interval '2 hours';
$$;

revoke all on function public.purgar_verificacion_ia_consumo() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- VERIFY (en un entorno de pruebas, bajo ROLLBACK)
--
--   BEGIN;
--     SET LOCAL ROLE authenticated;
--     SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';
--     SELECT public.consumir_cuota_verificacion_ia();  -- x5 -> permitido true,
--                                                      -- restantes 4,3,2,1,0
--     SELECT public.consumir_cuota_verificacion_ia();  -- 6.a -> permitido false
--                                                      -- y se_libera_en con fecha
--   ROLLBACK;
--
--   -- SET LOCAL ROLE es obligatorio: postgres BYPASEA la RLS y auth.uid()
--   -- saldria null (leccion 2 de CLAUDE.md).
--
--   -- La tabla no se alcanza por la API:
--   GET /rest/v1/verificacion_ia_consumo   -- con la llave anon -> 42501/404
--
--   -- Y nadie puede borrarse sus consumos para resetear la cuota:
--   DELETE /rest/v1/verificacion_ia_consumo?user_id=eq.<uuid>  -> denegado
-- ---------------------------------------------------------------------------
