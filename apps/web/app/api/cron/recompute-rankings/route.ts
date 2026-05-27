/**
 * Vercel Cron entrypoint for nightly seller ranking recomputation.
 *
 * Vercel hits this route on the schedule defined in vercel.json. The handler
 * verifies a shared CRON_SECRET and then proxies the request to the Supabase
 * Edge Function `recompute-rankings`, which holds the service-role key and
 * runs the SQL orchestrator.
 *
 * Two layers verify the same secret so neither Vercel nor Supabase has to
 * trust an unauthenticated caller.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.CRON_SECRET;
  if (!expectedSecret) {
    console.error("[cron/recompute-rankings] CRON_SECRET not configured");
    return NextResponse.json(
      { ok: false, error: "Server misconfigured" },
      { status: 500 }
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) {
    return NextResponse.json(
      { ok: false, error: "NEXT_PUBLIC_SUPABASE_URL missing" },
      { status: 500 }
    );
  }

  const functionUrl = `${supabaseUrl}/functions/v1/recompute-rankings`;

  try {
    const upstream = await fetch(functionUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${expectedSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });

    const text = await upstream.text();
    return new NextResponse(text, {
      status: upstream.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[cron/recompute-rankings] upstream fetch failed", err);
    return NextResponse.json(
      { ok: false, error: "Upstream call failed" },
      { status: 502 }
    );
  }
}

// Vercel Cron sends GET by default; accept both verbs so the schedule works
// regardless of how Vercel dispatches.
export const GET = POST;
