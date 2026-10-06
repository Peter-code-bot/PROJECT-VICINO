/**
 * Sentry 7758342436 (GET /api/session/[resource], 2 eventos) y 7758342372
 * (GET /perfil, 1 evento): «PostgrestError: Cannot coerce the result to a
 * single JSON object».
 *
 * cargarCore pedia el perfil con `.throwOnError()` + `.single()`. Con 0 filas
 * PostgREST contesta 406 PGRST116 y postgrest-js LANZA antes de llegar al
 * `if (!profileData)`, asi que una sesion sin perfil (una cuenta borrada a
 * medias, la misma rafaga del 27-sep que la FK de legal_acceptances) acababa
 * como excepcion en las dos superficies que la piden. Se prueba en esas dos
 * superficies reales, con supabase-js de verdad.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { cargarReal, sentryEspia } from "./pruebas/cargar-real";
import { crearSupabaseFalso, type OpcionesSupabaseFalso } from "./pruebas/supabase-falso";

type Ruta = typeof import("../app/api/session/[resource]/route");
type Pagina = { default: () => Promise<{ props: { seeds: Record<string, { value: Record<string, unknown> } | undefined> } }> };

const USUARIO = { id: "0186140a-0000-4000-8000-000000000001", email: "ana@prueba.invalid" };
const PERFIL = {
  id: USUARIO.id, nombre: "Ana", foto: null, bio: null, user_id: null, username: "ana", ubicacion: null,
  es_vendedor: null, seller_type: null, nombre_negocio: null, categoria_negocio: null, metodos_pago_aceptados: null,
  trust_level: null, trust_points: null, total_sales: null, average_rating: null, reviews_count: null,
  is_verified: null, created_at: "2026-09-01T00:00:00Z", alta_vendedor_paso: null,
};

function cliente(opciones: Partial<OpcionesSupabaseFalso>) {
  return crearSupabaseFalso({ usuario: USUARIO, tablas: { products_services: [] }, ...opciones }).cliente;
}

async function pedirCore(opciones: Partial<OpcionesSupabaseFalso>) {
  const sentry = sentryEspia();
  const supabase = cliente(opciones);
  const ruta = await cargarReal<Ruta>("app/api/session/[resource]/route.ts", {
    stubs: {
      "@sentry/nextjs": sentry,
      "@/lib/supabase/server": { createClient: async () => supabase },
      "@/lib/rate-limit": { readHeavyRateLimit: null, enforce: async () => ({ ok: true }), getClientIp: () => "10.0.0.1" },
    },
  });
  const res = await ruta.GET(new Request("https://vicino.test/api/session/profile?part=core"), {
    params: Promise.resolve({ resource: "profile" }),
  });
  return { res, sentry };
}

async function abrirPerfil(opciones: Partial<OpcionesSupabaseFalso>) {
  const sentry = sentryEspia();
  const supabase = cliente(opciones);
  const pagina = await cargarReal<Pagina>("app/(marketplace)/perfil/page.tsx", {
    stubs: {
      "@sentry/nextjs": sentry,
      "@/lib/supabase/server": { createClient: async () => supabase },
      "next/navigation": {
        redirect: (destino: string) => {
          throw new Error(`redirect inesperado a ${destino}`);
        },
      },
      "./profile-session": { ProfileSession: () => null },
    },
  });
  const arbol = await pagina.default();
  return { seeds: arbol.props.seeds, sentry };
}

function esAvisoSinPerfil(sentry: ReturnType<typeof sentryEspia>) {
  assert.equal(sentry.captureException.llamadas.length, 0, "una sesion sin perfil no es una excepcion del codigo");
  assert.equal(sentry.captureMessage.llamadas.length, 1);
  const [, contexto] = sentry.captureMessage.llamadas[0]!;
  assert.equal(contexto?.level, "warning");
  assert.deepEqual(contexto?.fingerprint, ["sesion-sin-perfil"]);
}

test("/api/session/profile?part=core sin fila en profiles: 503 (no 401) y un aviso, no una excepcion", async () => {
  const { res, sentry } = await pedirCore({ tablas: { profiles: [] } });
  // 503 y no 401: con 401 el cliente vacia la memoria y manda a /login, y con
  // la sesion viva /login lo devuelve: un bucle.
  assert.equal(res.status, 503);
  esAvisoSinPerfil(sentry);
});

test("/api/session/profile?part=core con perfil: 200 con los valores de reposo aplicados", async () => {
  const { res, sentry } = await pedirCore({ tablas: { profiles: [PERFIL] } });
  assert.equal(res.status, 200);
  const cuerpo = (await res.json()) as { userId: string; value: Record<string, unknown> };
  assert.equal(cuerpo.userId, USUARIO.id);
  assert.equal(cuerpo.value.nombre, "Ana");
  assert.equal(cuerpo.value.email, USUARIO.email);
  assert.equal(cuerpo.value.es_vendedor, false);
  assert.equal(cuerpo.value.trust_level, "nuevo");
  assert.equal(sentry.captureException.llamadas.length + sentry.captureMessage.llamadas.length, 0);
});

test("/api/session/profile?part=core con un error real de la consulta: sigue siendo excepcion", async () => {
  // El caso que motivo capturar aqui (columna sin GRANT, 42501) no puede
  // quedar tapado por el arreglo del perfil inexistente.
  const { res, sentry } = await pedirCore({
    errores: { profiles: { status: 403, body: { code: "42501", details: null, hint: null, message: "permission denied for column alta_vendedor_paso" } } },
  });
  assert.equal(res.status, 503);
  assert.equal(sentry.captureException.llamadas.length, 1);
  assert.equal(sentry.captureMessage.llamadas.length, 0);
});

test("/perfil sin fila en profiles: core sin semilla, products sembrada, y un aviso en vez de excepcion", async () => {
  const { seeds, sentry } = await abrirPerfil({ tablas: { profiles: [] } });
  assert.equal(seeds.core, undefined, "sin semilla: el cliente la pide y ofrece el reintento");
  assert.ok(seeds.products, "las demas partes no caen con el perfil");
  esAvisoSinPerfil(sentry);
});

test("/perfil con perfil: siembra core", async () => {
  const { seeds, sentry } = await abrirPerfil({ tablas: { profiles: [PERFIL] } });
  assert.equal(seeds.core?.value.nombre, "Ana");
  assert.equal(sentry.captureException.llamadas.length + sentry.captureMessage.llamadas.length, 0);
});
