// Supabase Edge Function: expire stale sale confirmations
// Deploy with: supabase functions deploy expire-confirmations
// Scheduled by supabase/migrations/20260531000001_pg_cron_schedules.sql
// (Vercel Hobby cannot run sub-daily crons, so pg_cron + pg_net drive this
// from within the database every 6 hours.)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

Deno.serve(async (req: Request) => {
  // Defense in depth (mirror recompute-rankings/index.ts:25-39): even though
  // pg_cron drives this from the same Supabase project, reject any request
  // without the shared CRON_SECRET bearer to block direct public invocation.
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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  const { data, error } = await supabase.rpc("expire_stale_confirmations");

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({ expired_count: data, timestamp: new Date().toISOString() }),
    {
      status: 200,
      headers: { "Content-Type": "application/json" },
    }
  );
});
