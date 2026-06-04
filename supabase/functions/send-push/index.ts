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

serve(async (req) => {
  // Manejar solicitudes CORS (preflight)
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const payload: WebhookPayload = await req.json();

    // 1. Validar que la tabla sea messages
    if (payload.table !== "messages" || payload.type !== "INSERT") {
      return new Response(JSON.stringify({ error: "Unsupported table/event" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const message = payload.record;
    
    // Si el mensaje es del sistema, ignorar o procesar diferente
    if (!message.autor_id) {
        return new Response(JSON.stringify({ ignored: true, reason: "System message" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
    }

    // 2. Obtener el FCM token del destinatario desde Supabase
    const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Buscar el chat para saber quién es el otro participante
    const { data: chat } = await supabase
      .from("chats")
      .select("comprador_id, vendedor_id")
      .eq("id", message.chat_id)
      .single();

    if (!chat) {
        return new Response(JSON.stringify({ error: "Chat not found" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 404,
        });
    }

    // El destinatario es el que NO es el autor del mensaje
    const receiverId = message.autor_id === chat.comprador_id ? chat.vendedor_id : chat.comprador_id;

    // Obtener el perfil del destinatario
    const { data: profile } = await supabase
      .from("profiles")
      .select("fcm_token, nombre")
      .eq("id", receiverId)
      .single();

    if (!profile || !profile.fcm_token) {
        return new Response(JSON.stringify({ ignored: true, reason: "User has no FCM token" }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
            status: 200, // OK pero no se hizo nada
        });
    }

    // 3. Enviar Push Notification vía Firebase Cloud Messaging (FCM HTTP v1 API)
    // Extraemos la cuenta de servicio desde las variables de entorno
    const serviceAccountRaw = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (!serviceAccountRaw) {
        throw new Error("Missing FIREBASE_SERVICE_ACCOUNT environment variable");
    }

    const serviceAccount = JSON.parse(serviceAccountRaw);
    
    // Obtener el access token OAuth2 para FCM
    // Como estamos en Deno, usaremos un JWT firmado a mano para pedir el access_token a Google
    const token = await getGoogleAccessToken(serviceAccount);

    // Enviar el payload a FCM
    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`;
    
    const fcmPayload = {
      message: {
        token: profile.fcm_token,
        notification: {
          title: "Nuevo mensaje en Vicino",
          body: message.texto || "Tienes un nuevo mensaje",
        },
        data: {
          url: `/chat/${message.chat_id}`, // Deep link
          chatId: message.chat_id
        }
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

    return new Response(JSON.stringify({ success: true, messageId: message.id }), {
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
