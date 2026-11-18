import "server-only";
import * as Sentry from "@sentry/nextjs";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";
import {
  CUENTAS_FUERA_DE_METRICAS,
  DOMINIOS_FUERA_DE_METRICAS,
  patronDeDominio,
  resumirComunidad,
  type ConteoComunidad,
} from "./cuentas-fuera-de-metricas";

type ClienteDeServicio = SupabaseClient<Database>;

export type ResultadoComunidad = { ok: true; conteo: ConteoComunidad } | { ok: false };

/**
 * Usuarios y vendedores reales para la tarjeta "Comunidad" del panel.
 *
 * Necesita el cliente de servicio: el criterio mira el correo, y `email` es
 * una columna que `authenticated` no puede leer ni usar en un filtro (grants
 * por columna). Quien llame tiene que haber pasado antes por
 * requireAdminPage().
 *
 * Los totales y las cuentas por dominio salen de conteos exactos de la base
 * (`count: "exact"`), no de filas traidas y contadas aqui: PostgREST corta las
 * respuestas a 1000 filas sin avisar, y un conteo que se queda corto en
 * silencio es lo que se esta arreglando. Solo la lista corta de UUID se trae
 * como filas, una por UUID, sin riesgo de corte.
 */
export async function contarComunidad(admin: ClienteDeServicio): Promise<ResultadoComunidad> {
  const ids = CUENTAS_FUERA_DE_METRICAS.map((cuenta) => cuenta.id);

  const [perfiles, vendedores, porId, porDominio] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }),
    admin.from("profiles").select("id", { count: "exact", head: true }).eq("es_vendedor", true),
    ids.length > 0
      ? admin.from("profiles").select("id, email, es_vendedor").in("id", ids)
      : Promise.resolve({ data: [], error: null }),
    Promise.all(DOMINIOS_FUERA_DE_METRICAS.map((dominio) => contarDominio(admin, dominio))),
  ]);

  const fallo =
    perfiles.error ?? vendedores.error ?? porId.error ?? porDominio.find((d) => d.error)?.error ?? null;
  if (fallo || perfiles.count === null || vendedores.count === null) {
    Sentry.captureException(fallo ?? new Error("conteo nulo"), {
      tags: { action: "admin.metricas.comunidad" },
    });
    return { ok: false };
  }

  const conteo = resumirComunidad({
    totalPerfiles: perfiles.count,
    totalVendedores: vendedores.count,
    porDominio: porDominio.reduce(
      (suma, dominio) => ({
        cuentas: suma.cuentas + dominio.cuentas,
        vendedores: suma.vendedores + dominio.vendedores,
      }),
      { cuentas: 0, vendedores: 0 },
    ),
    porId: porId.data ?? [],
  });
  return { ok: true, conteo };
}

async function contarDominio(admin: ClienteDeServicio, dominio: string) {
  const patron = patronDeDominio(dominio);
  const [cuentas, vendedores] = await Promise.all([
    admin.from("profiles").select("id", { count: "exact", head: true }).ilike("email", patron),
    admin
      .from("profiles")
      .select("id", { count: "exact", head: true })
      .ilike("email", patron)
      .eq("es_vendedor", true),
  ]);
  const error = cuentas.error ?? vendedores.error ?? null;
  if (error || cuentas.count === null || vendedores.count === null) {
    return { cuentas: 0, vendedores: 0, error: error ?? new Error(`conteo nulo para ${dominio}`) };
  }
  return { cuentas: cuentas.count, vendedores: vendedores.count, error: null };
}
