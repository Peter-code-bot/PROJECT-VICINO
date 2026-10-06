/**
 * La puerta de las acciones de moderacion (app/admin/moderation/actions.ts).
 *
 * Pedia los roles con `.in("role", ["admin", "moderator"]).single()`. Quien
 * tiene LOS DOS roles saca dos filas, PostgREST contesta 406 PGRST116 y `data`
 * llega null: se le negaba la moderacion a un admin legitimo. Hallado de paso
 * al inventariar los `.single()` del reporte de Sentry del 3-oct.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal } from "../pruebas/cargar-real";
import { crearSupabaseFalso, type Fila } from "../pruebas/supabase-falso";

type Puerta = typeof import("./require-admin-or-moderator");

async function puerta(roles: Fila[], usuario: { id: string } | null = { id: "admin-1" }) {
  const { cliente } = crearSupabaseFalso({ usuario, tablas: { user_roles: roles } });
  const modulo = await cargarReal<Puerta>("lib/auth/require-admin-or-moderator.ts", {
    stubs: { "@/lib/supabase/server": { createClient: async () => cliente } },
  });
  return modulo.requireAdminOrModerator();
}

test("con admin Y moderator a la vez deja pasar", async () => {
  const ctx = await puerta([{ role: "admin" }, { role: "moderator" }]);
  assert.equal(ctx?.user.id, "admin-1");
});

test("con un solo rol deja pasar", async () => {
  assert.ok(await puerta([{ role: "moderator" }]));
});

test("sin ninguno de los dos roles no deja pasar", async () => {
  assert.equal(await puerta([]), null);
});

test("sin sesion no deja pasar", async () => {
  assert.equal(await puerta([{ role: "admin" }], null), null);
});
