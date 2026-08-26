import { NextRequest, NextResponse } from "next/server";

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

  try {
    const upstream = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
    });

    const body = await upstream.text();
    return new NextResponse(body, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "fetch failed";
    return NextResponse.json(
      { ok: false, error: message },
      { status: 502 },
    );
  }
}

export const GET = recomputeRankings;
export const POST = recomputeRankings;
