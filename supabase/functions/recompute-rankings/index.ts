// Supabase Edge Function: recompute seller rankings for the current period.
// Triggered by Vercel Cron via /api/cron/recompute-rankings.
//
// The function:
//   1. Verifies an Authorization: Bearer <CRON_SECRET> header.
//   2. Resolves the current period as YYYY-MM in America/Mexico_City.
//   3. Calls the SQL orchestrator recompute_seller_rankings(period).
//   4. Returns { ok, period, categories_processed }.
//
// Deploy: supabase functions deploy recompute-rankings
// Set CRON_SECRET as a function secret in the Supabase dashboard.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function periodInMexicoCity(now: Date): string {
  // Intl.DateTimeFormat with timeZone gives us the local-CDMX date components.
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

Deno.serve(async (req) => {
  const expectedSecret = Deno.env.get("CRON_SECRET");
  if (!expectedSecret) {
    return new Response(
      JSON.stringify({ error: "CRON_SECRET not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${expectedSecret}`) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const period = periodInMexicoCity(new Date());

  const { data, error } = await supabase.rpc("recompute_seller_rankings", {
    p_period: period,
  });

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, period, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      period,
      categories_processed: data,
      timestamp: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } }
  );
});
