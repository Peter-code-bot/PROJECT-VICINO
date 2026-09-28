import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { createAdminClient } from "@/lib/supabase/admin";
import { periodosARecalcular } from "@/lib/rankings/periodos";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Vercel Cron invoca sus rutas por GET. Esta solo exportaba POST, asi que cada
 * disparo diario moria con 405 y `seller_rankings` seguia vacia: el ranking nunca
 * se ha calculado desde que se agendo. Se exportan ambos verbos porque el POST ya
 * existia y puede haber quien lo invoque a mano.
 *
 * Vercel adjunta `Authorization: Bearer ${CRON_SECRET}` a sus crons solo si la
 * variable CRON_SECRET esta definida en el proyecto. Tiene que valer lo mismo que
 * el CRON_SECRET de las Edge Functions de Supabase, porque este handler reenvia
 * ese mismo bearer a /functions/v1/recompute-rankings.
 */
async function recomputeRankings(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 500 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return NextResponse.json(
      { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL not configured" },
      { status: 500 },
    );
  }

  const endpoint = `${supabaseUrl}/functions/v1/recompute-rankings`;

  // Mes en curso: la Edge Function. Un fallo de red ya no corta el resto.
  let actual: { status: number; body: string } | { status: 502; error: string };
  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
      // Sin tope, una funcion colgada dejaba sin recalcular tambien el mes
      // anterior hasta que la plataforma cortara la ruta.
      signal: AbortSignal.timeout(25_000),
    });
    actual = { status: upstream.status, body: await upstream.text() };
  } catch (error: unknown) {
    actual = { status: 502, error: error instanceof Error ? error.message : "fetch failed" };
  }
  if ("error" in actual || actual.status < 200 || actual.status >= 300) {
    Sentry.captureMessage("cron recompute-rankings: fallo el mes en curso", {
      level: "error",
      tags: { action: "cron_recompute_rankings", paso: "mes_actual" },
      extra: { status: actual.status },
    });
  }

  // H4 (S08, 27-sep): la Edge Function solo recalcula el mes en curso, asi que
  // lo que pasaba despues de la ultima corrida del mes no entraba nunca en su
  // periodo. Los dias 1 y 2 de CDMX se recalcula aqui tambien el mes anterior,
  // con la misma RPC, aunque la llamada del mes en curso haya fallado. Va en
  // esta ruta (se despliega con Vercel) y no en la funcion, que habria que
  // desplegar aparte. Solo se llega aqui con el bearer del cron ya validado.
  const [, anterior] = periodosARecalcular(new Date());
  if (!anterior) {
    return "error" in actual
      ? NextResponse.json({ ok: false, error: actual.error }, { status: actual.status })
      : new NextResponse(actual.body, { status: actual.status, headers: { "Content-Type": "application/json" } });
  }

  let errorAnterior: string | null = null;
  try {
    const { error } = await createAdminClient().rpc("recompute_seller_rankings", { p_period: anterior });
    if (error) {
      errorAnterior = error.message;
      Sentry.captureException(error, {
        tags: { action: "cron_recompute_rankings", paso: "mes_anterior" },
        extra: { periodo: anterior, code: error.code },
      });
    }
  } catch (error: unknown) {
    errorAnterior = error instanceof Error ? error.message : "rpc failed";
    Sentry.captureException(error, { tags: { action: "cron_recompute_rankings", paso: "mes_anterior" } });
  }

  const actualOk = !("error" in actual) && actual.status >= 200 && actual.status < 300;
  return NextResponse.json(
    {
      actual: "error" in actual ? { ok: false, error: actual.error } : safeJson(actual.body),
      anterior: { period: anterior, ok: errorAnterior === null, error: errorAnterior },
    },
    { status: actualOk && errorAnterior === null ? 200 : 500 },
  );
}

function safeJson(texto: string): unknown {
  try {
    return JSON.parse(texto);
  } catch {
    return texto;
  }
}

export const GET = recomputeRankings;
export const POST = recomputeRankings;
