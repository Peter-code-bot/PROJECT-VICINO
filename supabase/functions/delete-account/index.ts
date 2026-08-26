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
    const supabasePublishableKey = Deno.env.get("SB_PUBLISHABLE_KEY")!;
    const supabaseSecretKey = Deno.env.get("SB_SECRET_KEY")!;

    // 1) Validate identity using caller's session
    const userClient = createClient(supabaseUrl, supabasePublishableKey, {
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
    const adminClient = createClient(supabaseUrl, supabaseSecretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 2b) Recolectar las rutas de review-media ANTES de borrar nada.
    //
    // Este bucket NO sigue la convencion {user_id}/... como los otros cuatro:
    // sus archivos se guardan bajo {saleConfirmationId}/ (ver
    // apps/web/app/(account)/historial/review/review-form.tsx). El barrido de
    // abajo listaba por userId, asi que en review-media NUNCA encontraba nada
    // y las fotos de resena de quien borraba su cuenta se quedaban para
    // siempre. En produccion hay una asi.
    //
    // Y va AQUI y no en el paso 4 por orden: delete_user_data borra las filas
    // de sale_confirmations, asi que despues de ese paso ya no hay forma de
    // saber que carpetas eran suyas.
    const carpetasDeResenas: string[] = [];
    try {
      const { data: ventas } = await adminClient
        .from("sale_confirmations")
        .select("id")
        .or(`buyer_id.eq.${userId},seller_id.eq.${userId}`);
      for (const v of ventas ?? []) carpetasDeResenas.push(v.id as string);
    } catch (e) {
      console.warn("No se pudieron listar las ventas para limpiar review-media:", e);
    }

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
      // Deja constancia de lo que NO se pudo borrar.
      //
      // Antes esto era un console.warn y nada mas. Justo despues se borra la
      // cuenta de auth.users, que es irreversible, asi que a partir de ese
      // momento el archivo queda huerfano y sin ninguna forma de encontrarlo:
      // ni usuario del que colgarlo, ni fila que lo referencie, ni registro de
      // que fallo. Los 31 archivos huerfanos que hay hoy en produccion
      // llegaron exactamente por ahi.
      const anotarFallo = async (bucket: string, path: string, motivo: string) => {
        try {
          await adminClient.from("storage_cleanup_pending").insert({
            bucket,
            path,
            former_user_id: userId,
            motivo: motivo.slice(0, 500),
          });
        } catch (e) {
          // Si ni siquiera se puede anotar, al menos que salga en el log.
          console.error(`No se pudo registrar la limpieza pendiente ${bucket}/${path}:`, e);
        }
      };

      const borrarCarpeta = async (bucket: string, carpeta: string) => {
        const { data: files, error: listError } = await adminClient.storage
          .from(bucket)
          .list(carpeta, { limit: 1000 });

        if (listError) {
          await anotarFallo(bucket, `${carpeta}/`, `list: ${listError.message}`);
          return;
        }
        if (!files || files.length === 0) return;

        const paths = files.map((f) => `${carpeta}/${f.name}`);
        const { error: removeError } = await adminClient.storage
          .from(bucket)
          .remove(paths);

        if (removeError) {
          console.warn(`Storage cleanup failed for "${bucket}/${carpeta}":`, removeError);
          for (const path of paths) {
            await anotarFallo(bucket, path, `remove: ${removeError.message}`);
          }
        }
      };

      // Los cuatro buckets que SI usan la convencion {user_id}/...
      for (const bucket of [
        "product-media",
        "verification-documents",
        "avatars",
        "chat-media",
      ]) {
        await borrarCarpeta(bucket, userId);
      }

      // review-media va por {saleConfirmationId}/, recolectados en el paso 2b.
      for (const carpeta of carpetasDeResenas) {
        await borrarCarpeta("review-media", carpeta);
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
