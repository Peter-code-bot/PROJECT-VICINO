import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProfileForm } from "../profile-form";
import { ChevronLeft } from "lucide-react";
import Link from "next/link";

export const metadata = { title: "Editar perfil — VICINO" };

export default async function EditarPerfilPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/perfil/editar");

  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "nombre, email, foto, bio, ubicacion, es_vendedor, seller_type, nombre_negocio, descripcion_negocio, metodos_pago_aceptados, trust_level, user_id"
    )
    .eq("id", user.id)
    .single();

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 pb-24 md:pb-8 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-6">
        <Link
          href="/perfil"
          className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center hover:bg-accent transition-colors"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="text-xl font-heading font-bold">Editar perfil</h1>
      </div>
      <ProfileForm profile={profile} />
    </div>
  );
}
