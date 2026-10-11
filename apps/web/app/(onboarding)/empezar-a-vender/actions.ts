"use server";

import { revalidatePath } from "@/lib/revalidate-session";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { enforce, writeRateLimit } from "@/lib/rate-limit";
import { CATEGORIES, sellerOnboardingSchema, updateProfileSchema } from "@vicino/shared";
import { z } from "zod";

const profileFields = updateProfileSchema.innerType().shape;
const activationSchema = z.object({
  categoria: sellerOnboardingSchema.shape.categoria_negocio.nullable(),
  tipo: profileFields.seller_type.removeDefault(),
  nombreNegocio: profileFields.nombre_negocio,
  descripcionNegocio: profileFields.descripcion_negocio,
  metodosPago: profileFields.metodos_pago_aceptados,
  foto: profileFields.foto.or(z.literal("")),
}).superRefine((input, context) => {
  if (input.categoria && !CATEGORIES.some((category) => category.slug === input.categoria)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["categoria"], message: "Elige una categoría válida." });
  }
  if (input.tipo === "business" && input.nombreNegocio?.trim() && input.nombreNegocio.trim().length < 2) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["nombreNegocio"], message: "Escribe al menos 2 caracteres para el nombre del negocio." });
  }
  if (input.foto && !/^https?:\/\//i.test(input.foto)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["foto"], message: "La foto debe tener una URL válida." });
  }
});

/**
 * Activa el Modo Vendedor. Es el único gesto que convierte.
 *
 * Va por el RPC `activar_modo_vendedor` y no por el formulario de perfil por
 * dos motivos comprobados, no supuestos:
 *
 *   1. `authenticated` NO tiene UPDATE sobre es_vendedor, seller_type ni
 *      categoria_negocio — solo INSERT y SELECT. Sin RPC no se escribe nada.
 *   2. `update_profile_and_pause_products`, que sí escribe es_vendedor, hace
 *      sobrescritura completa del perfil y exige nombre, bio, foto y ubicación.
 *      Llamarlo desde aquí borraría todo lo demás.
 *
 * Y no es cosmético: la policy «Sellers can create products» exige
 * es_vendedor = true, así que hasta este momento la persona no puede publicar.
 */
export async function activarModoVendedor(params: {
  categoria: string | null;
  tipo: "casual" | "business";
  nombreNegocio?: string;
  descripcionNegocio?: string;
  metodosPago?: string;
  foto?: string;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const parsed = activationSchema.safeParse(params);
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    const messages: Record<string, string> = {
      categoria: "Elige una categoría válida.",
      tipo: "Elige Casual o Negocio para continuar.",
      nombreNegocio: "El nombre del negocio debe tener entre 2 y 100 caracteres.",
      descripcionNegocio: "La descripción admite hasta 1000 caracteres.",
      metodosPago: "Revisa los métodos de pago que seleccionaste.",
      foto: "No pudimos validar la foto. Intenta subirla de nuevo.",
    };
    return { error: typeof field === "string" ? messages[field] ?? "Revisa los datos del Modo Vendedor." : "Revisa los datos del Modo Vendedor." };
  }
  const input = parsed.data;

  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  const { error } = await supabase.rpc("activar_modo_vendedor", {
    // Omitir la categoria significa "no la cambies": el cuerpo del RPC lo
    // resuelve con COALESCE(p_categoria_negocio, categoria_negocio).
    p_categoria_negocio: input.categoria ?? undefined,
    p_seller_type: input.tipo,
    p_nombre_negocio: input.nombreNegocio?.trim() || undefined,
    p_descripcion_negocio: input.descripcionNegocio?.trim() || undefined,
    p_metodos_pago_aceptados: input.metodosPago?.trim() || undefined,
    p_foto: input.foto || undefined,
  });

  if (error) {
    if (error.code === "42501" && error.message === "Confirma los Términos y el Aviso de Privacidad para continuar.")
      return { error: "Confirma los Términos y el Aviso de Privacidad para continuar." };
    if (error.code === "42501" && error.message === "Confirma la visibilidad de tu perfil antes de comenzar a vender.")
      return { error: "Confirma la visibilidad de tu perfil antes de comenzar a vender." };
    // 22023 es entrada inválida del usuario (categoría o tipo), no un fallo:
    // no ensucia Sentry. Cualquier otro código sí lo es.
    if (error.code !== "22023") {
      Sentry.captureException(error, { tags: { action: "activarModoVendedor" } });
    }
    if (error.code === "22023") return { error: "Revisa la categoría y el tipo de vendedor." };
    if (error.code === "23514" && input.tipo === "business") return { error: "Escribe el nombre de tu negocio antes de activar el Modo Vendedor." };
    if (error.code === "P0002") return { error: "No pudimos cargar tu perfil. Intenta de nuevo en un momento." };
    return { error: "No pudimos activar el Modo Vendedor. Intenta de nuevo." };
  }

  await revalidatePath("/perfil");
  await revalidatePath("/vender");
  // Se quitó await revalidatePath("/") porque revalidar la raíz invalida el árbol entero,
  // incluida /empezar-a-vender, y eso expulsaba al vendedor de su propia pantalla
  // de bienvenida antes de que la viera. El refresco del home se delega al cliente.
  return { success: true as const };
}

/**
 * Mueve el marcador del alta, o lo cierra pasando `null`.
 *
 * Existe aparte de la activación porque los pasos posteriores son omitibles y
 * la persona puede salir en cualquiera: hace falta mover el marcador sin volver
 * a tocar es_vendedor.
 */
export async function avanzarAltaVendedor(paso: "ubicacion" | "publicacion" | null) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) return { error: "No autenticado" };

  const parsed = z.enum(["ubicacion", "publicacion"]).nullable().safeParse(paso);
  if (!parsed.success) return { error: "No pudimos avanzar. Intenta de nuevo." };

  // Misma cubeta `write:` que el resto de escrituras, NO un identificador
  // propio: en Upstash la clave es prefijo + identificador, asi que inventar
  // uno nuevo aqui no compartiria cuota, abriria una paralela y subiria el
  // techo real por usuario sin que nadie lo decidiera. Es el fallo que ya
  // tiene `follow:`.
  const rate = await enforce(writeRateLimit, `write:${user.id}`);
  if (!rate.ok) return { error: rate.error };

  // paso null = el alta termino. Se omite el parametro y el DEFAULT NULL de
  // la funcion dice lo mismo.
  const { error } = await supabase.rpc("avanzar_alta_vendedor", {
    p_paso: parsed.data ?? undefined,
  });

  if (error) {
    Sentry.captureException(error, { tags: { action: "avanzarAltaVendedor" } });
    return { error: "No pudimos avanzar. Intenta de nuevo." };
  }

  await revalidatePath("/perfil");
  return { success: true as const };
}
