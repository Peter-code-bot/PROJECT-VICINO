"use server";

import OpenAI from "openai";
import { createClient } from "@/lib/supabase/server";

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
  "vigente": boolean, // true si tiene un sello actual, ciclo escolar actual, o no se ve expirada
  "confianza_porcentaje": number, // 0 a 100 de qué tan seguro estás
  "motivo_rechazo_o_duda": string | null // si confianza < 90 o no es válida, por qué?
}

Instrucción extra: El usuario dice que esta credencial es de la "${universityName}". Verifica si la credencial realmente pertenece a esa universidad o una de sus variantes.`;
  } else {
    // Es un INE
    prompt = `Eres un agente estricto de validación (KYC) para una aplicación en México.
Analiza esta imagen y retorna SOLO un JSON válido (sin backticks, texto crudo) con la siguiente estructura:
{
  "es_credencial_valida": boolean, // true si es un INE oficial de México, false si es otra cosa
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
    if (analysis.confianza_porcentaje >= 90 && analysis.es_credencial_valida && analysis.vigente) {
      finalStatus = "approved";
    } else if (!analysis.es_credencial_valida) {
      finalStatus = "rejected";
    }

    // Save to DB
    const { error: dbError } = await supabase
      .from("seller_verification")
      .update({
        status: finalStatus,
        document_type: documentType,
        university_name: universityName || null,
        ai_confidence_score: analysis.confianza_porcentaje,
        ai_analysis_raw: analysis
      })
      .eq("user_id", userId);

    if (dbError) {
      throw new Error("No se pudo guardar el análisis en la base de datos.");
    }

    return { success: true, status: finalStatus, analysis };
  } catch (error: any) {
    console.error("OpenAI Verification Error:", error);
    return { success: false, error: error.message || "Error al analizar la credencial." };
  }
}
