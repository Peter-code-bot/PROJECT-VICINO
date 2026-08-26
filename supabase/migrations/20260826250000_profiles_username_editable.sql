-- Un @ que la persona elige, sin quitarle a moderacion su ancla inmutable.
--
-- Decision de Pedro (26-ago-2026), opcion B. Hoy el @ que pinta la interfaz es
-- profiles.user_id, un codigo aleatorio 'U' + 7 digitos que nadie puede
-- cambiar. Se anade una columna username editable y user_id se queda como
-- identificador interno permanente: asi un reporte de moderacion de hace dos
-- semanas sigue apuntando a la persona correcta aunque esa persona haya
-- cambiado su @ desde entonces.
--
-- Verificado antes de escribir esto: NINGUNA ruta publica resuelve por
-- username. Los 13 sitios del repo que enlazan a /vendedor/ pasan el UUID de
-- profiles.id, y app/(marketplace)/vendedor/[id]/page.tsx filtra por .eq("id").
-- Por eso cambiar el @ no rompe un solo enlace y no hace falta tabla de
-- redirecciones.

-- ---------------------------------------------------------------------------
-- 1. La columna, rellenada con el codigo actual.
--
-- Nace igual a user_id para que el primer dia nadie note un cambio visual: el
-- que veia @U8769877 sigue viendo @U8769877 hasta que decida cambiarlo.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;

UPDATE public.profiles SET username = user_id WHERE username IS NULL;

ALTER TABLE public.profiles ALTER COLUMN username SET NOT NULL;

-- ---------------------------------------------------------------------------
-- 2. Formato. Tiene que aceptar LOS DOS mundos.
--
-- El heredado ('U8769877') y el elegido ('pedro_soriano'). Si el CHECK solo
-- admitiera el segundo, generate_user_id dejaria de poder insertar y se
-- romperia el alta de cuentas nuevas — que es exactamente el tipo de fallo que
-- no se ve hasta que se registra alguien.
--
-- La lista de nombres reservados NO va aqui: va en el RPC. El formato es
-- estructural y no cambia; la politica de que palabras estan prohibidas si
-- cambia, y una lista dentro de un CHECK obliga a una migracion cada vez.
-- ---------------------------------------------------------------------------

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_username_formato
  CHECK (username ~ '^[A-Za-z0-9_]{3,30}$');

-- ---------------------------------------------------------------------------
-- 3. Unicidad insensible a mayusculas.
--
-- Un UNIQUE normal dejaria coexistir 'Pedro' y 'pedro', que para una persona
-- son el mismo @ y para la base son dos. Es el vector clasico de suplantacion.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX IF NOT EXISTS profiles_username_lower_key
  ON public.profiles (lower(username));

-- ---------------------------------------------------------------------------
-- 4. GRANT en la MISMA migracion que crea la columna.
--
-- Regla dura de este repo, con incidente propio: profiles otorga privilegios
-- COLUMNA POR COLUMNA, asi que una columna nueva nace sin ninguno. Sin el
-- GRANT SELECT, cualquier consulta que incluya username muere entera con
-- 42501 — no la columna, la consulta entera.
--
-- anon la lee porque el @ ya es publico hoy (user_id esta entre las 28
-- columnas que anon puede leer).
--
-- NO se otorga UPDATE a nadie: se escribe solo por el RPC de abajo, igual que
-- el resto del perfil. authenticated conserva UPDATE unicamente en foto y
-- fcm_token.
-- ---------------------------------------------------------------------------

GRANT SELECT (username) ON public.profiles TO anon, authenticated;
GRANT INSERT (username) ON public.profiles TO authenticated;

-- ---------------------------------------------------------------------------
-- 5. Las altas nuevas nacen con su @.
--
-- Se extiende generate_user_id en vez de anadir un segundo trigger: dos
-- triggers BEFORE INSERT sobre la misma tabla se ordenan alfabeticamente por
-- nombre, y hacer que la correccion dependa de eso es fragil de leer y facil
-- de romper al renombrar.
--
-- La condicion del trigger tambien cambia: antes solo disparaba cuando
-- user_id venia NULL. Si alguien insertara con user_id explicito y sin
-- username, la fila violaria el NOT NULL de arriba.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.generate_user_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  new_id TEXT;
  exists_already BOOLEAN;
BEGIN
  IF NEW.user_id IS NULL THEN
    LOOP
      new_id := 'U' || LPAD(FLOOR(RANDOM() * 10000000)::TEXT, 7, '0');
      SELECT EXISTS(SELECT 1 FROM profiles WHERE user_id = new_id) INTO exists_already;
      EXIT WHEN NOT exists_already;
    END LOOP;
    NEW.user_id := new_id;
  END IF;

  -- El @ inicial es el mismo codigo. La persona lo cambia cuando quiera.
  IF NEW.username IS NULL THEN
    NEW.username := NEW.user_id;
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS set_user_id ON public.profiles;
CREATE TRIGGER set_user_id
  BEFORE INSERT ON public.profiles
  FOR EACH ROW
  WHEN (new.user_id IS NULL OR new.username IS NULL)
  EXECUTE FUNCTION generate_user_id();

-- VERIFY:
--   SELECT count(*) FROM profiles WHERE username IS NULL;          -- 0
--   SELECT count(*) FROM profiles WHERE username <> user_id;       -- 0 al aplicar
--   SELECT count(*) FROM information_schema.column_privileges
--    WHERE table_name='profiles' AND column_name='username';       -- 3
