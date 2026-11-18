import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, sentryEspia } from "../../../lib/pruebas/cargar-real";

// El tramo de enlaces del negocio dentro de updateProfile: cuando se llama al
// segundo RPC, con que, y que pasa cuando falla. Lo demas de updateProfile ya
// existia y no se cubre aqui.

type Acciones = typeof import("./actions");
const UID = "00000000-0000-4000-8000-000000000001";

interface Llamada { name: string; args: Record<string, unknown> }

async function cargar(opciones: { errorEnlaces?: { code: string; message: string } } = {}) {
  const llamadas: Llamada[] = [];
  const revalidadas: string[] = [];
  const sentry = sentryEspia();
  const acciones = await cargarReal<Acciones>("app/(marketplace)/perfil/actions.ts", {
    stubs: {
      "@/lib/supabase/server": {
        createClient: async () => ({
          auth: { getUser: async () => ({ data: { user: { id: UID } } }) },
          rpc: async (name: string, args: Record<string, unknown>) => {
            llamadas.push({ name, args });
            if (name === "guardar_enlaces_negocio" && opciones.errorEnlaces) {
              return { data: null, error: opciones.errorEnlaces };
            }
            return { data: {}, error: null };
          },
        }),
      },
      "@/lib/rate-limit": { writeRateLimit: null, enforce: async () => ({ ok: true }) },
      "@/lib/revalidate-session": { revalidatePath: async (path: string) => { revalidadas.push(path); } },
      "next/headers": { cookies: async () => ({ get: () => undefined, delete: () => undefined }) },
      "@sentry/nextjs": sentry,
    },
  });
  return { acciones, llamadas, revalidadas, sentry };
}

function formulario(campos: Record<string, string>): FormData {
  const fd = new FormData();
  fd.set("nombre", "Ana");
  for (const [k, v] of Object.entries(campos)) fd.set(k, v);
  return fd;
}

const CON_ENLACES = {
  es_vendedor: "on",
  seller_type: "casual",
  instagram_usuario: "@Mi.Tienda",
  whatsapp_numero: "+52 (222) 123-4567",
  google_maps_url: "maps.app.goo.gl/AbC123",
  google_resenas_url: "",
};

test("formulario viejo (los cuatro de antes): primero el perfil, luego SOLO esos cuatro ya normalizados; vacio = null", async () => {
  const f = await cargar();
  const r = await f.acciones.updateProfile(formulario(CON_ENLACES));
  assert.deepEqual(r, { success: true });
  assert.deepEqual(f.llamadas.map((l) => l.name), ["update_profile_and_pause_products", "guardar_enlaces_negocio"]);
  // Sin las claves de las redes nuevas ni de Messenger: el RPC no las toca.
  assert.deepEqual(f.llamadas[1]?.args, {
    p_enlaces: {
      instagram_usuario: "mi.tienda",
      whatsapp_numero: "522221234567",
      google_maps_url: "https://maps.app.goo.gl/AbC123",
      google_resenas_url: null,
    },
  });
  assert.deepEqual(f.revalidadas, ["/"]);
});

test("un enlace mal escrito frena TODO antes de escribir: ni perfil ni enlaces", async () => {
  const f = await cargar();
  const r = await f.acciones.updateProfile(formulario({ ...CON_ENLACES, whatsapp_numero: "2221234567" }));
  assert.ok(r.error);
  assert.match(r.error ?? "", /lada/);
  assert.equal(f.llamadas.length, 0);
  assert.equal(f.revalidadas.length, 0);
});

test("un formulario viejo sin los campos de enlaces no llama al RPC de enlaces (no borra nada)", async () => {
  const f = await cargar();
  const r = await f.acciones.updateProfile(formulario({ es_vendedor: "on", seller_type: "casual" }));
  assert.deepEqual(r, { success: true });
  assert.deepEqual(f.llamadas.map((l) => l.name), ["update_profile_and_pause_products"]);
});

test("con el modo vendedor apagado y los campos presentes, los enlaces se QUITAN (cuatro omitidos = NULL)", async () => {
  const f = await cargar();
  // Sin es_vendedor=on; los campos siguen en el DOM colapsado con sus valores viejos.
  const r = await f.acciones.updateProfile(formulario({
    seller_type: "casual",
    instagram_usuario: "mi.tienda",
    whatsapp_numero: "522221234567",
    google_maps_url: "https://maps.app.goo.gl/AbC123",
    google_resenas_url: "https://g.page/r/CaBc/review",
  }));
  assert.deepEqual(r, { success: true });
  assert.deepEqual(f.llamadas.map((l) => l.name), ["update_profile_and_pause_products", "guardar_enlaces_negocio"]);
  // Se quitan TODOS, tambien las redes que este formulario viejo no trae.
  assert.deepEqual(f.llamadas[1]?.args, {
    p_enlaces: {
      instagram_usuario: null,
      whatsapp_numero: null,
      google_maps_url: null,
      google_resenas_url: null,
      facebook_ruta: null,
      tiktok_usuario: null,
      youtube_ruta: null,
      x_usuario: null,
      linkedin_ruta: null,
      threads_usuario: null,
      pinterest_usuario: null,
      telegram_usuario: null,
      facebook_messenger: false,
    },
  });
});

const CON_REDES = {
  ...CON_ENLACES,
  enlaces_formulario: "2",
  facebook_ruta: "facebook.com/MiTienda.Puebla?mibextid=abc",
  facebook_messenger: "on",
  tiktok_usuario: "https://www.tiktok.com/@mi.tienda?_t=xyz&_r=1",
  youtube_ruta: "youtube.com/@MiCanal?si=123",
  x_usuario: "twitter.com/MiTienda",
  linkedin_ruta: "mx.linkedin.com/company/Mi-Tienda/",
  threads_usuario: "threads.net/@Mi.Tienda",
  pinterest_usuario: "",
  telegram_usuario: "@MiTienda_Pue",
};

test("formulario nuevo: manda las trece claves normalizadas y Messenger encendido", async () => {
  const f = await cargar();
  const r = await f.acciones.updateProfile(formulario(CON_REDES));
  assert.deepEqual(r, { success: true });
  assert.deepEqual(f.llamadas[1]?.args, {
    p_enlaces: {
      instagram_usuario: "mi.tienda",
      whatsapp_numero: "522221234567",
      google_maps_url: "https://maps.app.goo.gl/AbC123",
      google_resenas_url: null,
      facebook_ruta: "mitienda.puebla",
      tiktok_usuario: "mi.tienda",
      youtube_ruta: "@micanal",
      x_usuario: "MiTienda",
      linkedin_ruta: "company/mi-tienda",
      threads_usuario: "mi.tienda",
      pinterest_usuario: null,
      telegram_usuario: "mitienda_pue",
      facebook_messenger: true,
    },
  });
});

test("formulario nuevo con la casilla de Messenger sin marcar: manda facebook_messenger en false", async () => {
  const f = await cargar();
  const sinMessenger = Object.fromEntries(Object.entries(CON_REDES).filter(([campo]) => campo !== "facebook_messenger"));
  const r = await f.acciones.updateProfile(formulario(sinMessenger));
  assert.deepEqual(r, { success: true });
  assert.equal((f.llamadas[1]?.args.p_enlaces as Record<string, unknown>).facebook_messenger, false);
});

test("Messenger sin usuario de Facebook frena antes de escribir", async () => {
  const f = await cargar();
  const r = await f.acciones.updateProfile(formulario({ ...CON_REDES, facebook_ruta: "facebook.com/profile.php?id=61550000000000" }));
  assert.match(r.error ?? "", /Messenger necesita el usuario/);
  assert.equal(f.llamadas.length, 0);
});

test("un enlace corto de TikTok frena antes de escribir y dice que escriba el usuario", async () => {
  const f = await cargar();
  const r = await f.acciones.updateProfile(formulario({ ...CON_REDES, tiktok_usuario: "https://vm.tiktok.com/ZMabc123/" }));
  assert.match(r.error ?? "", /enlace corto/);
  assert.equal(f.llamadas.length, 0);
});

test("si el segundo RPC falla con 22023, el mensaje dice que el perfil si se guardo, se revalida y no va a Sentry", async () => {
  const f = await cargar({ errorEnlaces: { code: "22023", message: "El enlace de Google Maps debe ser un enlace https de Google Maps." } });
  const r = await f.acciones.updateProfile(formulario(CON_ENLACES));
  assert.match(r.error ?? "", /^Tu perfil se guardó, pero los enlaces de tu negocio no\. El enlace de Google Maps/);
  assert.deepEqual(f.revalidadas, ["/"]);
  assert.equal(f.sentry.captureException.llamadas.length, 0);
});

test("un 42501 que no es el de 'activa el modo vendedor' se trata como fallo: Sentry y mensaje generico", async () => {
  const f = await cargar({ errorEnlaces: { code: "42501", message: "permission denied for function guardar_enlaces_negocio" } });
  const r = await f.acciones.updateProfile(formulario(CON_ENLACES));
  assert.match(r.error ?? "", /No se pudieron guardar\. Intenta de nuevo\.$/);
  assert.ok(!(r.error ?? "").includes("permission denied"));
  assert.equal(f.sentry.captureException.llamadas.length, 1);
  assert.deepEqual(f.revalidadas, ["/"]);
});

test("el 42501 de 'activa el modo vendedor' si se muestra tal cual y no va a Sentry", async () => {
  const f = await cargar({ errorEnlaces: { code: "42501", message: "Activa el modo vendedor para agregar los enlaces de tu negocio." } });
  const r = await f.acciones.updateProfile(formulario(CON_ENLACES));
  assert.match(r.error ?? "", /Activa el modo vendedor/);
  assert.equal(f.sentry.captureException.llamadas.length, 0);
});
