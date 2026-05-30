import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "../../product-form";

export const metadata = { title: "Editar publicación" };

interface Props {
  params: Promise<{ id: string }>;
}

export default async function EditarPublicacionPage({ params }: Props) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/vender/${id}/editar`);

  // Defense in depth: explicit creador_id filter PLUS the RLS SELECT policy.
  // .neq("eliminado") ensures soft-deleted products cannot be edited even by
  // their owner — the listings page filters them out too.
  const { data: product } = await supabase
    .from("products_services")
    .select(
      `id, titulo, descripcion, precio, tipo, categoria, ubicacion,
       delivery_radius_km, tipo_entrega, estado, precio_negociable, allow_appointments,
       appointment_start_time, appointment_end_time, appointment_duration_minutes,
       imagen_principal, galeria_imagenes`,
    )
    .eq("id", id)
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .maybeSingle();

  if (!product) notFound();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-8">
      <h1 className="mb-6 text-2xl font-heading font-bold">Editar publicación</h1>
      <ProductForm
        mode="edit"
        initialValues={{
          id: product.id,
          titulo: product.titulo,
          descripcion: product.descripcion,
          precio: Number(product.precio),
          tipo: product.tipo,
          categoria: product.categoria,
          ubicacion: product.ubicacion,
          delivery_radius_km: product.delivery_radius_km,
          tipo_entrega: product.tipo_entrega,
          estado: product.estado ?? null,
          precio_negociable: product.precio_negociable ?? false,
          allow_appointments: product.allow_appointments ?? false,
          appointment_start_time: product.appointment_start_time,
          appointment_end_time: product.appointment_end_time,
          appointment_duration_minutes: product.appointment_duration_minutes,
          imagen_principal: product.imagen_principal,
          galeria_imagenes: product.galeria_imagenes ?? [],
        }}
      />
    </div>
  );
}
