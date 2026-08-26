"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { createCouponSchema } from "@vicino/shared";
import { enforce, writeRateLimit } from "@/lib/rate-limit";

export async function createCoupon(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const raw = {
    codigo: formData.get("codigo") as string,
    tipo_descuento: formData.get("tipo_descuento") as string,
    valor: Number(formData.get("valor")),
    fecha_expiracion: (formData.get("fecha_expiracion") as string) || undefined,
    usos_maximos: formData.get("usos_maximos")
      ? Number(formData.get("usos_maximos"))
      : undefined,
  };

  const result = createCouponSchema.safeParse(raw);
  if (!result.success) {
    return { error: result.error.errors[0]?.message ?? "Datos inválidos" };
  }

  const { error } = await supabase.from("coupons").insert({
    vendedor_id: user.id,
    codigo: result.data.codigo,
    tipo_descuento: result.data.tipo_descuento,
    valor: result.data.valor,
    fecha_expiracion: result.data.fecha_expiracion || null,
    usos_maximos: result.data.usos_maximos ?? null,
  });

  if (error) {
    if (error.code === "23505") return { error: "Ese código de cupón ya existe" };
    return { error: error.message };
  }

  redirect("/seller/cupones");
}

export async function toggleCoupon(id: string, activo: boolean) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // .select().maybeSingle() no es cosmetico: un UPDATE de 0 filas no es error
  // en PostgREST (204 sin cuerpo), asi que sin el RETURNING un id ajeno o un
  // cupon ya borrado devolvia { success: true } mintiendo. .eq vendedor_id es
  // defense-in-depth con la policy "Sellers can manage own coupons".
  const { data: updated, error } = await supabase
    .from("coupons")
    .update({ activo })
    .eq("id", id)
    .eq("vendedor_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    // Sentry SIEMPRE antes del return: el `details` de Postgres es donde el
    // motor nombra la columna o la policy que rechazo, y perderlo es lo que
    // encarecio los diagnosticos anteriores.
    Sentry.captureException(error, {
      tags: { action: "toggleCoupon" },
      contexts: { coupon: { id, activo }, supabase: { code: error.code } },
    });
    return { error: "No se pudo cambiar el estado del cupón. Intenta de nuevo." };
  }

  if (!updated) {
    return { error: "Este cupón ya no existe. Actualiza la página." };
  }

  revalidatePath("/seller/cupones");
  return { success: true };
}

export async function deleteCoupon(id: string) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "No autenticado" };

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // Mismo motivo que en toggleCoupon: un DELETE de 0 filas es 204 sin cuerpo,
  // no un error. Sin el RETURNING, borrar un cupon ajeno o ya borrado
  // devolvia { success: true }. No hay FK apuntando a coupons, asi que el
  // DELETE ... RETURNING no puede romper por dependencias.
  const { data: deleted, error } = await supabase
    .from("coupons")
    .delete()
    .eq("id", id)
    .eq("vendedor_id", user.id)
    .select("id")
    .maybeSingle();

  if (error) {
    Sentry.captureException(error, {
      tags: { action: "deleteCoupon" },
      contexts: { coupon: { id }, supabase: { code: error.code } },
    });
    return { error: "No se pudo eliminar el cupón. Intenta de nuevo." };
  }

  if (!deleted) {
    return { error: "Este cupón ya no existe. Actualiza la página." };
  }

  revalidatePath("/seller/cupones");
  return { success: true };
}
