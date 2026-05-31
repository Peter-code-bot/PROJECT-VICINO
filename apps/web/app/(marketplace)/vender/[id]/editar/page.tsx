import { notFound, redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { ProductForm, type CategorySelection } from "../../product-form";

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
       delivery_radius_km, tipo_entrega, estado, color, precio_negociable, allow_appointments,
       appointment_start_time, appointment_end_time, appointment_duration_minutes,
       imagen_principal, galeria_imagenes`,
    )
    .eq("id", id)
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .maybeSingle();

  if (!product) notFound();

  // MP#08 #5c-2: leemos las categorias del pivote (joineamos categories.slug)
  // para pre-poblar el form multi-select. Tras el backfill de 5c-1 cada
  // producto tiene exactamente 1 fila con is_primary=true, asi que el form
  // abre con esa categoria pre-seleccionada y el seller puede agregar 0-2
  // secundarias. El ORDER BY trae la primary al inicio (D9 retrocompat).
  const { data: pivotRows } = await supabase
    .from("product_categories")
    .select("is_primary, categories!inner(slug)")
    .eq("product_id", product.id)
    .order("is_primary", { ascending: false });

  let initialCategories: CategorySelection[] = (pivotRows ?? [])
    .map((r) => {
      const cat = r.categories as unknown as { slug: string } | { slug: string }[];
      const slug = Array.isArray(cat) ? cat[0]?.slug : cat?.slug;
      return slug ? { slug, is_primary: Boolean(r.is_primary) } : null;
    })
    .filter((c): c is CategorySelection => c !== null);

  // D9 fallback: caso borde improbable post-29ccefe en que el pivote este
  // vacio para un producto existente. Usamos categoria TEXT como semilla
  // marcandola primary, y reportamos a Sentry para visibilidad.
  if (initialCategories.length === 0) {
    Sentry.captureMessage(
      `editar fallback: product ${product.id} sin filas en product_categories, usando categoria TEXT como seed`,
      {
        level: "warning",
        tags: { action: "editarProductPage", step: "pivot_fallback" },
        contexts: {
          product: { id: product.id, categoria: product.categoria },
        },
      },
    );
    initialCategories = [{ slug: product.categoria, is_primary: true }];
  }

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
          categories: initialCategories,
          ubicacion: product.ubicacion,
          delivery_radius_km: product.delivery_radius_km,
          tipo_entrega: product.tipo_entrega,
          estado: product.estado ?? null,
          color: product.color ?? null,
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
