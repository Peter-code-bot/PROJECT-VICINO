/**
 * Sentry 7758342326 (27-sep): registrarAceptacionLegal violaba la FK
 * legal_acceptances_user_id_fkey.
 *
 * Causa: una sesion de Auth viva SIN fila en profiles (una cuenta borrada a
 * medias: delete_user_data borra el perfil antes de dar de baja a Auth). El
 * layout montaba el registro con solo mirar `user`, y la accion mandaba la FK
 * a Sentry como error. Se prueba en los dos sitios de llamada reales: el
 * layout de (marketplace) y la accion.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { buscarElementos, cargarReal, sentryEspia } from "../../lib/pruebas/cargar-real";
import { crearSupabaseFalso, type Fila, type RespuestaFalsa } from "../../lib/pruebas/supabase-falso";

type Legal = typeof import("./legal");
type Layout = { default: (props: { children: unknown }) => Promise<unknown> };

const USUARIO = { id: "0186140a-0000-4000-8000-000000000001", email: "rota@prueba.invalid" };

// Lo que PostgREST devuelve (HTTP 409) cuando el INSERT del RPC viola una FK.
const FK_PERFIL = {
  code: "23503",
  details: `Key (user_id)=(${USUARIO.id}) is not present in table "profiles".`,
  hint: null,
  message: 'insert or update on table "legal_acceptances" violates foreign key constraint "legal_acceptances_user_id_fkey"',
};
const FK_DOCUMENTO = {
  code: "23503",
  details: 'Key (documento, version)=(terminos, 9.9) is not present in table "legal_documents".',
  hint: null,
  message:
    'insert or update on table "legal_acceptances" violates foreign key constraint "legal_acceptances_documento_version_fkey"',
};

async function cargarAccion(errorRpc: object) {
  const sentry = sentryEspia();
  const { cliente } = crearSupabaseFalso({
    usuario: USUARIO,
    rpc: { registrar_aceptacion_legal: () => ({ status: 409, body: errorRpc }) },
  });
  const legal = await cargarReal<Legal>("app/actions/legal.ts", {
    stubs: {
      "@sentry/nextjs": sentry,
      "next/headers": { headers: async () => new Headers({ "user-agent": "prueba", "x-forwarded-for": "10.0.0.1" }) },
      "@/lib/supabase/server": { createClient: async () => cliente },
      "@/lib/rate-limit": { writeRateLimit: null, enforce: async () => ({ ok: true }) },
    },
  });
  return { legal, sentry };
}

test("accion: la FK de user_id (sesion sin perfil) no se manda como error; se avisa una vez agrupada", async () => {
  const { legal, sentry } = await cargarAccion(FK_PERFIL);
  const resultado = await legal.registrarAceptacionLegal();

  assert.ok("error" in resultado, "sin perfil no hay a quien acreditar: devuelve error, no exito");
  assert.equal(sentry.captureException.llamadas.length, 0, "no es un fallo del codigo: no va como excepcion");
  assert.equal(sentry.captureMessage.llamadas.length, 1);
  const [, contexto] = sentry.captureMessage.llamadas[0]!;
  assert.equal(contexto?.level, "warning");
  assert.deepEqual(contexto?.fingerprint, ["sesion-sin-perfil"]);
});

test("accion: la FK de (documento, version) SIGUE siendo un error de Sentry", async () => {
  // Tambien es 23503. Filtrar por codigo en vez de por constraint taparia un
  // bug real: el RPC eligiendo una version que no existe en legal_documents.
  const { legal, sentry } = await cargarAccion(FK_DOCUMENTO);
  const resultado = await legal.registrarAceptacionLegal();

  assert.ok("error" in resultado);
  assert.equal(sentry.captureException.llamadas.length, 1);
  assert.equal(sentry.captureMessage.llamadas.length, 0);
});

/**
 * Carga el layout de (marketplace) con el arbol de componentes vaciado.
 * `errorPerfil` hace que la consulta de profiles conteste con ese error de
 * PostgREST en vez de con filas.
 */
async function cargarLayout(perfiles: Fila[], errorPerfil?: RespuestaFalsa) {
  const sentry = sentryEspia();
  const { cliente } = crearSupabaseFalso({
    usuario: USUARIO,
    tablas: { profiles: perfiles },
    errores: errorPerfil ? { profiles: errorPerfil } : undefined,
    rpc: { avisos_legales_pendientes: () => ({ status: 200, body: [] }) },
  });
  const Registro = () => null;
  const layout = await cargarReal<Layout>("app/(marketplace)/layout.tsx", {
    stubs: {
      "@sentry/nextjs": sentry,
      "next/headers": {
        cookies: async () => ({ get: () => undefined }),
        headers: async () => new Headers({ "x-vicino-ruta": "/" }),
      },
      "next/navigation": {
        redirect: (destino: string) => {
          throw new Error(`redirect inesperado a ${destino}`);
        },
      },
      "@/lib/supabase/server": { createClient: async () => cliente },
      "@/components/legal/registro-aceptacion": { RegistroAceptacionLegal: Registro },
    },
    aislarEntrada: { reales: ["react", "@vicino/shared", "@/lib/navigation/rutas-legales"] },
  });
  const arbol = await layout.default({ children: null });
  return { registros: buscarElementos(arbol, Registro), sentry };
}

const PERFIL = { nombre: "Ana", foto: null, es_vendedor: false, has_seen_onboarding: true, username: "ana", seller_type: null, nombre_negocio: null };

test("layout: sin fila en profiles NO se monta el registro de aceptacion", async () => {
  const { registros, sentry } = await cargarLayout([]);
  assert.equal(registros.length, 0);
  assert.equal(sentry.captureException.llamadas.length, 0, "0 filas es un dato, no un fallo de la consulta");
});

test("layout: con perfil se sigue montando (una sola vez)", async () => {
  const { registros, sentry } = await cargarLayout([PERFIL]);
  assert.equal(registros.length, 1);
  assert.equal(sentry.captureException.llamadas.length, 0);
});

// Que la consulta del perfil FALLE no dice nada de si hay perfil. Saltarse el
// registro en ese caso lo dejaba en silencio para todos los usuarios mientras
// durara el fallo: una columna nueva del SELECT sin su GRANT (la saga de
// has_seen_onboarding, 20260704000002) o un timeout. Y el layout no se vuelve a
// ejecutar al navegar en el cliente, asi que un fallo pasajero en la primera
// carga dejaba sin registro toda la pestaña.
const FALLOS_DE_LA_CONSULTA: Array<[string, RespuestaFalsa]> = [
  [
    "42501 por una columna sin GRANT",
    { status: 401, body: { code: "42501", details: null, hint: null, message: "permission denied for column has_seen_onboarding" } },
  ],
  [
    "timeout de la sentencia",
    { status: 500, body: { code: "57014", details: null, hint: null, message: "canceling statement due to statement timeout" } },
  ],
];

for (const [caso, fallo] of FALLOS_DE_LA_CONSULTA) {
  test(`layout: si la consulta del perfil falla (${caso}) se monta el registro y el fallo va a Sentry`, async () => {
    const { registros, sentry } = await cargarLayout([PERFIL], fallo);

    assert.equal(registros.length, 1, "no se sabe si hay perfil: registra y que la accion clasifique la FK");
    assert.equal(sentry.captureException.llamadas.length, 1, "un fallo de la consulta no puede quedar en silencio");
    const [error, contexto] = sentry.captureException.llamadas[0]!;
    assert.equal((error as { code?: string }).code, (fallo.body as { code: string }).code);
    assert.deepEqual(contexto?.tags, { layout: "marketplace", query: "profiles" });
  });
}
