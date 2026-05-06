import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DeleteAccountBody {
  confirmText?: string;
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json().catch(() => ({}))) as DeleteAccountBody;
    const { confirmText } = body;

    if (confirmText !== "ELIMINAR") {
      return NextResponse.json(
        { error: "Confirmación requerida. Escribe ELIMINAR para continuar." },
        { status: 400 }
      );
    }

    const supabase = await createClient();

    const {
      data: { session },
      error: sessionError,
    } = await supabase.auth.getSession();

    if (sessionError || !session) {
      return NextResponse.json(
        { error: "Sesión inválida. Inicia sesión nuevamente." },
        { status: 401 }
      );
    }

    const fnUrl = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/delete-account`;

    const fnResponse = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session.access_token}`,
        apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      },
    });

    const fnData = (await fnResponse.json()) as {
      error?: string;
      details?: string;
    };

    if (!fnResponse.ok) {
      return NextResponse.json(
        {
          error: fnData.error ?? "No se pudo eliminar la cuenta.",
          details: fnData.details,
        },
        { status: fnResponse.status }
      );
    }

    await supabase.auth.signOut();

    return NextResponse.json({
      success: true,
      message: "Cuenta eliminada exitosamente.",
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: "Error interno del servidor.",
        details: message,
      },
      { status: 500 }
    );
  }
}
