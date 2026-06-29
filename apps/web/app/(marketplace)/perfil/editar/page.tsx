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

  const { data: profileData, error } = await supabase
    .from("profiles")
    .select(
      "nombre, foto, bio, ubicacion, es_vendedor, seller_type, nombre_negocio, descripcion_negocio, metodos_pago_aceptados, trust_level, user_id"
    )
    .eq("id", user.id)
    .single();

  if (error) {
    console.error("[EditarPerfilPage] Error fetching profile:", error);
  }

  const profile = profileData ? { ...profileData, email: user.email ?? "" } : null;

  // Phase 9: count active (disponible) products so the form can warn the user
  // before turning seller mode off — those products will be auto-paused.
  const { count: activeProductCount } = await supabase
    .from("products_services")
    .select("id", { count: "exact", head: true })
    .eq("creador_id", user.id)
    .eq("estatus", "disponible");

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
      <ProfileForm profile={profile} activeProductCount={activeProductCount ?? 0} />
    </div>
  );
}
