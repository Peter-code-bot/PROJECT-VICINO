"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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

  const { error } = await supabase
    .from("coupons")
    .update({ activo })
    .eq("id", id)
    .eq("vendedor_id", user.id);

  if (error) return { error: error.message };
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

  const { error } = await supabase
    .from("coupons")
    .delete()
    .eq("id", id)
    .eq("vendedor_id", user.id);

  if (error) return { error: error.message };
  revalidatePath("/seller/cupones");
  return { success: true };
}
