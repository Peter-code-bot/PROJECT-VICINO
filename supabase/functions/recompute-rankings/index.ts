// Supabase Edge Function: recompute seller rankings for the current month.
// Triggered by Vercel Cron (apps/web/app/api/cron/recompute-rankings/route.ts)
// which proxies the call with the shared CRON_SECRET. We also accept the call
// directly if Authorization is correct.
//
// Deploy with: supabase functions deploy recompute-rankings
// Set secret with: supabase secrets set CRON_SECRET=<random 32+ chars>

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

function currentPeriodInMexicoCity(): string {
  // en-CA yields ISO-like YYYY-MM-DD; we want YYYY-MM in CDMX.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
  });
  const parts = fmt.formatToParts(new Date());
  const year = parts.find((p) => p.type === "year")?.value ?? "0000";
  const month = parts.find((p) => p.type === "month")?.value ?? "00";
  return `${year}-${month}`;
}

Deno.serve(async (req: Request) => {
  const expected = Deno.env.get("CRON_SECRET");
  if (!expected) {
    return new Response(
      JSON.stringify({ ok: false, error: "CRON_SECRET not configured" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  const auth = req.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${expected}`) {
    return new Response(
      JSON.stringify({ ok: false, error: "unauthorized" }),
      { status: 401, headers: { "Content-Type": "application/json" } },
    );
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SB_SECRET_KEY")!,
  );

  const period = currentPeriodInMexicoCity();
  const { data, error } = await supabase.rpc("recompute_seller_rankings", {
    p_period: period,
  });

  if (error) {
    return new Response(
      JSON.stringify({ ok: false, period, error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }

  return new Response(
    JSON.stringify({
      ok: true,
      period,
      categories_processed: data,
      computed_at: new Date().toISOString(),
    }),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
});
