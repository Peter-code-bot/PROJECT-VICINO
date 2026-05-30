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

// Best-effort dual-write helper for the product_categories pivot during
// MP#08 #1 Parte 1b coexistence. The form sends categoria as a TEXT slug,
// so the helper looks up the categoria_id via categories.slug and then
// INSERTs the pivot row. Failures (RLS, network, supabase outage, orphan
// slug) are captured to Sentry and the caller is NOT aborted because
// products_services.categoria TEXT is the canonical render+search source
// during coexistence.
//
// Caveat: 4 legacy products store categoria in display-format (e.g.
// "Electronica", "Servicios") instead of slug ("electronica", "servicios"),
// so the slug lookup misses with no match. The helper logs the miss to
// Sentry and skips the INSERT instead of failing — same flow as a real RLS
// or supabase error. This is the documented finding from Parte 1a backfill.
async function syncProductCategoriesForProduct(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    productId: string;
    categoriaSlug: string;
    mode: "create" | "update";
  },
): Promise<void> {
  const { productId, categoriaSlug, mode } = args;

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

  if (!categoriaSlug) return;

  const { data: category, error: lookupErr } = await supabase
    .from("categories")
    .select("id")
    .eq("slug", categoriaSlug)
    .maybeSingle();

  if (lookupErr) {
    Sentry.captureException(lookupErr, {
      tags: { action: "syncProductCategories", step: "category_slug_lookup" },
      contexts: {
        product: { id: productId },
        category: { slug: categoriaSlug },
        supabase: { code: lookupErr.code },
      },
    });
    return;
  }

  if (!category) {
    // Orphan slug: covers the 4 legacy display-format rows ("Electronica",
    // "Servicios") and any future slug drift. Logged for visibility, not
    // treated as an error since the underlying products_services row is
    // already valid via categoria TEXT.
    Sentry.captureException(
      new Error(`product_categories sync miss: no categories.slug = "${categoriaSlug}"`),
      {
        tags: { action: "syncProductCategories", step: "category_slug_lookup_miss" },
        contexts: {
          product: { id: productId },
          category: { slug: categoriaSlug },
        },
      },
    );
    return;
  }

  const { error: insertErr } = await supabase
    .from("product_categories")
    .insert({ product_id: productId, categoria_id: category.id });
  if (insertErr) {
    Sentry.captureException(insertErr, {
      tags: { action: "syncProductCategories", step: "insert", mode },
      contexts: {
        product: { id: productId },
        category: { id: category.id, slug: categoriaSlug },
        supabase: { code: insertErr.code },
      },
    });
  }
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
  const raw = {
    titulo: formData.get("titulo") as string,
    descripcion: formData.get("descripcion") as string,
    precio: Number(formData.get("precio")),
    tipo: formData.get("tipo") as string,
    categoria: formData.get("categoria") as string,
    ubicacion: (formData.get("ubicacion") as string) || undefined,
    tipo_entrega: (formData.get("tipo_entrega") as string) || "pickup",
    estado: estadoRaw === "" ? null : estadoRaw,
  };

  const result = createProductSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.errors[0]?.message ?? "Datos inválidos" };
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
      categoria: result.data.categoria,
      ubicacion: result.data.ubicacion ?? null,
      tipo_entrega: result.data.tipo_entrega,
      estatus: "disponible",
      // Physical condition only applies to productos; servicios stay null.
      ...(result.data.tipo === "producto" && result.data.estado
        ? { estado: result.data.estado }
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

  // MP#08 #1 Parte 1b dual-write to product_categories (best-effort; same
  // failure mode as media_assets — categoria TEXT is already saved and is
  // the canonical render+search source during coexistence).
  await syncProductCategoriesForProduct(supabase, {
    productId: data.id,
    categoriaSlug: result.data.categoria,
    mode: "create",
  });

  redirect(`/${data.categoria}/${data.slug}`);
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
  const categoria = formData.get("categoria");
  const ubicacion = formData.get("ubicacion");
  const tipoEntrega = formData.get("tipo_entrega");
  const estadoField = formData.get("estado");
  if (typeof titulo === "string" && titulo.length > 0) raw.titulo = titulo;
  if (typeof descripcion === "string" && descripcion.length > 0) raw.descripcion = descripcion;
  if (precio !== null && precio !== "") raw.precio = Number(precio);
  if (typeof categoria === "string" && categoria.length > 0) raw.categoria = categoria;
  if (typeof ubicacion === "string" && ubicacion.length > 0) raw.ubicacion = ubicacion;
  if (typeof tipoEntrega === "string" && tipoEntrega.length > 0) raw.tipo_entrega = tipoEntrega;
  // estado is only present in the form when tipoSeleccionado === "producto";
  // servicios never render the select. If the field arrives we validate it
  // and rely on the DB CHECK constraint as the last line of defense.
  if (typeof estadoField === "string" && estadoField.length > 0) {
    raw.estado = estadoField;
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
  if (parsed.data.categoria !== undefined) updateObj.categoria = parsed.data.categoria;
  if (parsed.data.ubicacion !== undefined) updateObj.ubicacion = parsed.data.ubicacion;
  if (parsed.data.tipo_entrega !== undefined) updateObj.tipo_entrega = parsed.data.tipo_entrega;
  if (parsed.data.estado !== undefined && parsed.data.estado !== null) {
    updateObj.estado = parsed.data.estado;
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

  // MP#08 #1 Parte 1b sync product_categories to mirror the new categoria
  // (DELETE all pivot rows for this product, INSERT the resolved one). If
  // the form did not change categoria, parsed.data.categoria may be
  // undefined; in that case we still run the sync with the existing TEXT
  // value (read from the UPDATE RETURNING) to keep the pivot consistent
  // with categoria TEXT. Best-effort: failures go to Sentry without
  // aborting the user flow.
  await syncProductCategoriesForProduct(supabase, {
    productId: id,
    categoriaSlug: parsed.data.categoria ?? updated.categoria,
    mode: "update",
  });

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
