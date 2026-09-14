-- Donde se permite operar deja de ser solo una sugerencia del navegador.
--
-- EL PROBLEMA. La "cobertura" de VICINO vivia entera en el cliente, como filtro
-- de los resultados de geocodificacion de MapKit
-- (lib/geo/location-search.ts). El backend no comprobaba nada: la unica
-- validacion geografica al publicar es que las coordenadas sean de este
-- planeta (vender/actions.ts, -90/90 y -180/180), y la policy de INSERT solo
-- mira propiedad. Mover el pin del mapa a mano ya se salta el filtro, porque
-- ese camino no pasa por searchLocations.
--
-- Y hay un segundo objeto con geografia que lo deja claro: purchase_requests
-- se inserta DIRECTAMENTE desde el navegador
-- (components/solicitudes/create-request-drawer.tsx construye el WKT y lo manda
-- a PostgREST), sin ninguna Server Action por medio. Ahi no hay servidor donde
-- poner la regla. Ese es el argumento que decide el sitio: la cobertura tiene
-- que vivir en SQL o no vive en ningun lado.
--
-- LO QUE NO ERA CIERTO, y conviene dejarlo escrito porque el encargo lo daba
-- por hecho: cobertura y radio de busqueda de productos NO estaban acoplados.
-- Son tres radios distintos, sin variable, import, unidad ni fuente comunes:
--   1. COVERAGE_RADIUS_KM  -> filtro de geocodificacion, km, env var de build;
--   2. vicino_radius       -> busqueda de productos, METROS, cookie del usuario,
--                             reclampeada en el propio RPC a [1000, 50000];
--   3. delivery_radius_km  -> radio de entrega del vendedor, km, columna.
-- Ampliar uno nunca amplio otro. No habia nada que desacoplar; lo que faltaba
-- era la regla de servidor, que es esto.
--
-- MATIZ que tambien cambia el planteamiento: la cobertura de hoy se mide contra
-- la posicion ACTUAL del usuario, no contra Puebla. Puebla solo entra como
-- respaldo cuando no hay posicion guardada. O sea que el circulo de 200 km
-- SIGUE AL USUARIO: alguien en Monterrey obtiene 200 km alrededor de Monterrey.
-- En la practica la cobertura ya era nacional, y el "200 km desde Puebla" del
-- encargo describia el respaldo, no la regla.
--
-- ---------------------------------------------------------------------------
-- LA DECISION Y POR QUE ESTA
-- ---------------------------------------------------------------------------
-- Modo por defecto: 'pais'. Se puede publicar y operar desde cualquier punto de
-- Mexico. Es lo que ya ocurria de hecho (ver el matiz de arriba), asi que NO
-- deja fuera a nadie que hoy este dentro -- que es el unico cambio que no se
-- puede hacer a la ligera con usuarios reales ya publicando.
--
-- Cambiar a una zona concreta NO exige tocar codigo ni redesplegar: es un
-- UPDATE de una fila. Eso arregla de paso que la regla dependiera de
-- NEXT_PUBLIC_COVERAGE_RADIUS_KM, que al ser NEXT_PUBLIC_ se inlinea en el
-- build y por tanto jamas podria ser la fuente de una regla de servidor.
--
--   -- pasar a "Puebla y 200 km a la redonda":
--   UPDATE public.vicino_cobertura
--      SET modo = 'radio', centro_lat = 19.0414, centro_lng = -98.2063,
--          radio_km = 200
--    WHERE clave = 'operacion';
--
-- El poligono de Mexico se aproxima con una caja, igual que en el cliente, pero
-- con la esquina sureste recortada: la caja de location-search.ts (minLat 14.5,
-- minLng -118.5, maxLat 32.8, maxLng -86.5) mete dentro a Guatemala y Belice
-- enteros. Una caja nunca sera exacta; lo que se corrige aqui es el error
-- grosero de dar por mexicano otro pais.

create table if not exists public.vicino_cobertura (
  clave       text primary key,
  modo        text not null check (modo in ('pais', 'radio')),
  centro_lat  double precision,
  centro_lng  double precision,
  radio_km    double precision check (radio_km is null or radio_km > 0),
  actualizado timestamptz not null default now(),
  -- En modo 'radio' los tres valores son obligatorios: sin ellos la regla no
  -- se puede evaluar y el trigger dejaria pasar todo en silencio.
  constraint vicino_cobertura_radio_completo check (
    modo <> 'radio'
    or (centro_lat is not null and centro_lng is not null and radio_km is not null)
  )
);

comment on table public.vicino_cobertura is
  'Zona donde VICINO permite operar. Una fila, clave = operacion. Cambiarla NO requiere redespliegue: es la fuente de la regla de servidor, a diferencia de NEXT_PUBLIC_COVERAGE_RADIUS_KM, que se inlinea en el build.';

insert into public.vicino_cobertura (clave, modo, centro_lat, centro_lng, radio_km)
values ('operacion', 'pais', 19.0414, -98.2063, 200)
on conflict (clave) do nothing;

-- Solo lectura para el cliente: la pantalla puede querer avisar antes de
-- enviar, pero nadie cambia la cobertura desde el navegador.
alter table public.vicino_cobertura enable row level security;

drop policy if exists "cobertura visible para todos" on public.vicino_cobertura;
create policy "cobertura visible para todos"
  on public.vicino_cobertura for select
  using (true);

grant select on public.vicino_cobertura to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dice si un punto esta dentro de la zona de operacion.
--
-- STABLE y no IMMUTABLE porque lee una tabla: si se declarara IMMUTABLE, el
-- planificador podria cachear el resultado y un cambio de cobertura no surtiria
-- efecto hasta reiniciar.
--
-- Un punto nulo se considera DENTRO: hay publicaciones sin coordenadas y no es
-- trabajo de esta regla rechazarlas. El trigger de abajo solo mira filas que
-- traen ubicacion.
-- ---------------------------------------------------------------------------
create or replace function public.dentro_de_cobertura(
  p_lat double precision,
  p_lng double precision
)
returns boolean
language plpgsql
stable
set search_path to 'public'
as $$
declare
  c public.vicino_cobertura%rowtype;
begin
  if p_lat is null or p_lng is null then
    return true;
  end if;

  select * into c from public.vicino_cobertura where clave = 'operacion';

  -- Sin fila de configuracion no se inventa una regla: se deja pasar. Fallar
  -- cerrado aqui dejaria la app sin poder publicar por un dato de operacion
  -- ausente, que es peor que el problema que resuelve.
  if not found then
    return true;
  end if;

  if c.modo = 'radio' then
    return ST_DWithin(
      ST_MakePoint(p_lng, p_lat)::geography,
      ST_MakePoint(c.centro_lng, c.centro_lat)::geography,
      c.radio_km * 1000
    );
  end if;

  -- modo 'pais': caja de Mexico, con la esquina sureste recortada para no
  -- tragarse Guatemala y Belice. El corte diagonal deja dentro la peninsula de
  -- Yucatan y Chetumal, y fuera Peten y Belice.
  if p_lat < 14.5 or p_lat > 32.8 or p_lng < -118.5 or p_lng > -86.5 then
    return false;
  end if;
  if p_lat < 17.9 and p_lng > -91.5 then
    return false;
  end if;

  return true;
end;
$$;

comment on function public.dentro_de_cobertura(double precision, double precision) is
  'true si el punto cae en la zona donde VICINO opera, segun vicino_cobertura. Un punto nulo cuenta como dentro.';

grant execute on function public.dentro_de_cobertura(double precision, double precision)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- El trigger. Es el que de verdad obliga.
--
-- Va sobre las DOS tablas con geografia de usuario. purchase_requests es la
-- importante: ese INSERT sale del navegador sin pasar por ninguna Server
-- Action, asi que este trigger es la unica capa que existe para el.
--
-- 22023 (invalid_parameter_value) y no 23514: es un dato que la persona puede
-- corregir moviendo el pin, no una violacion de invariante del sistema.
-- ---------------------------------------------------------------------------
create or replace function public.exigir_cobertura_operacion()
returns trigger
language plpgsql
set search_path to 'public'
as $$
begin
  if new.ubicacion_geo is null then
    return new;
  end if;

  if not public.dentro_de_cobertura(
       ST_Y(new.ubicacion_geo::geometry),
       ST_X(new.ubicacion_geo::geometry)
     ) then
    raise exception 'Esa ubicacion esta fuera de la zona donde VICINO opera.'
      using errcode = '22023';
  end if;

  return new;
end;
$$;

drop trigger if exists exigir_cobertura_products_services on public.products_services;
create trigger exigir_cobertura_products_services
  before insert or update of ubicacion_geo on public.products_services
  for each row execute function public.exigir_cobertura_operacion();

drop trigger if exists exigir_cobertura_purchase_requests on public.purchase_requests;
create trigger exigir_cobertura_purchase_requests
  before insert or update of ubicacion_geo on public.purchase_requests
  for each row execute function public.exigir_cobertura_operacion();

-- ---------------------------------------------------------------------------
-- VERIFY
--
--   -- Las seis ubicaciones del encargo, en modo 'pais':
--   SELECT nombre, public.dentro_de_cobertura(lat, lng) FROM (VALUES
--     ('Puebla',            19.0414,  -98.2063),  -- true
--     ('Tlaxcala (limite)', 19.3139,  -98.2404),  -- true
--     ('Guadalajara',       20.6597, -103.3496),  -- true
--     ('Monterrey',         25.6866, -100.3161),  -- true
--     ('Cancun',            21.1619,  -86.8515),  -- true
--     ('Guatemala',         14.6349,  -90.5069),  -- false (bbox del cliente: true)
--     ('Madrid',            40.4168,   -3.7038)   -- false
--   ) AS t(nombre, lat, lng);
--
--   -- Y que el trigger obliga de verdad, bajo ROLLBACK:
--   BEGIN;
--     UPDATE public.products_services
--        SET ubicacion_geo = 'SRID=4326;POINT(-3.7038 40.4168)'
--      WHERE id = (SELECT id FROM public.products_services LIMIT 1);
--     -- esperado: 22023
--   ROLLBACK;
-- ---------------------------------------------------------------------------
