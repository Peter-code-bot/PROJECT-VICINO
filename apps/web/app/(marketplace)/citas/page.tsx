import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CitasList } from "@/components/appointments/citas-list";

export const metadata = { title: "Mis citas — VICINO" };

export default async function CitasPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/citas");

  const { data: appointments } = await supabase
    .from("appointments")
    .select(`
      id, appointment_date, appointment_start, appointment_end, status, notes,
      buyer_id, seller_id,
      products_services(id, titulo, imagen_principal, precio),
      buyer:profiles!buyer_id(id, nombre, foto, es_vendedor, seller_type, nombre_negocio),
      seller:profiles!seller_id(id, nombre, foto, es_vendedor, seller_type, nombre_negocio)
    `)
    .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
    .order("appointment_date", { ascending: true })
    .order("appointment_start", { ascending: true });

  return (
    <div className="max-w-3xl mx-auto px-4 py-6">
      <h1 className="text-2xl font-heading font-bold text-foreground mb-1">Mis citas</h1>
      <p className="text-sm text-muted-foreground mb-6">Citas agendadas o recibidas en tus servicios</p>
      <CitasList appointments={appointments ?? []} currentUserId={user.id} />
    </div>
  );
}
