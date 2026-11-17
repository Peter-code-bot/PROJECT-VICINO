import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, espia, sentryEspia } from "../../../lib/pruebas/cargar-real";

type Acciones = typeof import("./actions");

const ADMIN = "00000000-0000-4000-8000-00000000000d";
const NEGOCIO = "00000000-0000-4000-8000-00000000000a";
const CANAL = "33333333-3333-4333-8333-333333333333";

interface Opciones {
  /** null = requireAdmin lanza (sin sesion o sin rol). */
  admin?: boolean;
  permitir?: boolean;
  perfil?: { id: string; es_vendedor: boolean; nombre_negocio: string | null; username: string } | null;
  errorPerfil?: { code?: string; message?: string };
  rpc?: Record<string, { data?: unknown; error?: { code?: string; message?: string } }>;
}

async function cargar(o: Opciones = {}) {
  const llamadas: Array<{ name: string; args: unknown }> = [];
  const busquedas: Array<{ operador: string; columna: string; valor: string }> = [];
  const revalidadas = espia<[string]>();
  const sentry = sentryEspia();

  const supabase = {
    from: () => ({
      select: () => {
        const terminal = { maybeSingle: async () => ({ data: o.perfil === undefined ? { id: NEGOCIO, es_vendedor: true, nombre_negocio: "Panaderia Ana", username: "Panaderia_Ana" } : o.perfil, error: o.errorPerfil ?? null }) };
        return {
          ilike: (columna: string, valor: string) => {
            busquedas.push({ operador: "ilike", columna, valor });
            return terminal;
          },
          eq: (columna: string, valor: string) => {
            busquedas.push({ operador: "eq", columna, valor });
            return terminal;
          },
        };
      },
    }),
    rpc: async (name: string, args: unknown) => {
      llamadas.push({ name, args });
      const r = o.rpc?.[name];
      return { data: r && "data" in r ? r.data : null, error: r?.error ?? null };
    },
  };

  const acciones = await cargarReal<Acciones>("app/admin/whatsapp/actions.ts", {
    stubs: {
      "@/lib/auth/require-admin": {
        requireAdmin: async () => {
          if (o.admin === false) throw new Error("Forbidden");
          return { supabase, user: { id: ADMIN } };
        },
      },
      "@/lib/rate-limit": {
        writeRateLimit: null,
        enforce: async () => (o.permitir === false ? { ok: false, error: "Demasiadas solicitudes." } : { ok: true }),
      },
      "next/cache": { revalidatePath: revalidadas },
      "@sentry/nextjs": sentry,
    },
  });
  return { acciones, llamadas, busquedas, revalidadas, sentry };
}

const INICIAL = { ok: false, mensaje: null };
const form = (campos: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
};
const FORM_OK = { username: "@Panaderia_Ana", phone_number_id: "123456789012345", waba_id: "987654321098765", numero_mostrado: "+1 555 025 3483" };

test("sin rol admin ninguna accion llega a la base", async () => {
  const f = await cargar({ admin: false });
  assert.deepEqual(await f.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK)), { ok: false, mensaje: "Solo un administrador puede hacer esto." });
  assert.deepEqual(await f.acciones.cambiarEstadoCanalWhatsApp(CANAL, false), { ok: false, mensaje: "Solo un administrador puede hacer esto." });
  assert.deepEqual(await f.acciones.eliminarCanalWhatsApp(CANAL), { ok: false, mensaje: "Solo un administrador puede hacer esto." });
  assert.equal(f.llamadas.length, 0);
  assert.equal(f.busquedas.length, 0);
});

test("con el freno cerrado se devuelve el mensaje del freno", async () => {
  const f = await cargar({ permitir: false });
  assert.deepEqual(await f.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK)), { ok: false, mensaje: "Demasiadas solicitudes." });
  assert.equal(f.llamadas.length, 0);
});

test("los datos del formulario se validan antes de buscar nada: ids con letras, usuario raro, numero mostrado largo", async () => {
  const f = await cargar();
  const casos: Array<[Record<string, string>, RegExp]> = [
    [{ ...FORM_OK, phone_number_id: "abc" }, /Phone number ID/],
    [{ ...FORM_OK, waba_id: "12 34" }, /Business Account ID/],
    [{ ...FORM_OK, username: "ana maria" }, /usuario/],
    [{ ...FORM_OK, username: "" }, /usuario/],
    [{ ...FORM_OK, numero_mostrado: "x".repeat(25) }, /demasiado largo/],
  ];
  for (const [campos, re] of casos) {
    const r = await f.acciones.conectarCanalWhatsApp(INICIAL, form(campos));
    assert.equal(r.ok, false);
    assert.match(r.mensaje ?? "", re);
  }
  assert.equal(f.busquedas.length, 0);
  assert.equal(f.llamadas.length, 0);
});

test("el usuario se busca sin distinguir mayusculas, sin el @ y con el guion bajo escapado para ilike", async () => {
  const f = await cargar();
  const r = await f.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK));
  assert.deepEqual(r, { ok: true, mensaje: "Número conectado a Panaderia Ana." });
  assert.deepEqual(f.busquedas, [{ operador: "ilike", columna: "username", valor: "Panaderia\\_Ana" }]);
  assert.deepEqual(f.llamadas, [
    {
      name: "conectar_canal_whatsapp",
      args: { p_negocio_id: NEGOCIO, p_phone_number_id: "123456789012345", p_waba_id: "987654321098765", p_numero_mostrado: "+1 555 025 3483" },
    },
  ]);
  assert.deepEqual(f.revalidadas.llamadas, [["/admin/whatsapp"]]);
});

test("perfil inexistente, perfil sin modo vendedor y error al buscar", async () => {
  const noExiste = await cargar({ perfil: null });
  assert.deepEqual(await noExiste.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK)), { ok: false, mensaje: "No hay ningún perfil con el usuario @Panaderia_Ana." });
  assert.equal(noExiste.llamadas.length, 0);

  const noVende = await cargar({ perfil: { id: NEGOCIO, es_vendedor: false, nombre_negocio: null, username: "carla" } });
  assert.deepEqual(await noVende.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK)), { ok: false, mensaje: "Ese perfil no tiene el modo vendedor activo." });

  const falla = await cargar({ errorPerfil: { code: "57P01", message: "caida" } });
  const r = await falla.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK));
  assert.deepEqual(r, { ok: false, mensaje: "No se pudo completar. Intenta de nuevo." });
  assert.equal(falla.sentry.captureException.llamadas.length, 1);
});

test("los errores del RPC: el 23505 nuestro se muestra tal cual; un 23505 nativo de Postgres no; 42501 y otros tienen su texto", async () => {
  const propio = await cargar({ rpc: { conectar_canal_whatsapp: { error: { code: "23505", message: "Ese número ya está conectado a otro negocio." } } } });
  assert.deepEqual(await propio.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK)), { ok: false, mensaje: "Ese número ya está conectado a otro negocio." });
  assert.equal(propio.sentry.captureException.llamadas.length, 0);

  const nativo = await cargar({ rpc: { conectar_canal_whatsapp: { error: { code: "23505", message: 'duplicate key value violates unique constraint "canales_whatsapp_negocio_id_key"' } } } });
  assert.deepEqual(await nativo.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK)), { ok: false, mensaje: "No se pudo completar. Intenta de nuevo." });
  assert.equal(nativo.sentry.captureException.llamadas.length, 1);

  const sinRol = await cargar({ rpc: { conectar_canal_whatsapp: { error: { code: "42501", message: "Solo un administrador puede conectar números." } } } });
  assert.deepEqual(await sinRol.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK)), { ok: false, mensaje: "Solo un administrador puede hacer esto." });

  const validacion = await cargar({ rpc: { conectar_canal_whatsapp: { error: { code: "22023", message: "Ese perfil no existe o no tiene el modo vendedor activo." } } } });
  assert.deepEqual(await validacion.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK)), { ok: false, mensaje: "Ese perfil no existe o no tiene el modo vendedor activo." });
});

test("si el negocio no tiene nombre se nombra por su @ tal cual esta guardado", async () => {
  const f = await cargar({ perfil: { id: NEGOCIO, es_vendedor: true, nombre_negocio: null, username: "Panaderia_Ana" } });
  assert.deepEqual(await f.acciones.conectarCanalWhatsApp(INICIAL, form(FORM_OK)), { ok: true, mensaje: "Número conectado a @Panaderia_Ana." });
});

test("pausar y reactivar: uuid invalido o 'activo' que no es booleano no llegan a la base; false del RPC = no encontrado", async () => {
  const f = await cargar({ rpc: { cambiar_estado_canal_whatsapp: { data: true } } });
  assert.deepEqual(await f.acciones.cambiarEstadoCanalWhatsApp("no-es-uuid", false), { ok: false, mensaje: "Datos inválidos." });
  assert.deepEqual(await f.acciones.cambiarEstadoCanalWhatsApp(CANAL, "si" as unknown as boolean), { ok: false, mensaje: "Datos inválidos." });
  assert.equal(f.llamadas.length, 0);

  const pausa = await f.acciones.cambiarEstadoCanalWhatsApp(CANAL, false);
  assert.equal(pausa.ok, true);
  assert.match(pausa.mensaje ?? "", /se sigue guardando/);
  assert.deepEqual(f.llamadas[0], { name: "cambiar_estado_canal_whatsapp", args: { p_canal_id: CANAL, p_activo: false } });

  const noEncontrado = await cargar({ rpc: { cambiar_estado_canal_whatsapp: { data: false } } });
  assert.deepEqual(await noEncontrado.acciones.cambiarEstadoCanalWhatsApp(CANAL, true), { ok: false, mensaje: "No se encontró ese número." });
});

test("desconectar: llama al RPC con el uuid y revalida; false = no encontrado", async () => {
  const f = await cargar({ rpc: { eliminar_canal_whatsapp: { data: true } } });
  const r = await f.acciones.eliminarCanalWhatsApp(CANAL);
  assert.equal(r.ok, true);
  assert.match(r.mensaje ?? "", /se borraron/);
  assert.deepEqual(f.llamadas, [{ name: "eliminar_canal_whatsapp", args: { p_canal_id: CANAL } }]);
  assert.deepEqual(f.revalidadas.llamadas, [["/admin/whatsapp"]]);

  const noEncontrado = await cargar({ rpc: { eliminar_canal_whatsapp: { data: false } } });
  assert.deepEqual(await noEncontrado.acciones.eliminarCanalWhatsApp(CANAL), { ok: false, mensaje: "No se encontró ese número." });
  assert.deepEqual(await noEncontrado.acciones.eliminarCanalWhatsApp("x"), { ok: false, mensaje: "Datos inválidos." });
});
