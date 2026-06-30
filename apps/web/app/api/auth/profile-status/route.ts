import { createClient } from "@/lib/supabase/server";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  try {
    const supabase = await createClient();
    
    // 1. Obtener la sesión actual usando las cookies (que el SW no bloquea)
    const { data: { session }, error: authError } = await supabase.auth.getSession();
    
    if (authError || !session?.user) {
      return NextResponse.json({ error: "No autorizado", has_seen_onboarding: false }, { status: 401 });
    }

    // 2. Consultar la base de datos desde el servidor (esto sabemos que funciona por layout.tsx)
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("has_seen_onboarding")
      .eq("id", session.user.id)
      .single();

    if (profileError) {
      // Si el trigger aún no ha creado el perfil, devolver 404 para que el cliente reintente
      if (profileError.code === "PGRST116") {
        return NextResponse.json({ error: "Perfil no encontrado (aún)", has_seen_onboarding: false }, { status: 404 });
      }
      return NextResponse.json({ error: profileError.message, has_seen_onboarding: false }, { status: 500 });
    }

    return NextResponse.json({ 
      has_seen_onboarding: profile?.has_seen_onboarding ?? false 
    });

  } catch (error: any) {
    return NextResponse.json({ error: error.message, has_seen_onboarding: false }, { status: 500 });
  }
}
