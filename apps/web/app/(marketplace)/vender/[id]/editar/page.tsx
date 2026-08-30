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
      `id, titulo, descripcion, precio, modo_precio, tipo, categoria, ubicacion,
       delivery_radius_km, tipo_entrega, estado, color, precio_negociable, allow_appointments,
       appointment_start_time, appointment_end_time, appointment_duration_minutes,
       imagen_principal, galeria_imagenes`,
    )
    .eq("id", id)
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .maybeSingle();

  if (!product) notFound();

  // Las coordenadas van por RPC y no en el SELECT de arriba: ubicacion_geo es
  // de tipo geography y PostgREST la devuelve en binario hexadecimal, que
  // habria que interpretar en TypeScript. En todo el repo no hay hoy ni un
  // lector de esa columna desde el cliente, asi que no hay patron probado que
  // copiar. get_product_location la devuelve ya en lat/lng, y comprueba
  // propiedad por dentro.
  //
  // Sin esto, el vendedor abria "Editar publicacion" y veia un buscador vacio
  // y ningun mapa, como si nunca hubiera puesto ubicacion. El dato no se
  // perdia (vender/actions.ts solo toca ubicacion_geo si llegan coordenadas),
  // pero para mover el marcador tenia que buscar su direccion desde cero.
  const { data: coords } = await supabase.rpc("get_product_location", {
    p_product_id: id,
  });
  const ubicacion = Array.isArray(coords) ? coords[0] : null;

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
      // Aqui habia un `as unknown as { slug: string } | { slug: string }[]`.
      // Ya no hace falta: con el generic Database puesto, el cliente infiere
      // solo `{ slug: string }` para el embed `categories!inner(slug)`. El
      // doble cast era justo lo que impedia ver esa inferencia; el ternario de
      // abajo se queda como defensa en runtime, pero ya no lo sostiene un cast.
      const cat = r.categories;
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
    <div className="mx-auto max-w-2xl px-4 py-6 md:py-10">
      <ProductForm
        userId={user.id}
        mode="edit"
        initialValues={{
          id: product.id,
          titulo: product.titulo,
          descripcion: product.descripcion,
          precio: product.precio == null ? null : Number(product.precio),
          modo_precio: product.modo_precio ?? "precio",
          tipo: product.tipo,
          categories: initialCategories,
          ubicacion: product.ubicacion,
          delivery_radius_km: product.delivery_radius_km,
          ubicacion_lat: ubicacion?.lat ?? null,
          ubicacion_lng: ubicacion?.lng ?? null,
          // tipo_entrega admite NULL en la tabla (filas anteriores al DEFAULT).
          // El respaldo es 'punto_encuentro' porque es exactamente lo que ya
          // usan los dos vecinos: el DEFAULT de la columna desde
          // 20260411000003 y el defaultValue del propio <select> del form. Si
          // aqui llegara null, el select abriria en su primera opcion y una
          // edicion inocente reescribiria la entrega sin que nadie la tocara.
          tipo_entrega: product.tipo_entrega ?? "punto_encuentro",
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
