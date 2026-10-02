import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

async function main() {
const db = new PGlite();
try {
  await db.exec(`CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role;
    CREATE SCHEMA auth; CREATE TABLE auth.users(email text, deleted_at timestamptz);
    INSERT INTO auth.users VALUES ('existing@example.com',NULL),('removed@example.com',now());`);
  await db.exec(await readFile(new URL("../supabase/migrations/20261002051000_registration_email_exists.sql", import.meta.url), "utf8"));
  for (const role of ["anon", "authenticated"]) {
    await db.exec(`SET ROLE ${role}`);
    await assert.rejects(db.query("SELECT public.registration_email_exists('existing@example.com')"), /permission denied/);
    await db.exec("RESET ROLE");
  }
  await db.exec("SET ROLE service_role");
  for (const [email, expected] of [["existing@example.com", true], [" EXISTING@example.com ", true], ["new@example.com", false], ["removed@example.com", false], ["x' OR true --", false]] as const) {
    const result = await db.query<{ exists: boolean }>("SELECT public.registration_email_exists($1) AS exists", [email]);
    assert.equal(result.rows[0]?.exists, expected);
  }
  await assert.rejects(db.query("SELECT * FROM auth.users"), /permission denied/);
  await db.exec("RESET ROLE");
  await db.exec(`CREATE FUNCTION public.search_map_publications_v1(jsonb) RETURNS integer LANGUAGE sql AS $$ SELECT 1 $$;
    CREATE FUNCTION public.search_map_publications_v2(jsonb) RETURNS integer LANGUAGE sql AS $$ SELECT 2 $$;
    GRANT EXECUTE ON FUNCTION public.search_map_publications_v1(jsonb),public.search_map_publications_v2(jsonb) TO anon,authenticated;`);
  await db.exec(await readFile(new URL("../supabase/migrations/20261002063000_guest_map_permissions.sql", import.meta.url), "utf8"));
  for (const role of ["anon", "authenticated", "service_role"]) {
    await db.exec(`SET ROLE ${role}`);
    for (const version of [1, 2]) {
      if (role === "anon") await assert.rejects(db.query(`SELECT public.search_map_publications_v${version}('{}')`), /permission denied/);
      else assert.equal((await db.query<{ value: number }>(`SELECT public.search_map_publications_v${version}('{}') AS value`)).rows[0]?.value, version);
    }
    await db.exec("RESET ROLE");
  }
  console.log("PASA 14/14 SQL real PGlite: lookup restringido, normalización, mapa anon denegado y authenticated/service conservados. No acredita migración remota.");
} finally { await db.close(); }

}
main().catch(error => { console.error(error); process.exitCode = 1; });
