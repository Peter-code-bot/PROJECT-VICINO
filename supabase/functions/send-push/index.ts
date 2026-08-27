import { serve } from "https://deno.land/std@0.192.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  record: any;
  schema: "public";
  old_record: null | any;
}

/**
 * Comparacion en tiempo constante.
 *
 * Comparar secretos con === se rinde en el primer byte distinto, y esa
 * diferencia de tiempo es medible desde fuera. Aqui el atacante controla el
 * bearer y puede pedir todas las veces que quiera, que es justo el escenario
 * donde eso deja de ser teorico.
 */
function igualEnTiempoConstante(a: string, b: string): boolean {
  const ba = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (ba.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < ba.length; i++) diff |= ba[i] ^ bb[i];
  return diff === 0;
}

serve(async (req) => {
  // Manejar solicitudes CORS (preflight)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // LA PUERTA, QUE NO EXISTIA.
  //
  // Esta funcion esta desplegada con verify_jwt apagado, asi que la pasarela
  // no comprueba nada, y el cuerpo tampoco comprobaba nada: leia el JSON y
  // pasaba directo a consultar la base con la llave service_role.
  //
  // Comprobado contra produccion el 27-ago-2026, sin ninguna cabecera de
  // autorizacion:
  //
  //   POST /functions/v1/send-push  ->  500 {"error":"Chat not found"}
  //   POST /functions/v1/expire-confirmations -> 401 {"error":"unauthorized"}
  //
  // Ese "Chat not found" solo se puede generar DESPUES de consultar
  // public.chats con la service_role. O sea que la peticion anonima ejecuto el
  // cuerpo entero. Quien conozca un chat_id y un autor_id reales -- y los
  // conoce cualquiera de los dos participantes de un chat -- podia mandar una
  // notificacion push con el texto que quisiera a la pantalla de bloqueo de la
  // otra persona. Es un vector de phishing, no solo ruido.
  //
  // Se valida contra el mismo bearer que ya mandan los triggers: las funciones
  // call_send_push_* envian 'Bearer ' || vault.decrypted_secrets.service_role_key
  // (ver migracion 20260826090000). PUSH_WEBHOOK_SECRET es la salida por si se
  // prefiere un secreto propio en vez de reutilizar la llave de servicio.
  //
  // NO falla abierto si no hay secreto configurado. Un guardian que se aparta
  // cuando no sabe que hacer no es un guardian, y de eso ya hubo bastante hoy:
  // delete_user_data borraba cuentas de cualquiera exactamente por eso.
  const esperados = [
    Deno.env.get("PUSH_WEBHOOK_SECRET"),
    Deno.env.get("SB_SECRET_KEY"),
  ].filter((s): s is string => typeof s === "string" && s.length > 0);

  if (esperados.length === 0) {
    console.error("send-push: ni PUSH_WEBHOOK_SECRET ni SB_SECRET_KEY configurados");
    return new Response(JSON.stringify({ error: "not configured" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }

  const bearer = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!bearer || !esperados.some((s) => igualEnTiempoConstante(bearer, s))) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 401,
    });
  }

  try {
    const payload: WebhookPayload = await req.json();

    const allowedTables = ["messages", "appointments", "sale_confirmations"];
    if (!allowedTables.includes(payload.table) || payload.type !== "INSERT") {
      return new Response(JSON.stringify({ error: "Unsupported table/event" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SB_SECRET_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    let receiverId: string | null = null;
    let pushTitle = "Nueva Notificación";
    let pushBody = "Tienes una nueva actualización en Vicino.";
    let pushUrl = "/";
    let targetId = payload.record.id; // Just for logging/response

    if (payload.table === "messages") {
        const message = payload.record;
        if (!message.autor_id) {
            return new Response(JSON.stringify({ ignored: true, reason: "System message" }), {
                headers: { ...corsHeaders, "Content-Type": "application/json" },
            });
        }
        const { data: chat } = await supabase
          .from("chats")
          .select("comprador_id, vendedor_id")
          .eq("id", message.chat_id)
          .single();

        if (!chat) throw new Error("Chat not found");

        receiverId = message.autor_id === chat.comprador_id ? chat.vendedor_id : chat.comprador_id;
        pushTitle = "Nuevo mensaje en Vicino";
        pushBody = message.texto || "Tienes un nuevo mensaje";
        pushUrl = `/chat/${message.chat_id}`;

    } else if (payload.table === "appointments") {
        const appointment = payload.record;
        // INSERT en appointments lo dispara el comprador desde
        // appointment-scheduler.tsx → notificar al vendedor (seller_id).
        receiverId = appointment.seller_id;
        pushTitle = "¡Nueva solicitud de cita!";
        pushBody = "Alguien ha solicitado reservar un servicio contigo.";
        pushUrl = `/citas`;

    } else if (payload.table === "sale_confirmations") {
        const sale = payload.record;
        // Notificamos al que NO inició la confirmación
        receiverId = sale.initiated_by === sale.buyer_id ? sale.seller_id : sale.buyer_id;
        pushTitle = "Confirmación de Venta";
        pushBody = "Un usuario quiere confirmar la venta de un producto.";
        if (sale.chat_id) {
            pushUrl = `/chat/${sale.chat_id}`;
        } else {
            pushUrl = `/historial`;
        }
    }

    if (!receiverId) {
        return new Response(JSON.stringify({ error: "Could not determine receiverId" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 400,
        });
    }

    // Obtener el perfil del destinatario
    const { data: profile } = await supabase
      .from("profiles")
      .select("fcm_token, nombre")
      .eq("id", receiverId)
      .single();

    if (!profile || !profile.fcm_token) {
        return new Response(JSON.stringify({ ignored: true, reason: "User has no FCM token" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200, 
        });
    }

    // 3. Enviar Push Notification vía Firebase Cloud Messaging (FCM HTTP v1 API)
    const serviceAccountRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!serviceAccountRaw) throw new Error("Missing FIREBASE_SERVICE_ACCOUNT environment variable");

    const serviceAccount = JSON.parse(serviceAccountRaw);
    const token = await getGoogleAccessToken(serviceAccount);

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    
    const fcmPayload = {
      message: {
        token: profile.fcm_token,
        notification: {
          title: pushTitle,
          body: pushBody,
        },
        data: {
          url: pushUrl,
          recordId: targetId
        },
        android: {
          priority: 'high',
          notification: {
            channel_id: 'default',
          },
        },
        apns: {
          headers: {
            'apns-priority': '10',
            'apns-push-type': 'alert',
          },
          payload: {
            aps: {
              alert: {
                title: pushTitle,
                body: pushBody,
              },
              sound: 'default',
              badge: 1,
              'content-available': 1,
            },
          },
        },
      }
    };

    const response = await fetch(fcmUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(fcmPayload),
    });

    if (!response.ok) {
        const errObj = await response.json();
        console.error("FCM Error", JSON.stringify(errObj));
        throw new Error("FCM request failed");
    }

    return new Response(JSON.stringify({ success: true, targetId }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    console.error(error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});

// Helper para generar el Access Token OAuth2 para Firebase en Deno
async function getGoogleAccessToken(serviceAccount: any) {
    // Implementación usando Web Crypto API pura en Deno para crear el JWT de Google
    const header = {
        alg: "RS256",
        typ: "JWT",
        kid: serviceAccount.private_key_id
    };
    
    const now = Math.floor(Date.now() / 1000);
    const claim = {
        iss: serviceAccount.client_email,
        sub: serviceAccount.client_email,
        aud: "https://oauth2.googleapis.com/token",
        iat: now,
        exp: now + 3600,
        scope: "https://www.googleapis.com/auth/cloud-platform"
    };

    const encoder = new TextEncoder();
    const base64UrlEncode = (obj: any) => btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    
    const unsignedToken = `${base64UrlEncode(header)}.${base64UrlEncode(claim)}`;
    
    // Importar la llave privada
    const pemHeader = "-----BEGIN PRIVATE KEY-----";
    const pemFooter = "-----END PRIVATE KEY-----";
    const pemContents = serviceAccount.private_key.substring(
        serviceAccount.private_key.indexOf(pemHeader) + pemHeader.length,
        serviceAccount.private_key.indexOf(pemFooter)
    ).replace(/\s/g, '');
    
    const binaryDerString = atob(pemContents);
    const binaryDer = new Uint8Array(binaryDerString.length);
    for (let i = 0; i < binaryDerString.length; i++) {
        binaryDer[i] = binaryDerString.charCodeAt(i);
    }
    
    const key = await crypto.subtle.importKey(
        "pkcs8",
        binaryDer,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"]
    );
    
    // Firmar
    const signature = await crypto.subtle.sign(
        "RSASSA-PKCS1-v1_5",
        key,
        encoder.encode(unsignedToken)
    );
    
    const signedBase64 = btoa(String.fromCharCode(...new Uint8Array(signature)))
        .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
        
    const jwt = `${unsignedToken}.${signedBase64}`;
    
    // Solicitar el access_token
    const res = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`
    });
    
    const data = await res.json();
    if (data.error) throw new Error(data.error_description || data.error);
    return data.access_token;
}
