// supabase/functions/delete-account/index.ts
// Deno runtime — same pattern as expire-confirmations/index.ts

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1) Validate identity using caller's session
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await userClient.auth.getUser();

    if (userError || !user) {
      return jsonResponse({ error: "Invalid session" }, 401);
    }

    const userId = user.id;
    const userEmail = user.email;

    // 2) Admin client for the actual deletion
    const adminClient = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 3) Delete relational data via SQL function
    const { data: deleteData, error: deleteError } = await adminClient.rpc(
      "delete_user_data",
      { target_user_id: userId }
    );

    if (deleteError) {
      console.error("delete_user_data RPC error:", deleteError);
      return jsonResponse(
        {
          error: "Failed to delete user data",
          details: deleteError.message,
        },
        500
      );
    }

    // 4) Storage cleanup (best-effort, non-blocking).
    // Buckets confirmed in migration 20260320000017_storage_buckets.sql.
    // Convention: files live under `{user_id}/...` paths.
    try {
      const buckets = [
        "product-media",
        "verification-documents",
        "avatars",
        "chat-media",
        "review-media",
      ];
      for (const bucket of buckets) {
        const { data: files } = await adminClient.storage
          .from(bucket)
          .list(userId, { limit: 1000 });
        if (files && files.length > 0) {
          const paths = files.map((f) => `${userId}/${f.name}`);
          const { error: removeError } = await adminClient.storage
            .from(bucket)
            .remove(paths);
          if (removeError) {
            console.warn(
              `Storage cleanup failed for bucket "${bucket}":`,
              removeError
            );
          }
        }
      }
    } catch (storageErr) {
      console.warn("Storage cleanup non-fatal error:", storageErr);
    }

    // 5) Delete from auth.users (irrevocable)
    const { error: authDeleteError } =
      await adminClient.auth.admin.deleteUser(userId);

    if (authDeleteError) {
      console.error("auth.admin.deleteUser error:", authDeleteError);
      return jsonResponse(
        {
          error:
            "Datos eliminados, pero falló la baja en autenticación. Contacta a soporte.",
          details: authDeleteError.message,
        },
        500
      );
    }

    return jsonResponse({
      success: true,
      message: "Account and all associated data deleted successfully.",
      user_id: userId,
      email: userEmail,
      deleted_at: new Date().toISOString(),
      summary: deleteData?.summary,
    });
  } catch (err) {
    console.error("Unexpected error in delete-account:", err);
    return jsonResponse(
      {
        error: "Internal server error",
        details: err instanceof Error ? err.message : String(err),
      },
      500
    );
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
