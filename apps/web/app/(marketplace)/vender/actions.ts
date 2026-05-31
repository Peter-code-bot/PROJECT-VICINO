"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { createProductSchema, updateProductSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { cleanupRemovedMedia } from "@/lib/media/cleanup";
import { VIDEO_EXT_RE } from "@/lib/video-thumbnail";
import type { MediaAssetInsert } from "@vicino/shared";

// Best-effort dual-write helper for the product_categories pivot.
//
// MP#08 #5c-2: now writes N rows (1..3) with an explicit is_primary flag
// per row. The previous single-row signature shipped in 1b (d95f1a5) is
// replaced; the helper deletes all rows for the product and re-inserts
// the new set in two phases (primary first, then secondaries) so the
// partial unique index from 5c-1 validates against an empty state first.
//
// Failures (RLS, network, supabase outage, orphan slug) are captured to
// Sentry and the caller is NOT aborted because products_services.categoria
// TEXT (mirror of the primary slug, updated by the caller) is still the
// canonical render source during coexistence (drop is #4 future).
async function syncProductCategoriesForProduct(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    productId: string;
    categories: ReadonlyArray<{ slug: string; is_primary: boolean }>;
    mode: "create" | "update";
  },
): Promise<void> {
  const { productId, categories, mode } = args;

  if (mode === "update") {
    const { error: deleteErr } = await supabase
      .from("product_categories")
      .delete()
      .eq("product_id", productId);
    if (deleteErr) {
      Sentry.captureException(deleteErr, {
        tags: { action: "syncProductCategories", step: "delete" },
        contexts: {
          product: { id: productId },
          supabase: { code: deleteErr.code },
        },
      });
      return;
    }
  }

  if (categories.length === 0) return;

  // Batch lookup: 1 query resolves N slugs to ids. Normalized to lowercase
  // (mirror of the 1b fc846a3 mitigation) even though the zod validator
  // already rejects non-canonical slugs.
  const slugsLower = categories.map((c) => c.slug.toLowerCase());
  const { data: catRows, error: lookupErr } = await supabase
    .from("categories")
    .select("id, slug")
    .in("slug", slugsLower);

  if (lookupErr) {
    Sentry.captureException(lookupErr, {
      tags: { action: "syncProductCategories", step: "category_slug_lookup" },
      contexts: {
        product: { id: productId },
        category: { slugs: slugsLower.join(",") },
        supabase: { code: lookupErr.code },
      },
    });
    return;
  }

  const slugToId = new Map<string, string>(
    (catRows ?? []).map((r) => [r.slug as string, r.id as string]),
  );

  // Detect orphan slugs (validator would have caught them at parse time,
  // so this is defense in depth for alternative write paths).
  const orphans = slugsLower.filter((s) => !slugToId.has(s));
  if (orphans.length > 0) {
    Sentry.captureMessage(
      `product_categories sync miss: ${orphans.length} slug(s) not in categories: ${orphans.join(",")}`,
      {
        level: "warning",
        tags: { action: "syncProductCategories", step: "category_slug_lookup_miss" },
        contexts: { product: { id: productId } },
      },
    );
  }

  // Order matters: insert the primary first so the partial unique index
  // (5c-1 idx_product_categories_one_primary WHERE is_primary = true)
  // validates against an empty state. Then the secondaries (is_primary=false)
  // do not touch the partial index.
  const rows = categories
    .map((c) => {
      const id = slugToId.get(c.slug.toLowerCase());
      return id
        ? { product_id: productId, categoria_id: id, is_primary: c.is_primary }
        : null;
    })
    .filter((r): r is { product_id: string; categoria_id: string; is_primary: boolean } => r !== null)
    .sort((a, b) => Number(b.is_primary) - Number(a.is_primary));

  if (rows.length === 0) return;

  const { error: insertErr } = await supabase
    .from("product_categories")
    .insert(rows);
  if (insertErr) {
    Sentry.captureException(insertErr, {
      tags: { action: "syncProductCategories", step: "insert", mode },
      contexts: {
        product: { id: productId },
        category: { count: rows.length },
        supabase: { code: insertErr.code },
      },
    });
  }
}

// Helper to extract the primary slug from a categories array. The zod
// validator guarantees exactly one primary exists when the array is non-
// empty, so this returns the slug or null (for safety, never throws).
function primarySlug(
  categories: ReadonlyArray<{ slug: string; is_primary: boolean }>,
): string | null {
  return categories.find((c) => c.is_primary)?.slug ?? null;
}

// Best-effort dual-write helper: inserts gallery URLs into media_assets
// alongside galeria_imagenes during MP#07 #7-5b coexistence. A failure here
// (RLS, network, supabase outage) does NOT abort the caller: galeria_imagenes
// already commit and render keeps working from it. The error is reported to
// Sentry with action + step tags so we observe drift without users noticing.
//
// 5c caveat: if delete succeeds but insert fails on update, media_assets is
// left empty for that product and out-of-sync with galeria_imagenes. The
// render switch in 5c must reconcile before flipping the flag.
async function syncMediaAssetsForProduct(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    productId: string;
    ownerType: "producto" | "servicio";
    galeria: string[];
    mode: "create" | "update";
  },
): Promise<void> {
  const { productId, ownerType, galeria, mode } = args;

  if (mode === "update") {
    const { error: deleteErr } = await supabase
      .from("media_assets")
      .delete()
      .eq("owner_id", productId)
      .in("owner_type", ["producto", "servicio"]);
    if (deleteErr) {
      Sentry.captureException(deleteErr, {
        tags: { action: "syncMediaAssets", step: "delete" },
        contexts: {
          product: { id: productId },
          supabase: { code: deleteErr.code },
        },
      });
      return;
    }
  }

  if (galeria.length === 0) return;

  const rows: MediaAssetInsert[] = galeria.map((url, idx) => ({
    owner_type: ownerType,
    owner_id: productId,
    type: VIDEO_EXT_RE.test(url) ? "video" : "image",
    url_original: url,
    order_index: idx,
  }));

  const { error: insertErr } = await supabase.from("media_assets").insert(rows);
  if (insertErr) {
    Sentry.captureException(insertErr, {
      tags: { action: "syncMediaAssets", step: "insert", mode },
      contexts: {
        product: { id: productId },
        supabase: { code: insertErr.code },
      },
    });
  }
}

const PRODUCT_MEDIA_PREFIX = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/product-media/`
  : null;

function isValidProductMediaUrl(url: string): boolean {
  if (!PRODUCT_MEDIA_PREFIX) return false;
  return typeof url === "string" && url.startsWith(PRODUCT_MEDIA_PREFIX);
}

export async function createProduct(formData: FormData) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // Validate
  const estadoRaw = (formData.get("estado") as string) || "";
  const colorRaw = (formData.get("color") as string) || "";

  // MP#08 #5c-2: categories llega como JSON.stringify de Array<{slug, is_primary}>
  // (mirror del patron de galeria_imagenes). El zod valida shape + max 3 +
  // exactly-1-primary + no duplicados. JSON.parse failures degradan a array
  // vacio para que el validator devuelva un error claro en vez de crashear.
  const categoriesRaw = formData.get("categories") as string | null;
  let categoriesParsed: unknown = [];
  try {
    if (categoriesRaw) categoriesParsed = JSON.parse(categoriesRaw);
  } catch {
    categoriesParsed = [];
  }

  const raw = {
    titulo: formData.get("titulo") as string,
    descripcion: formData.get("descripcion") as string,
    precio: Number(formData.get("precio")),
    tipo: formData.get("tipo") as string,
    categories: categoriesParsed,
    ubicacion: (formData.get("ubicacion") as string) || undefined,
    tipo_entrega: (formData.get("tipo_entrega") as string) || "pickup",
    estado: estadoRaw === "" ? null : estadoRaw,
    color: colorRaw.trim() === "" ? null : colorRaw,
  };

  const result = createProductSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // D8: categoria TEXT en products_services es espejo de la primary actual.
  // El validator ya garantiza exactly 1 primary, asi que primaryCategoria
  // nunca sera null aqui (la guard es defensa contra refactor futuro).
  const primaryCategoria = primarySlug(result.data.categories);
  if (!primaryCategoria) {
    return { error: "No se pudo determinar la categoría principal" };
  }

  const ubicLat = formData.get("ubicacion_lat") ? Number(formData.get("ubicacion_lat")) : null;
  const ubicLng = formData.get("ubicacion_lng") ? Number(formData.get("ubicacion_lng")) : null;
  const deliveryRadius = formData.get("delivery_radius_km") ? Number(formData.get("delivery_radius_km")) : 5;

  const allowAppointments = formData.get("allow_appointments") === "true";
  const precioNegociable = formData.get("precio_negociable") === "true";
  const appointmentStartTime = (formData.get("appointment_start_time") as string) || "09:00";
  const appointmentEndTime = (formData.get("appointment_end_time") as string) || "18:00";
  const appointmentDurationMinutes = formData.get("appointment_duration_minutes") ? Number(formData.get("appointment_duration_minutes")) : 60;

  const imagenPrincipal = (formData.get("imagen_principal") as string) || null;
  const galeriaRaw = formData.get("galeria_imagenes") as string;
  let galeriaImagenes: string[] = [];
  try {
    if (galeriaRaw) {
      const parsedGallery = JSON.parse(galeriaRaw);
      if (Array.isArray(parsedGallery)) {
        galeriaImagenes = parsedGallery.filter((v): v is string => typeof v === "string");
      }
    }
  } catch {
    // ignore parse errors
  }

  // Allowlist: only accept URLs pointing to our product-media bucket.
  if (imagenPrincipal && !isValidProductMediaUrl(imagenPrincipal)) {
    return { error: "URL de imagen principal inválida" };
  }
  if (galeriaImagenes.some((u) => !isValidProductMediaUrl(u))) {
    return { error: "Una o más URLs de la galería son inválidas" };
  }

  const { data, error } = await supabase
    .from("products_services")
    .insert({
      creador_id: user.id,
      titulo: result.data.titulo,
      descripcion: result.data.descripcion,
      precio: result.data.precio,
      tipo: result.data.tipo,
      categoria: primaryCategoria,
      ubicacion: result.data.ubicacion ?? null,
      tipo_entrega: result.data.tipo_entrega,
      estatus: "disponible",
      // Physical condition only applies to productos; servicios stay null.
      ...(result.data.tipo === "producto" && result.data.estado
        ? { estado: result.data.estado }
        : {}),
      // Color free-text, only relevant for productos; servicios stay null.
      ...(result.data.tipo === "producto" && result.data.color
        ? { color: result.data.color }
        : {}),
      imagen_principal: imagenPrincipal,
      galeria_imagenes: galeriaImagenes.length > 0 ? galeriaImagenes : [],
      delivery_radius_km: deliveryRadius,
      precio_negociable: precioNegociable,
      allow_appointments: allowAppointments,
      appointment_start_time: allowAppointments ? appointmentStartTime : null,
      appointment_end_time: allowAppointments ? appointmentEndTime : null,
      appointment_duration_minutes: allowAppointments ? appointmentDurationMinutes : null,
      ...(ubicLat && ubicLng
        ? { ubicacion_geo: `SRID=4326;POINT(${ubicLng} ${ubicLat})` }
        : {}),
    })
    .select("id, slug, categoria")
    .single();

  if (error) {
    return { error: error.message };
  }

  // 5b dual-write to media_assets (best-effort; failures captured to Sentry
  // do not abort the create flow because galeria_imagenes is already saved
  // and render reads from it during coexistence).
  await syncMediaAssetsForProduct(supabase, {
    productId: data.id,
    ownerType: result.data.tipo === "servicio" ? "servicio" : "producto",
    galeria: galeriaImagenes,
    mode: "create",
  });

  // MP#08 #5c-2 dual-write to product_categories: N rows (1..3) with the
  // is_primary flag. Best-effort; categoria TEXT is already saved as a
  // mirror of the primary slug and is the canonical URL source during
  // coexistence (categoria TEXT drop is #4 future).
  await syncProductCategoriesForProduct(supabase, {
    productId: data.id,
    categories: result.data.categories,
    mode: "create",
  });

  // MP#08 #4 Fase 1B: redirect usa la local `primaryCategoria` (derivada del
  // input validado por zod en L252), NO `data.categoria` (TEXT espejo del
  // INSERT RETURNING). Cuando 1C deje de escribir el espejo, `data.categoria`
  // sera stale o null; `primaryCategoria` es el slug correcto in-memory.
  redirect(`/${primaryCategoria}/${data.slug}`);
}

export async function updateProductFull(
  id: string,
  formData: FormData,
): Promise<{ error?: string } | undefined> {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // Validate base fields via the partial schema. `tipo` is intentionally
  // omitted — it is immutable once a listing is published (changing it
  // would break appointments / sale_confirmations semantics).
  const raw: Record<string, unknown> = {};
  const titulo = formData.get("titulo");
  const descripcion = formData.get("descripcion");
  const precio = formData.get("precio");
  const categoriesRaw = formData.get("categories");
  const ubicacion = formData.get("ubicacion");
  const tipoEntrega = formData.get("tipo_entrega");
  const estadoField = formData.get("estado");
  const colorField = formData.get("color");
  if (typeof titulo === "string" && titulo.length > 0) raw.titulo = titulo;
  if (typeof descripcion === "string" && descripcion.length > 0) raw.descripcion = descripcion;
  if (precio !== null && precio !== "") raw.precio = Number(precio);
  // MP#08 #5c-2: categories llega como JSON string. Solo se valida cuando
  // viene presente (tri-state coherente con el resto de updateProductFull:
  // ausente == no tocar, presente == reemplazar). El zod .partial() hereda
  // el shape array + min(1) + max(3) + refines; si el JSON es invalido o
  // viola los refines el validator regresa el error sin tocar la DB.
  if (typeof categoriesRaw === "string" && categoriesRaw.length > 0) {
    try {
      raw.categories = JSON.parse(categoriesRaw);
    } catch {
      raw.categories = [];
    }
  }
  if (typeof ubicacion === "string" && ubicacion.length > 0) raw.ubicacion = ubicacion;
  if (typeof tipoEntrega === "string" && tipoEntrega.length > 0) raw.tipo_entrega = tipoEntrega;
  // estado is only present in the form when tipoSeleccionado === "producto";
  // servicios never render the select. If the field arrives we validate it
  // and rely on the DB CHECK constraint as the last line of defense.
  if (typeof estadoField === "string" && estadoField.length > 0) {
    raw.estado = estadoField;
  }
  // color is also only rendered for productos in the form. Tri-state: if
  // the field is present we send the trimmed value (empty -> null via
  // validator). If absent (servicio path), do not touch the column.
  if (typeof colorField === "string") {
    raw.color = colorField.trim() === "" ? null : colorField;
  }

  const parsed = updateProductSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Datos inválidos" };
  }

  // Extra fields outside the partial schema. Handled manually.
  const ubicLatRaw = formData.get("ubicacion_lat");
  const ubicLngRaw = formData.get("ubicacion_lng");
  const ubicLat = ubicLatRaw ? Number(ubicLatRaw) : null;
  const ubicLng = ubicLngRaw ? Number(ubicLngRaw) : null;

  const deliveryRadiusRaw = formData.get("delivery_radius_km");
  const deliveryRadius = deliveryRadiusRaw ? Number(deliveryRadiusRaw) : null;

  const allowAppointments = formData.has("allow_appointments")
    ? formData.get("allow_appointments") === "true"
    : null;
  const precioNegociable = formData.has("precio_negociable")
    ? formData.get("precio_negociable") === "true"
    : null;
  const apptStart = formData.get("appointment_start_time");
  const apptEnd = formData.get("appointment_end_time");
  const apptDurationRaw = formData.get("appointment_duration_minutes");
  const apptDuration = apptDurationRaw ? Number(apptDurationRaw) : null;

  // ASIMETRIA INTENCIONAL: galeria_imagenes ALWAYS writes (empty array == remove
  // all photos; never confused with "leave alone"). Every other field follows
  // the skip-when-undefined rule above. imagen_principal is derived from
  // galeria[0] ?? null — same pattern as components/product/product-gallery.tsx:135.
  const galeriaRaw = formData.get("galeria_imagenes");
  let galeriaImagenes: string[] = [];
  try {
    if (typeof galeriaRaw === "string" && galeriaRaw.length > 0) {
      const parsedGallery = JSON.parse(galeriaRaw);
      if (Array.isArray(parsedGallery)) {
        galeriaImagenes = parsedGallery.filter(
          (v): v is string => typeof v === "string",
        );
      }
    }
  } catch {
    // ignore parse errors -> treat as empty (== remove all)
  }
  if (galeriaImagenes.some((u) => !isValidProductMediaUrl(u))) {
    return { error: "Una o más URLs de la galería son inválidas" };
  }

  // removed_urls: only used for Storage cleanup AFTER the UPDATE confirms.
  // If parsing fails we still proceed with the UPDATE — orphan ruido is
  // preferable to blocking the user's edit on a malformed client field.
  const removedUrlsRaw = formData.get("removed_urls");
  let removedUrls: string[] = [];
  try {
    if (typeof removedUrlsRaw === "string" && removedUrlsRaw.length > 0) {
      const parsedRemoved = JSON.parse(removedUrlsRaw);
      if (Array.isArray(parsedRemoved)) {
        removedUrls = parsedRemoved.filter(
          (u): u is string => typeof u === "string" && isValidProductMediaUrl(u),
        );
      }
    }
  } catch {
    // ignore
  }

  // Build UPDATE object — galeria_imagenes + imagen_principal ALWAYS in,
  // everything else only when explicitly provided (no-NULL-overwrite).
  const updateObj: Record<string, unknown> = {
    galeria_imagenes: galeriaImagenes,
    imagen_principal: galeriaImagenes[0] ?? null,
  };

  // Reset gallery_sizes (custom layout saved via ProductGallery's mini-edit
  // "Editar diseño") when the gallery composition changes. Removing a photo
  // shifts the index of every subsequent surviving photo, so the saved sizes
  // array stops aligning with galeria_imagenes — the visible layout becomes
  // garbled. Nulling forces the gallery to fall back to defaultSizes
  // (ProductGallery.tsx:76-79). Consistent with C2: imagen_principal is also
  // recalculated when the gallery changes.
  //
  // We deliberately do NOT reset on pure additions (no removals): new photos
  // at the end inherit defaultSize via the `sizes[i] ?? defaultSize` fallback
  // in ProductGallery:145, while existing photos keep their custom layout.
  if (removedUrls.length > 0) {
    updateObj.gallery_sizes = null;
  }

  if (parsed.data.titulo !== undefined) updateObj.titulo = parsed.data.titulo;
  if (parsed.data.descripcion !== undefined) updateObj.descripcion = parsed.data.descripcion;
  if (parsed.data.precio !== undefined) updateObj.precio = parsed.data.precio;
  // D8: categoria TEXT espejo de la primary actual. Si el form mando
  // categories presente, derivamos la primary y la escribimos al TEXT. Si
  // categories esta ausente (no se toco en este update) NO tocamos el TEXT
  // -- preserva el espejo previo. El validator garantiza exactly 1 primary
  // cuando categories esta presente, asi que primarySlug nunca retorna null
  // en esa rama.
  if (parsed.data.categories !== undefined) {
    const p = primarySlug(parsed.data.categories);
    if (p) updateObj.categoria = p;
  }
  if (parsed.data.ubicacion !== undefined) updateObj.ubicacion = parsed.data.ubicacion;
  if (parsed.data.tipo_entrega !== undefined) updateObj.tipo_entrega = parsed.data.tipo_entrega;
  if (parsed.data.estado !== undefined && parsed.data.estado !== null) {
    updateObj.estado = parsed.data.estado;
  }
  // color allows null on update (the seller can clear the field) so the
  // COLOR slot in SpecRow disappears. The form only sends `color` when the
  // input is rendered (productos); for servicios the field is absent and
  // parsed.data.color stays undefined here, leaving the DB value untouched.
  if (parsed.data.color !== undefined) {
    updateObj.color = parsed.data.color;
  }

  if (deliveryRadius !== null && !Number.isNaN(deliveryRadius)) {
    updateObj.delivery_radius_km = deliveryRadius;
  }
  if (precioNegociable !== null) {
    updateObj.precio_negociable = precioNegociable;
  }
  if (allowAppointments !== null) {
    updateObj.allow_appointments = allowAppointments;
    if (allowAppointments) {
      if (typeof apptStart === "string" && apptStart.length > 0) {
        updateObj.appointment_start_time = apptStart;
      }
      if (typeof apptEnd === "string" && apptEnd.length > 0) {
        updateObj.appointment_end_time = apptEnd;
      }
      if (apptDuration !== null && !Number.isNaN(apptDuration)) {
        updateObj.appointment_duration_minutes = apptDuration;
      }
    } else {
      // Turning appointments off: clear the slot fields explicitly.
      updateObj.appointment_start_time = null;
      updateObj.appointment_end_time = null;
      updateObj.appointment_duration_minutes = null;
    }
  }

  // Only touch ubicacion_geo if user actually moved the map marker (both lat
  // AND lng truthy). In edit mode the map widget starts at 0,0 so "no touch"
  // means "preserve existing geo". A real coordinate at 0,0 is extremely
  // unlikely (south of equator, on the Greenwich meridian).
  if (ubicLat && ubicLng) {
    updateObj.ubicacion_geo = `SRID=4326;POINT(${ubicLng} ${ubicLat})`;
  }

  // C1 ORDER OF OPERATIONS: subir fotos en el cliente ya ocurrio antes de
  // llamar este action. Aqui solo confirmamos el UPDATE. Si falla o devuelve
  // 0 filas, NO se borran las viejas del Storage — la fila sigue intacta y
  // las viejas URLs siguen vivas. Si confirma, recien ahi cleanup best-effort.
  // .eq creador_id es defense-in-depth con RLS. .neq estatus impide editar
  // soft-deleted. .select detecta el 0-row case (race con delete).
  const { data: updated, error: updateErr } = await supabase
    .from("products_services")
    .update(updateObj)
    .eq("id", id)
    .eq("creador_id", user.id)
    .neq("estatus", "eliminado")
    .select("id, tipo, categoria")
    .maybeSingle();

  if (updateErr) {
    if (updateErr.code === "42501") {
      return { error: "No tienes permiso para editar esta publicación." };
    }
    Sentry.captureException(updateErr, {
      tags: { action: "updateProductFull" },
      contexts: { product: { id }, supabase: { code: updateErr.code } },
    });
    return { error: "No se pudo guardar. Intenta de nuevo." };
  }

  if (!updated) {
    return { error: "Esta publicación ya no existe." };
  }

  // 5b sync media_assets to mirror the new gallery (DELETE all rows for
  // this product, INSERT the new batch). owner_type is derived from the
  // RETURNING `tipo` of the UPDATE (avoids a second SELECT). Best-effort
  // failure mode: galeria_imagenes is canonical for render during 5b.
  await syncMediaAssetsForProduct(supabase, {
    productId: id,
    ownerType: updated.tipo === "servicio" ? "servicio" : "producto",
    galeria: galeriaImagenes,
    mode: "update",
  });

  // MP#08 #5c-2 sync product_categories to mirror the new categories array
  // (DELETE all pivot rows for this product, INSERT the new N rows). Only
  // runs if the form sent categories (tri-state preserve when absent). If
  // categories was absent, the pivot stays as-is (consistent with the
  // categoria TEXT mirror, which we also didn't touch above). Best-effort:
  // failures go to Sentry without aborting the user flow.
  if (parsed.data.categories !== undefined) {
    await syncProductCategoriesForProduct(supabase, {
      productId: id,
      categories: parsed.data.categories,
      mode: "update",
    });
  }

  if (removedUrls.length > 0) {
    await cleanupRemovedMedia(supabase, removedUrls);
  }

  revalidatePath("/seller/listings");
  redirect("/seller/listings");
}

export async function deleteProduct(id: string) {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const { error } = await supabase
    .from("products_services")
    .update({ estatus: "eliminado" })
    .eq("id", id)
    .eq("creador_id", user.id);

  if (error) {
    return { error: error.message };
  }

  redirect("/seller/listings");
}

export async function toggleProductStatus(id: string, newStatus: "disponible" | "pausado") {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const { error } = await supabase
    .from("products_services")
    .update({ estatus: newStatus })
    .eq("id", id)
    .eq("creador_id", user.id);

  if (error) {
    return { error: error.message };
  }

  // Sync the seller listings page so navigating back from elsewhere shows
  // the new estatus. The optimistic flip in listing-actions covers the
  // local UI feel; this covers cross-page consistency.
  revalidatePath("/seller/listings");

  return { success: true };
}
