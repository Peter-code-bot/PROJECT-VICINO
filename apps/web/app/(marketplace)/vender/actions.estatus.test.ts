import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, sentryEspia } from "../../../lib/pruebas/cargar-real";

// toggleProductStatus con el Modo Vendedor apagado. Desactivarlo pausa las
// publicaciones (update_profile_and_pause_products) y el aviso promete que no
// se vuelve a publicar hasta reactivarlo. Volver a MOSTRAR una pausada desde
// el menu de la ficha era la puerta de atras: la accion no miraba el perfil.
// Pausar sigue permitido siempre.

type Acciones = typeof import("./actions");
const UID = "00000000-0000-4000-8000-000000000001";
const PID = "00000000-0000-4000-8000-0000000000aa";

type Filtro = [operador: "eq" | "neq", columna: string, valor: unknown];
interface Consulta {
  tabla: string;
  operacion: "select" | "update";
  valores?: unknown;
  filtros: Filtro[];
}

async function cargar(perfil: { es_vendedor: boolean } | null, opciones: { errorPerfil?: boolean } = {}) {
  const consultas: Consulta[] = [];
  const revalidadas: string[] = [];
  const cliente = {
    auth: { getUser: async () => ({ data: { user: { id: UID } } }) },
    from(tabla: string) {
      const consulta: Consulta = { tabla, operacion: "select", filtros: [] };
      consultas.push(consulta);
      const cadena = {
        select: () => cadena,
        update: (valores: unknown) => {
          consulta.operacion = "update";
          consulta.valores = valores;
          return cadena;
        },
        eq: (columna: string, valor: unknown) => {
          consulta.filtros.push(["eq", columna, valor]);
          return cadena;
        },
        neq: (columna: string, valor: unknown) => {
          consulta.filtros.push(["neq", columna, valor]);
          return cadena;
        },
        maybeSingle: async () => {
          if (tabla !== "profiles") return { data: { id: PID }, error: null };
          return opciones.errorPerfil
            ? { data: null, error: { code: "08006", message: "conexion perdida" } }
            : { data: perfil, error: null };
        },
      };
      return cadena;
    },
  };
  const sentry = sentryEspia();
  const acciones = await cargarReal<Acciones>("app/(marketplace)/vender/actions.ts", {
    stubs: {
      "@/lib/supabase/server": { createClient: async () => cliente },
      "@/lib/rate-limit": { writeRateLimit: null, enforce: async () => ({ ok: true }) },
      "@/lib/revalidate-session": {
        revalidatePath: async (ruta: string) => {
          revalidadas.push(ruta);
        },
      },
      "next/navigation": {
        redirect: (url: string) => {
          throw new Error(`redirect:${url}`);
        },
        RedirectType: { replace: "replace", push: "push" },
      },
      "@sentry/nextjs": sentry,
    },
  });
  return { acciones, consultas, revalidadas, sentry };
}

const escrituras = (consultas: Consulta[]) => consultas.filter((c) => c.operacion === "update");
const lecturasDePerfil = (consultas: Consulta[]) => consultas.filter((c) => c.tabla === "profiles");

test("sin Modo Vendedor no se vuelve a mostrar una publicacion pausada y no se escribe nada", async () => {
  const f = await cargar({ es_vendedor: false });
  const r = await f.acciones.toggleProductStatus(PID, "disponible");
  assert.deepEqual(r, { error: "Activa Modo Vendedor para volver a mostrar tus publicaciones." });
  assert.equal(escrituras(f.consultas).length, 0);
  assert.deepEqual(f.revalidadas, []);
  assert.deepEqual(lecturasDePerfil(f.consultas)[0]?.filtros, [["eq", "id", UID]]);
});

test("un perfil que no se ve cuenta como Modo Vendedor apagado", async () => {
  const f = await cargar(null);
  const r = await f.acciones.toggleProductStatus(PID, "disponible");
  assert.deepEqual(r, { error: "Activa Modo Vendedor para volver a mostrar tus publicaciones." });
  assert.equal(escrituras(f.consultas).length, 0);
});

test("si no se puede leer el perfil no se cambia nada, se avisa y se reporta", async () => {
  const f = await cargar({ es_vendedor: true }, { errorPerfil: true });
  const r = await f.acciones.toggleProductStatus(PID, "disponible");
  assert.deepEqual(r, { error: "No pudimos comprobar tu Modo Vendedor. Intenta de nuevo." });
  assert.equal(escrituras(f.consultas).length, 0);
  assert.equal(f.sentry.captureException.llamadas.length, 1);
});

test("con Modo Vendedor se muestra como siempre: solo la propia y nunca una eliminada", async () => {
  const f = await cargar({ es_vendedor: true });
  const r = await f.acciones.toggleProductStatus(PID, "disponible");
  assert.deepEqual(r, { success: true });
  const [escritura] = escrituras(f.consultas);
  assert.deepEqual(escritura?.valores, { estatus: "disponible" });
  assert.deepEqual(escritura?.filtros, [
    ["eq", "id", PID],
    ["eq", "creador_id", UID],
    ["neq", "estatus", "eliminado"],
  ]);
  assert.ok(f.revalidadas.includes("/seller/listings"));
});

test("pausar no exige Modo Vendedor ni lee el perfil", async () => {
  const f = await cargar({ es_vendedor: false });
  const r = await f.acciones.toggleProductStatus(PID, "pausado");
  assert.deepEqual(r, { success: true });
  assert.equal(lecturasDePerfil(f.consultas).length, 0);
  assert.deepEqual(escrituras(f.consultas)[0]?.valores, { estatus: "pausado" });
});
