"use server";

import OpenAI from "openai";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

export async function verifyDocument(
  path: string, 
  documentType: "INE" | "Credencial Universitaria",
  universityName?: string
) {
  if (!process.env.OPENAI_API_KEY) {
    console.warn("OPENAI_API_KEY no está configurada. Pasando a revisión manual por defecto.");
    return { success: true, status: "pending", fallback: true };
  }

  // 1. Initialize OpenAI
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  
  // 2. Fetch the image from Supabase Storage
  const supabase = await createClient();
  const { data: userResponse, error: authError } = await supabase.auth.getUser();
  
  if (authError || !userResponse?.user) {
    throw new Error("No autenticado");
  }
  const userId = userResponse.user.id;

  const { data: profile } = await supabase
    .from("profiles")
    .select("nombre")
    .eq("id", userId)
    .single();

  const userName = profile?.nombre || "Usuario Desconocido";

  const { data: fileData, error: fileError } = await supabase.storage
    .from("verification-documents")
    .download(path);

  if (fileError || !fileData) {
    throw new Error("No se pudo descargar la imagen para verificarla.");
  }

  // Convert blob to base64
  const arrayBuffer = await fileData.arrayBuffer();
  const base64Data = Buffer.from(arrayBuffer).toString("base64");
  const mimeType = fileData.type || "image/jpeg";

  // 3. Call OpenAI
  const imageUrl = `data:${mimeType};base64,${base64Data}`;

  let prompt = "";
  if (documentType === "Credencial Universitaria") {
    prompt = `Eres un agente estricto de validación (KYC) para una aplicación en México.
Analiza esta imagen y retorna SOLO un JSON válido (sin backticks, texto crudo) con la siguiente estructura:
{
  "es_credencial_valida": boolean, // true si es una credencial de estudiante real, false si es un perro, meme, INE, etc.
  "nombre_universidad": string | null, // el nombre de la universidad que aparece en la credencial
  "el_nombre_coincide": boolean, // true si al menos un nombre o un apellido de "${userName}" coincide con lo que aparece en la credencial. No exijas coincidencia exacta completa: basta con que la mayoría del nombre registrado (un nombre + un apellido, o ambos apellidos) se encuentren visibles en el documento. Solo marca false si no hay NINGUNA relación entre ambos nombres.
  "vigente": boolean, // true si tiene un sello actual, ciclo escolar actual, o no se ve expirada
  "confianza_porcentaje": number, // 0 a 100 de qué tan seguro estás
  "motivo_rechazo_o_duda": string | null // si confianza < 90 o no es válida, por qué?
}

Instrucción extra: El usuario dice que esta credencial es de la "${universityName}". Verifica si la credencial realmente pertenece a esa universidad o una de sus variantes. Verifica que la credencial pertenezca razonablemente a "${userName}". Acepta variaciones como nombres incompletos, un solo apellido, o nombre sin segundo nombre. Solo rechaza si el nombre en el documento NO tiene ninguna relación con el nombre registrado.`;
  } else {
    // Es un INE
    prompt = `Eres un agente estricto de validación (KYC) para una aplicación en México.
Analiza esta imagen y retorna SOLO un JSON válido (sin backticks, texto crudo) con la siguiente estructura:
{
  "es_credencial_valida": boolean, // true si es un INE oficial de México, false si es otra cosa
  "el_nombre_coincide": boolean, // true si al menos un nombre o un apellido de "${userName}" coincide con lo que aparece en el INE. No exijas coincidencia exacta completa: basta con que la mayoría del nombre registrado (un nombre + un apellido, o ambos apellidos) se encuentren visibles en el documento. Solo marca false si no hay NINGUNA relación entre ambos nombres.
  "vigente": boolean, // true si no está vencida
  "confianza_porcentaje": number, // 0 a 100
  "motivo_rechazo_o_duda": string | null
}`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: imageUrl } },
          ],
        },
      ],
      response_format: { type: "json_object" },
    });

    const responseText = response.choices[0]?.message?.content || "{}";
    const analysis = JSON.parse(responseText);

    let finalStatus = "pending";

    // Evaluate rules
    if (analysis.confianza_porcentaje >= 90 && analysis.es_credencial_valida && analysis.vigente && analysis.el_nombre_coincide) {
      finalStatus = "approved";
    } else if (!analysis.es_credencial_valida || !analysis.el_nombre_coincide) {
      finalStatus = "rejected";
    }

    // La IA se dispara al subir la foto FRONTAL, que suele ser la primera de las
    // tres. Sin este freno podia aprobar una identidad con el reverso y la
    // selfie todavia sin subir — es el item 47 de la lista.
    //
    // La regla vive tambien en la base (trigger guard_verification_approval, en
    // 20260826230000), que es el guardian de verdad. Aqui se comprueba antes
    // para degradar a 'pending' con sentido, en vez de chocar contra el trigger
    // y devolverle a la persona un error cuando lo unico que pasa es que le
    // faltan fotos.
    if (finalStatus === "approved") {
      const { data: fila } = await supabase
        .from("seller_verification")
        .select("ine_back_url, selfie_url")
        .eq("user_id", userId)
        .eq("ine_front_url", path)
        .maybeSingle();

      if (!fila?.ine_back_url || !fila?.selfie_url) {
        finalStatus = "pending";
      }
    }

    // Save to DB
    // user_id NO es unico en seller_verification: la tabla solo tiene PK sobre
    // id y un indice NO unico sobre user_id, y la pagina lee con
    // `.order("created_at", desc).limit(1)` porque el historial multi-fila es el
    // diseno. Un `.eq("user_id")` a secas escribiria el veredicto en TODAS las
    // filas del vendedor, incluida la vieja ya rechazada. `path` es el
    // ine_front_url que el cliente acaba de guardar, asi que ancla el UPDATE al
    // documento que realmente analizamos.
    // El veredicto se escribe con el cliente ADMIN, no con la sesion del
    // usuario, y no es un detalle de implementacion: es lo que impide que el
    // vendedor se apruebe solo.
    //
    // La policy "Users can update own verification" tiene USING pero no
    // WITH CHECK, y `status` era escribible por `authenticated`. Comprobado
    // contra produccion en una transaccion revertida: un usuario normal podia
    // hacer UPDATE ... SET status='approved' sobre su propia fila y quedarse con
    // la insignia de verificado sin presentar documento valido. La migracion
    // 20260826150000 revoca esas columnas.
    //
    // Un RPC no habria servido: el veredicto lo decide un modelo externo, asi
    // que la base no puede recomputarlo ni distinguir "lo calculo el servidor"
    // de "lo mando el cliente". La unica frontera real es que la escritura
    // ocurra con una credencial que el navegador nunca ve.
    const admin = createAdminClient();
    const { data: updated, error: dbError } = await admin
      .from("seller_verification")
      .update({
        status: finalStatus,
        document_type: documentType,
        university_name: universityName || null,
        ai_confidence_score: analysis.confianza_porcentaje,
        ai_analysis_raw: analysis
      })
      .eq("user_id", userId)
      .eq("ine_front_url", path)
      .select("id");

    if (dbError) {
      // Sentry SIEMPRE antes del return: el `details` de Postgres es donde el
      // motor nombra la columna o la policy que rechazo, y perderlo es lo que
      // encarecio los diagnosticos anteriores.
      Sentry.captureException(dbError, {
        tags: { action: "verifyDocument", step: "update_seller_verification" },
        contexts: {
          verification: { userId, documentType, finalStatus },
          supabase: { code: dbError.code },
        },
      });
      return { success: false, error: "No se pudo guardar el resultado de la revisión. Intenta de nuevo en un momento." };
    }

    // Un UPDATE de 0 filas no es un error en PostgREST (204 sin cuerpo): sin
    // este chequeo la interfaz anunciaba "verificado" con la base intacta.
    if (!updated || updated.length === 0) {
      Sentry.captureException(
        new Error("verifyDocument: el UPDATE de seller_verification afecto 0 filas"),
        {
          tags: { action: "verifyDocument", step: "update_seller_verification" },
          contexts: {
            verification: { userId, documentType, finalStatus, path },
          },
        },
      );
      return { success: false, error: "No encontramos el documento que acabas de subir. Vuélvelo a subir para completar tu verificación." };
    }

    return { success: true, status: finalStatus, analysis };
  } catch (error: any) {
    console.error("OpenAI Verification Error:", error);
    return { success: false, error: error.message || "Error al analizar la credencial." };
  }
}
