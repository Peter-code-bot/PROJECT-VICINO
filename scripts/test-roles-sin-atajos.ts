// PostgreSQL en WASM, sin red, cuentas ni claves reales.
//
// Comprueba las dos migraciones del 18-nov-2026 sobre roles:
//   20261118120000: las dos funciones viejas que cambiaban roles con solo
//     tener una sesion de admin (manage_user_role y make_admin) ya no se pueden
//     llamar desde un cliente, asi que el unico camino es la Server Action que
//     exige la clave del panel.
//   20261118130000: ese camino (admin_set_user_role_secure, canal de servicio)
//     vuelve a funcionar. Con el has_role de produccion rechazaba al admin
//     real, porque en el canal de servicio no hay sesion.
// Las funciones se crean aqui tal como estan en produccion (pg_get_functiondef
// y ACL leidos el 18-nov-2026, solo lectura).
//
//   pnpm exec tsx scripts/test-roles-sin-atajos.ts
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const root = fileURLToPath(new URL("../", import.meta.url));
const ARCHIVO = "supabase/migrations/20261118120000_roles_solo_con_clave_del_panel.sql";
const ARCHIVO_CANAL = "supabase/migrations/20261118130000_canal_de_roles_sin_has_role.sql";
// La version de octubre de admin_set_user_role_secure, la que hoy esta en produccion.
const ARCHIVO_OCTUBRE = "supabase/migrations/20261011213000_admin_roles_solo_servidor.sql";
const SEGURA = "public.admin_set_user_role_secure(uuid, uuid, public.app_role, boolean)";
const admin = "00000000-0000-4000-8000-000000000001";
const otro = "00000000-0000-4000-8000-000000000002";
const FUNCIONES = [
  "public.manage_user_role(uuid, public.app_role, text)",
  "public.make_admin(text)",
] as const;

let checks = 0;
async function check(nombre: string, fn: () => Promise<void>) {
  await fn();
  checks++;
  console.log(`PASS ${nombre}`);
}

const ESQUEMA = `
  CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
  CREATE SCHEMA auth;
  GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role;
  CREATE TABLE auth.users (id uuid PRIMARY KEY);
  CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
    AS $$SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
  CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE
    AS $$SELECT nullif(current_setting('request.jwt.claim.role', true), '')$$;
  GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
  CREATE TYPE public.app_role AS ENUM ('admin', 'moderator', 'user');
  CREATE TABLE public.profiles (id uuid PRIMARY KEY REFERENCES auth.users(id), email text NOT NULL);
  CREATE TABLE public.user_roles (
    user_id uuid NOT NULL REFERENCES auth.users(id),
    role public.app_role NOT NULL,
    UNIQUE (user_id, role)
  );

  CREATE FUNCTION public.has_role(_user_id uuid, _role app_role)
   RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
   SET search_path TO 'public', 'pg_temp'
  AS $function$
  BEGIN
    IF _user_id IS DISTINCT FROM (SELECT auth.uid())
       AND NOT EXISTS (
         SELECT 1 FROM user_roles
         WHERE user_id = (SELECT auth.uid()) AND role = 'admin'::app_role
       )
    THEN
      RETURN false;
    END IF;
    RETURN EXISTS (SELECT 1 FROM user_roles WHERE user_id = _user_id AND role = _role);
  END;
  $function$;

  CREATE FUNCTION public.make_admin(p_email text)
   RETURNS void LANGUAGE plpgsql SECURITY DEFINER
   SET search_path TO 'public', 'pg_temp'
  AS $function$
  DECLARE
    v_target uuid;
  BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
      RAISE EXCEPTION 'forbidden: solo un admin puede asignar admin';
    END IF;
    SELECT id INTO v_target FROM public.profiles WHERE email = p_email;
    IF v_target IS NULL THEN
      RAISE EXCEPTION 'usuario no encontrado: %', p_email;
    END IF;
    INSERT INTO public.user_roles (user_id, role)
    VALUES (v_target, 'admin'::app_role)
    ON CONFLICT DO NOTHING;
  END;
  $function$;

  CREATE FUNCTION public.manage_user_role(p_user_id uuid, p_role app_role, p_action text)
   RETURNS void LANGUAGE plpgsql SECURITY DEFINER
   SET search_path TO 'public', 'pg_temp'
  AS $function$
  DECLARE
    v_admin_count int;
  BEGIN
    IF (SELECT auth.uid()) IS NULL
       OR NOT public.has_role((SELECT auth.uid()), 'admin'::app_role) THEN
      RAISE EXCEPTION 'forbidden: solo un admin puede gestionar roles';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = p_user_id) THEN
      RAISE EXCEPTION 'usuario no encontrado: %', p_user_id;
    END IF;
    IF p_action = 'assign' THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (p_user_id, p_role)
      ON CONFLICT DO NOTHING;
    ELSIF p_action = 'remove' THEN
      IF p_role = 'admin'::app_role THEN
        PERFORM 1 FROM public.user_roles WHERE role='admin'::app_role FOR UPDATE;
        SELECT count(*) INTO v_admin_count FROM public.user_roles WHERE role='admin'::app_role;
        IF v_admin_count <= 1 THEN
          RAISE EXCEPTION 'no se puede remover el ultimo admin';
        END IF;
      END IF;
      DELETE FROM public.user_roles WHERE user_id = p_user_id AND role = p_role;
    ELSE
      RAISE EXCEPTION 'accion invalida: % (usa assign o remove)', p_action;
    END IF;
  END;
  $function$;

  -- ACL de produccion: sin PUBLIC; authenticated y service_role con EXECUTE.
  REVOKE ALL ON FUNCTION public.make_admin(text) FROM PUBLIC;
  REVOKE ALL ON FUNCTION public.manage_user_role(uuid, app_role, text) FROM PUBLIC;
  GRANT EXECUTE ON FUNCTION public.make_admin(text) TO authenticated, service_role;
  GRANT EXECUTE ON FUNCTION public.manage_user_role(uuid, app_role, text) TO authenticated, service_role;

  INSERT INTO auth.users VALUES ('${admin}'), ('${otro}');
  INSERT INTO public.profiles VALUES ('${admin}', 'admin@ejemplo.mx'), ('${otro}', 'otro@ejemplo.mx');
  INSERT INTO public.user_roles VALUES ('${admin}', 'admin');
`;

async function main() {
  const db = new PGlite();
  const migracion = await readFile(path.join(root, ARCHIVO), "utf8");

  /** Corre `fn` como `authenticated` con la sesion de `sub`, como lo haria PostgREST. */
  async function conSesion(sub: string, fn: () => Promise<unknown>) {
    await db.query("SELECT set_config('request.jwt.claim.sub', $1, false)", [sub]);
    await db.exec("SET ROLE authenticated");
    try {
      await fn();
    } finally {
      await db.exec("RESET ROLE");
      await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
    }
  }

  async function rolesDe(id: string): Promise<string[]> {
    const { rows } = await db.query<{ role: string }>(
      "SELECT role::text AS role FROM public.user_roles WHERE user_id = $1 ORDER BY role",
      [id],
    );
    return rows.map((fila) => fila.role);
  }

  async function puede(rol: string, funcion: string): Promise<boolean> {
    const { rows } = await db.query<{ puede: boolean }>(
      "SELECT has_function_privilege($1, $2, 'EXECUTE') AS puede",
      [rol, funcion],
    );
    return rows[0]?.puede === true;
  }

  try {
    await db.exec(ESQUEMA);

    await check("antes de la migracion, una sesion de admin cambiaba roles sin la clave", async () => {
      await conSesion(admin, () => db.query("SELECT public.manage_user_role($1, 'moderator', 'assign')", [otro]));
      assert.deepEqual(await rolesDe(otro), ["moderator"]);
      await conSesion(admin, () => db.query("SELECT public.make_admin('otro@ejemplo.mx')"));
      assert.deepEqual(await rolesDe(otro), ["admin", "moderator"]);
      await conSesion(admin, () => db.query("SELECT public.manage_user_role($1, 'admin', 'remove')", [otro]));
      assert.deepEqual(await rolesDe(otro), ["moderator"]);
      await db.query("DELETE FROM public.user_roles WHERE user_id = $1", [otro]);
    });

    await db.exec(migracion);

    await check("anon y authenticated ya no tienen EXECUTE sobre ninguna de las dos", async () => {
      for (const rol of ["anon", "authenticated"]) {
        for (const funcion of FUNCIONES) {
          assert.equal(await puede(rol, funcion), false, `${rol} sobre ${funcion}`);
        }
      }
    });

    await check("una sesion de admin ya no concede, quita ni hace admin: 42501 y sin cambios", async () => {
      await db.query("INSERT INTO public.user_roles VALUES ($1, 'moderator')", [otro]);
      const intentos = [
        "SELECT public.manage_user_role('" + otro + "', 'admin', 'assign')",
        "SELECT public.manage_user_role('" + otro + "', 'moderator', 'remove')",
        "SELECT public.make_admin('otro@ejemplo.mx')",
      ];
      for (const sql of intentos) {
        await assert.rejects(
          () => conSesion(admin, () => db.query(sql)),
          (error: { code?: string }) => error.code === "42501",
          sql,
        );
      }
      assert.deepEqual(await rolesDe(otro), ["moderator"], "el intento no dejo rastro");
      assert.deepEqual(await rolesDe(admin), ["admin"]);
      await db.query("DELETE FROM public.user_roles WHERE user_id = $1", [otro]);
    });

    await check("service_role conserva EXECUTE (aunque sin sesion de admin no le sirve)", async () => {
      for (const funcion of FUNCIONES) {
        assert.equal(await puede("service_role", funcion), true, funcion);
      }
    });

    await check("la migracion es reaplicable y deja el mismo contrato", async () => {
      await db.exec(migracion);
      for (const funcion of FUNCIONES) {
        assert.equal(await puede("authenticated", funcion), false, funcion);
        assert.equal(await puede("service_role", funcion), true, funcion);
      }
    });

    await check("la verificacion de la migracion falla si alguien devuelve el EXECUTE", async () => {
      const verificacion = migracion.match(/DO \$verify\$[\s\S]*?\$verify\$;/);
      assert.ok(verificacion, "la migracion trae su bloque de verificacion");
      await db.exec("GRANT EXECUTE ON FUNCTION public.make_admin(text) TO authenticated");
      await assert.rejects(() => db.exec(verificacion[0]), /authenticated conserva EXECUTE/);
      await db.exec("REVOKE EXECUTE ON FUNCTION public.make_admin(text) FROM authenticated");
      await db.exec(verificacion[0]);
    });

    await check("en una base sin manage_user_role (armada desde el repo) la migracion aplica igual", async () => {
      const limpia = new PGlite();
      try {
        await limpia.exec(ESQUEMA.replace(/CREATE FUNCTION public\.manage_user_role[\s\S]*?\$function\$;/, "")
          .replace(/^.*manage_user_role.*$/gm, ""));
        const { rows } = await limpia.query<{ existe: boolean }>(
          "SELECT to_regprocedure('public.manage_user_role(uuid, public.app_role, text)') IS NOT NULL AS existe",
        );
        assert.equal(rows[0]?.existe, false, "el escenario no tiene la funcion");
        await limpia.exec(migracion);
        const { rows: despues } = await limpia.query<{ puede: boolean }>(
          "SELECT has_function_privilege('authenticated', 'public.make_admin(text)', 'EXECUTE') AS puede",
        );
        assert.equal(despues[0]?.puede, false, "make_admin queda cerrada aunque falte la otra");
      } finally {
        await limpia.close();
      }
    });

    // --- 20261118130000: el canal del servidor ---------------------------------

    const octubre = (await readFile(path.join(root, ARCHIVO_OCTUBRE), "utf8")).match(
      /CREATE OR REPLACE FUNCTION public\.admin_set_user_role_secure[\s\S]*?\$function\$;/,
    );
    assert.ok(octubre, "la migracion de octubre trae la funcion segura");
    const canal = await readFile(path.join(root, ARCHIVO_CANAL), "utf8");

    /** Como la llama la Server Action: cliente de servicio, sin sesion de usuario. */
    async function porElCanal(actor: string | null, cuenta: string, rol: string, conceder: boolean) {
      await db.query("SELECT set_config('request.jwt.claim.role', 'service_role', false)");
      await db.query("SELECT set_config('request.jwt.claim.sub', '', false)");
      await db.exec("SET ROLE service_role");
      try {
        await db.query(`SELECT ${SEGURA.replace(/\(.*$/, "")}($1, $2, $3::public.app_role, $4)`, [actor, cuenta, rol, conceder]);
      } finally {
        await db.exec("RESET ROLE");
        await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
      }
    }
    const con = (codigo: string, texto?: RegExp) => (error: { code?: string; message?: string }) =>
      error.code === codigo && (!texto || texto.test(error.message ?? ""));

    await check("con la version de octubre (la de produccion) el canal rechaza al admin real", async () => {
      await db.exec(octubre[0]);
      await db.exec(`REVOKE ALL ON FUNCTION ${SEGURA} FROM PUBLIC; GRANT EXECUTE ON FUNCTION ${SEGURA} TO service_role;`);
      await assert.rejects(() => porElCanal(admin, otro, "moderator", true), con("42501", /solo un admin/));
      assert.deepEqual(await rolesDe(otro), []);
    });

    await db.exec(canal);

    await check("con el arreglo, el canal concede y quita Moderador", async () => {
      await porElCanal(admin, otro, "moderator", true);
      await porElCanal(admin, otro, "moderator", true);
      assert.deepEqual(await rolesDe(otro), ["moderator"], "conceder dos veces deja una sola fila");
      await porElCanal(admin, otro, "moderator", false);
      assert.deepEqual(await rolesDe(otro), []);
    });

    await check("con el arreglo, el canal concede y quita Admin a otra cuenta", async () => {
      await porElCanal(admin, otro, "admin", true);
      assert.deepEqual(await rolesDe(otro), ["admin"]);
      await porElCanal(admin, otro, "admin", false);
      assert.deepEqual(await rolesDe(otro), []);
    });

    await check("un actor que no es admin no reparte roles", async () => {
      await assert.rejects(() => porElCanal(otro, admin, "moderator", true), con("42501", /solo un admin/));
      assert.deepEqual(await rolesDe(admin), ["admin"]);
    });

    await check("nadie se quita a si mismo el admin", async () => {
      await assert.rejects(() => porElCanal(admin, admin, "admin", false), con("22023"));
      assert.deepEqual(await rolesDe(admin), ["admin"]);
    });

    await check("datos nulos o un rol que no se reparte se rechazan antes de tocar nada", async () => {
      await assert.rejects(() => porElCanal(null, otro, "moderator", true), con("22023"));
      await assert.rejects(() => porElCanal(admin, otro, "user", true), con("22023"));
      assert.deepEqual(await rolesDe(otro), []);
    });

    await check("fuera del canal de servicio la funcion no se puede usar", async () => {
      assert.equal(await puede("authenticated", SEGURA), false);
      assert.equal(await puede("anon", SEGURA), false);
      await assert.rejects(
        () => conSesion(admin, () => db.query(`SELECT ${SEGURA.replace(/\(.*$/, "")}($1, $2, 'moderator', true)`, [admin, otro])),
        con("42501"),
      );
      await db.query("SELECT set_config('request.jwt.claim.role', 'authenticated', false)");
      await assert.rejects(
        () => db.query(`SELECT ${SEGURA.replace(/\(.*$/, "")}($1, $2, 'moderator', true)`, [admin, otro]),
        con("42501", /canal de servidor/),
      );
      await db.query("SELECT set_config('request.jwt.claim.role', '', false)");
      assert.deepEqual(await rolesDe(otro), []);
    });

    await check("la migracion del canal es reaplicable y su verificacion detecta has_role", async () => {
      await db.exec(canal);
      const verificacion = canal.match(/DO \$verify\$[\s\S]*?\$verify\$;/);
      assert.ok(verificacion, "la migracion del canal trae su verificacion");
      await db.exec(octubre[0]);
      await assert.rejects(() => db.exec(verificacion[0]), /todavia comprueba al actor con has_role/);
      await db.exec(canal);
      await porElCanal(admin, otro, "moderator", true);
      await porElCanal(admin, otro, "moderator", false);
      assert.deepEqual(await rolesDe(otro), []);
    });
  } finally {
    await db.close();
  }
  console.log(`PASS ${checks}/${checks} roles: sin atajos para las sesiones y con el canal del servidor funcionando.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
