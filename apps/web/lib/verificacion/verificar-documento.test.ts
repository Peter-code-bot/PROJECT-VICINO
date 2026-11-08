/**
 * La accion verifyDocument DE VERDAD (app/actions/verify-document.ts), con las
 * fronteras sustituidas: Supabase (supabase-js real con un fetch falso),
 * Storage, el modelo, Upstash y Sentry. Sin red.
 *
 * Vigila en su sitio de llamada lo que se preparo el 7-nov-2026:
 *   - VERIFICACION_ANALISIS_IA=off sale con pending/fallback DESPUES del tipo,
 *     la universidad y el consentimiento, y sin listar, descargar, cobrar
 *     cuota ni llamar al modelo.
 *   - Dos ranuras con la misma foto se paran antes de todo eso.
 *   - VERIFICACION_RECHAZO_AUTOMATICO=false deja en 'pending' lo que hoy se
 *     rechaza, con `rechazable` en la nota; sin la variable, todo como hoy.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { cargarReal, sentryEspia } from "../pruebas/cargar-real";
import { crearSupabaseFalso } from "../pruebas/supabase-falso";
import type { AnalisisDocumento } from "./veredicto";

type Accion = typeof import("../../app/actions/verify-document");

const USUARIO = "00000000-0000-4000-8000-000000000001";
const FILA = "00000000-0000-4000-8000-0000000000aa";
const T0 = "2026-11-07T17:00:00.000Z";
const T1 = "2026-11-07T17:05:00.000Z";
const RUTAS = { selfie: `${USUARIO}/selfie`, frente: `${USUARIO}/ine_front`, reverso: `${USUARIO}/ine_back` };

const SIN_CONSENTIMIENTO = "Necesitas aceptar el tratamiento de tus datos biométricos antes de verificar tu identidad.";
const RUTAS_ILEGIBLES = "No pudimos leer tus documentos. Vuelve a subirlos.";

function analisisPerfecto(): AnalisisDocumento {
  return {
    es_credencial_valida: true,
    tipo_detectado: "INE",
    nombre_en_documento: null,
    el_nombre_coincide: true,
    nombre_universidad: null,
    la_universidad_coincide: null,
    vigente: true,
    frente: { legible: true, vigente: true, sellos_o_elementos_de_seguridad: true, observacion: null },
    reverso: { presente: true, legible: true, corresponde_al_frente: true, observacion: null },
    selfie: { rostro_detectado: true, misma_persona: true, confianza_rostro_porcentaje: 97, observacion: null },
    confianza_porcentaje: 96,
    veredicto: "aprobar",
    motivo_rechazo_o_duda: null,
  };
}

/** Un camino de rechazo de hoy: dos caras distintas con confianza de rostro alta. */
function caraDistinta(): AnalisisDocumento {
  return {
    ...analisisPerfecto(),
    selfie: { rostro_detectado: true, misma_persona: false, confianza_rostro_porcentaje: 96, observacion: null },
    confianza_porcentaje: 60,
    veredicto: "revision_humana",
    motivo_rechazo_o_duda: "Las caras no son de la misma persona.",
  };
}

/** Fija variables de entorno durante `fn` y deja las de antes al terminar. */
async function conEntorno<T>(valores: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const antes = Object.fromEntries(Object.keys(valores).map((k) => [k, process.env[k]]));
  const poner = (v: Record<string, string | undefined>) => {
    for (const [k, valor] of Object.entries(v)) {
      if (valor === undefined) delete process.env[k];
      else process.env[k] = valor;
    }
  };
  poner(valores);
  try {
    return await fn();
  } finally {
    poner(antes);
  }
}

/** Cliente de servicio: el historial de otras filas sale vacio y cada UPDATE se guarda. */
function adminFalso() {
  const escrituras: Array<Record<string, unknown>> = [];
  const responder = (cuerpo: unknown) =>
    new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });
  const fetchFalso = async (_entrada: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    if ((init?.method ?? "GET").toUpperCase() === "PATCH") {
      escrituras.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return responder([{ id: FILA }]);
    }
    return responder([]);
  };
  const cliente = createClient("https://supabase-falso.invalid", "servicio-de-prueba", {
    global: { fetch: fetchFalso },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return { cliente, escrituras };
}

type Escenario = {
  entorno?: Record<string, string | undefined>;
  tipo?: string;
  universidad?: string | null;
  consentimiento?: boolean;
  rutas?: { selfie: string; frente: string; reverso: string };
  analisis?: AnalisisDocumento;
};

async function verificar(escenario: Escenario = {}) {
  const rutas = escenario.rutas ?? RUTAS;
  const usuario = crearSupabaseFalso({
    usuario: { id: USUARIO },
    tablas: {
      seller_verification: [
        {
          id: FILA,
          status: "pending",
          selfie_url: rutas.selfie,
          ine_front_url: rutas.frente,
          ine_back_url: rutas.reverso,
          updated_at: T0,
          ai_analysis_raw: null,
          ai_analizado_en: null,
        },
      ],
      profiles: [{ nombre: "Persona Prueba" }],
    },
    rpc: {
      tiene_consentimiento_biometrico: () => ({ status: 200, body: escenario.consentimiento ?? true }),
      consumir_cuota_verificacion_ia: () => ({ status: 200, body: { permitido: true, se_libera_en: null } }),
    },
  });
  const storage: string[] = [];
  const clienteUsuario = {
    ...usuario.cliente,
    storage: {
      from: (bucket: string) => ({
        list: async (carpeta: string) => {
          storage.push(`list ${bucket}/${carpeta}`);
          const nombres = ["selfie", "ine_front", "ine_back"];
          return { data: nombres.map((name) => ({ name, updated_at: T1 })), error: null };
        },
        download: async (ruta: string) => {
          storage.push(`download ${bucket}/${ruta}`);
          return { data: new Blob([Uint8Array.of(1, 2, 3)], { type: "image/png" }), error: null };
        },
      }),
    },
  };
  const admin = adminFalso();
  const llamadasAlModelo: unknown[] = [];
  const respuesta = JSON.stringify(escenario.analisis ?? analisisPerfecto());
  class OpenAIFalso {
    chat = {
      completions: {
        create: async (cuerpo: unknown) => {
          llamadasAlModelo.push(cuerpo);
          return { choices: [{ message: { content: respuesta } }] };
        },
      },
    };
  }
  const cobros: unknown[] = [];
  const sentry = sentryEspia();
  const entorno = {
    OPENAI_API_KEY: "llave-falsa-de-prueba",
    VERCEL_ENV: undefined,
    VERIFICACION_APROBACION_AUTOMATICA: undefined,
    VERIFICACION_RECHAZO_AUTOMATICO: undefined,
    VERIFICACION_ANALISIS_IA: undefined,
    ...escenario.entorno,
  };
  const resultado = await conEntorno(entorno, async () => {
    // Se carga DENTRO del entorno: las banderas de aprobacion y rechazo se
    // leen al cargar el modulo, como en produccion.
    const accion = await cargarReal<Accion>("app/actions/verify-document.ts", {
      stubs: {
        "@/lib/supabase/server": { createClient: async () => clienteUsuario },
        "@/lib/supabase/admin": { createAdminClient: () => admin.cliente },
        "@/lib/rate-limit": {
          verificacionRateLimit: {},
          enforce: async (...args: unknown[]) => {
            cobros.push(args);
            return { ok: true };
          },
        },
        "@sentry/nextjs": sentry,
        openai: { default: OpenAIFalso },
      },
    });
    return accion.verifyDocument(escenario.tipo ?? "INE", escenario.universidad ?? null);
  });
  const rpc = usuario.peticiones.filter((p) => p.recurso.startsWith("rpc/")).map((p) => p.recurso.slice(4));
  return { resultado, rpc, storage, cobros, llamadasAlModelo, escrituras: admin.escrituras, sentry };
}

function nota(escritura: Record<string, unknown> | undefined): Record<string, unknown> {
  const valor = escritura?.ai_analysis_raw;
  assert.ok(typeof valor === "object" && valor !== null, "la escritura trae ai_analysis_raw");
  return valor as Record<string, unknown>;
}

// --------------------------------------------------------------------------
// Analisis apagado (interpretacion B)
// --------------------------------------------------------------------------

test("VERIFICACION_ANALISIS_IA=off: pending sin listar, descargar, cobrar ni llamar al modelo", async () => {
  const r = await verificar({ entorno: { VERIFICACION_ANALISIS_IA: "off" } });
  assert.deepEqual(r.resultado, { success: true, status: "pending", fallback: true });
  assert.deepEqual(r.rpc, ["tiene_consentimiento_biometrico"], "comprobo el consentimiento y no cobro la cuota");
  assert.deepEqual(r.storage, []);
  assert.deepEqual(r.cobros, []);
  assert.equal(r.llamadasAlModelo.length, 0);
  assert.deepEqual(r.escrituras, [], "no escribe: la fila sigue pending desde la subida");
});

test("con el analisis apagado el consentimiento se sigue exigiendo", async () => {
  const r = await verificar({ entorno: { VERIFICACION_ANALISIS_IA: "off" }, consentimiento: false });
  assert.deepEqual(r.resultado, { success: false, error: SIN_CONSENTIMIENTO });
  assert.deepEqual(r.storage, []);
  assert.equal(r.llamadasAlModelo.length, 0);
});

test("con el analisis apagado el tipo y la universidad se siguen validando antes", async () => {
  const tipo = await verificar({ entorno: { VERIFICACION_ANALISIS_IA: "off" }, tipo: "Pasaporte" });
  assert.equal(tipo.resultado.success, false);
  assert.match(tipo.resultado.error ?? "", /tipo de documento/);
  assert.deepEqual(tipo.rpc, []);
  const universidad = await verificar({ entorno: { VERIFICACION_ANALISIS_IA: "off" }, tipo: "Credencial Universitaria" });
  assert.equal(universidad.resultado.success, false);
  assert.match(universidad.resultado.error ?? "", /universidad/);
});

test("solo el valor exacto 'off' apaga el analisis", async () => {
  for (const valor of ["OFF", "", "false", "0", "apagado"]) {
    const r = await verificar({ entorno: { VERIFICACION_ANALISIS_IA: valor } });
    assert.equal(r.llamadasAlModelo.length, 1, `«${valor}» lo deja encendido`);
    assert.ok(r.rpc.includes("consumir_cuota_verificacion_ia"));
    assert.equal(r.escrituras.length, 1);
  }
});

test("lo de hoy, documentado: sin OPENAI_API_KEY sale antes incluso del consentimiento", async () => {
  // Por eso apagar el analisis quitando la llave deja sin comprobar el
  // consentimiento en el servidor, y por eso existe VERIFICACION_ANALISIS_IA.
  const r = await verificar({ entorno: { OPENAI_API_KEY: undefined }, consentimiento: false });
  assert.deepEqual(r.resultado, { success: true, status: "pending", fallback: true });
  assert.deepEqual(r.rpc, []);
});

// --------------------------------------------------------------------------
// Tres fotos distintas
// --------------------------------------------------------------------------

test("la misma foto en dos ranuras se para antes de descargar, cobrar o llamar al modelo", async () => {
  const variantes = [
    { ...RUTAS, frente: RUTAS.selfie },
    { ...RUTAS, reverso: RUTAS.frente },
    { ...RUTAS, frente: `${RUTAS.selfie}#1` },
  ];
  for (const rutas of variantes) {
    const r = await verificar({ rutas });
    assert.deepEqual(r.resultado, { success: false, error: RUTAS_ILEGIBLES }, JSON.stringify(rutas));
    assert.deepEqual(r.storage, []);
    assert.deepEqual(r.rpc, []);
    assert.equal(r.llamadasAlModelo.length, 0);
    assert.deepEqual(r.escrituras, []);
    const avisos = r.sentry.captureMessage.llamadas.map(([mensaje]) => mensaje);
    assert.ok(avisos.some((m) => m.includes("repite una foto")), "queda un aviso sin rutas ni datos");
    assert.equal(JSON.stringify(r.sentry.captureMessage.llamadas).includes(USUARIO), false);
  }
});

test("las rutas repetidas se paran tambien con el analisis apagado", async () => {
  const r = await verificar({ rutas: { ...RUTAS, frente: RUTAS.selfie }, entorno: { VERIFICACION_ANALISIS_IA: "off" } });
  assert.deepEqual(r.resultado, { success: false, error: RUTAS_ILEGIBLES });
});

// --------------------------------------------------------------------------
// Rechazo automatico controlable (interpretacion A)
// --------------------------------------------------------------------------

test("sin la variable de rechazo, todo como hoy: el camino de rechazo escribe 'rejected'", async () => {
  const r = await verificar({ analisis: caraDistinta() });
  assert.equal(r.resultado.status, "rejected");
  assert.equal(r.escrituras[0]?.status, "rejected");
  const n = nota(r.escrituras[0]);
  assert.equal(n.decision, "rejected");
  assert.equal(n.rechazable, true);
  assert.equal(n.aprobable, false);
});

test("VERIFICACION_RECHAZO_AUTOMATICO=false: se queda en pending, en la cola, y la nota dice rechazable", async () => {
  const r = await verificar({ analisis: caraDistinta(), entorno: { VERIFICACION_RECHAZO_AUTOMATICO: "false" } });
  assert.equal(r.resultado.status, "pending");
  assert.equal(r.resultado.fallback, false);
  assert.equal(r.escrituras[0]?.status, "pending");
  const n = nota(r.escrituras[0]);
  assert.equal(n.decision, "pending", "decision sigue diciendo lo que hizo el servidor");
  assert.equal(n.rechazable, true);
  assert.equal(n.aprobable, false);
});

test("solo el valor exacto 'false' apaga el rechazo", async () => {
  for (const valor of ["FALSE", "0", "no", "", "off"]) {
    const r = await verificar({ analisis: caraDistinta(), entorno: { VERIFICACION_RECHAZO_AUTOMATICO: valor } });
    assert.equal(r.escrituras[0]?.status, "rejected", `«${valor}» lo deja encendido`);
  }
});

test("las dos banderas llegan cada una a su opcion (si se intercambian, esto falla)", async () => {
  const entorno = { VERIFICACION_APROBACION_AUTOMATICA: "true", VERIFICACION_RECHAZO_AUTOMATICO: "false" };
  const perfecto = await verificar({ entorno });
  assert.equal(perfecto.escrituras[0]?.status, "approved");
  const rechazo = await verificar({ entorno, analisis: caraDistinta() });
  assert.equal(rechazo.escrituras[0]?.status, "pending");
});

test("un analisis impecable con las banderas de hoy: pending, aprobable y no rechazable", async () => {
  const r = await verificar();
  assert.equal(r.escrituras[0]?.status, "pending");
  const n = nota(r.escrituras[0]);
  assert.equal(n.decision, "pending");
  assert.equal(n.aprobable, true);
  assert.equal(n.rechazable, false);
});
