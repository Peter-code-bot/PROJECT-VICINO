import { z } from "zod";
import { CATEGORIES } from "../constants/categories";
import { containsCoordinatePair } from "../utils/public-location-label";

// El enum conserva la union CategorySlug y valida los 35 slugs canonicos,
// incluidas las subcategorias ocultas en el formulario. En Zod 4 un predicate
// pasado a refine ya no estrecha el tipo inferido.
//
// Multi-categoria (MP#08 #5c-2): el campo `categories` es un array de
// {slug, is_primary} con min(1), max(3) y exactly-1-primary enforzado por
// refine. El trigger BEFORE INSERT en DB (5c-1) actua como defense in depth
// para rutas que no pasan por este validator (admin, RPC futuro).

export const DELIVERY_OPTIONS = [
  { value: "punto_encuentro", label: "Punto de encuentro seguro", for: ["producto", "servicio"] },
  { value: "entrega_domicilio", label: "Entrega a domicilio", for: ["producto"] },
  { value: "paqueteria", label: "Envío por paquetería", for: ["producto"] },
  { value: "recoger_local", label: "Recoger en local/tienda", for: ["producto", "servicio"] },
  { value: "solo_digital", label: "Solo digital (archivos, links)", for: ["producto"] },
  { value: "domicilio_cliente", label: "A domicilio del cliente", for: ["servicio"] },
  { value: "en_linea", label: "En línea / remoto", for: ["servicio"] },
  { value: "acordar_chat", label: "Acordar por chat", for: ["producto", "servicio"] },
] as const;

export const deliveryValues = DELIVERY_OPTIONS.map((o) => o.value) as [string, ...string[]];

export const PRODUCT_CONDITION_VALUES = [
  "nuevo",
  "como_nuevo",
  "bueno",
  "aceptable",
  "para_piezas",
] as const;

const baseProductSchema = z.object({
  titulo: z.string().trim().min(3, "Mínimo 3 caracteres").max(120),
  descripcion: z.string().trim().max(5000).default(""),
  precio: z.number().positive("El precio debe ser mayor a 0").max(99999999).nullable().optional(),
  modo_precio: z.enum(["precio", "cotizacion", "reservacion"]).default("precio"),
  tipo: z.enum(["producto", "servicio"]),
  categories: z
    .array(
      z.object({
        slug: z.enum(CATEGORIES.map((c) => c.slug), { error: "Categoría no válida" }),
        is_primary: z.boolean(),
      }),
    )
    .min(1, "Selecciona al menos una categoría")
    .max(3, "Máximo 3 categorías por producto")
    .refine(
      (arr) => arr.filter((c) => c.is_primary).length === 1,
      { message: "Debe haber exactamente una categoría principal" },
    )
    .refine(
      (arr) => new Set(arr.map((c) => c.slug)).size === arr.length,
      { message: "No puedes repetir la misma categoría" },
    ),
  ubicacion: z.string().refine((value) => !containsCoordinatePair(value), {
    message: "Elige una ubicación en el mapa para guardar una etiqueta pública sin coordenadas",
  }).optional(),
  tipo_entrega: z.enum(deliveryValues).default("punto_encuentro"),
  estado: z.enum(PRODUCT_CONDITION_VALUES).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
});

// El superRefine cruza modo_precio con precio: en modo "precio" el campo es
// obligatorio; en "cotizacion"/"reservacion" NO debe venir. La edicion deriva
// del esquema base porque sus campos parciales tienen otras reglas.
/**
 * Cruza `tipo` con el `type` de cada categoría elegida.
 *
 * El formulario ya solo ofrece las categorías del tipo elegido, pero eso es
 * filtrado de interfaz: un POST directo con `tipo: "producto"` y la categoría
 * `servicios-hogar` pasaba entero. Un producto catalogado como servicio ensucia
 * el feed por categoría, el filtro de /buscar y el ranking, que agrupa por
 * categoría.
 *
 * Las categorías `type: "otro"` — hoy Empleos y Otros — valen para ambos a
 * propósito: son justamente el cajón para lo que no encaja en la dicotomía.
 */
function validarCoherenciaTipoCategoria(
  data: { tipo?: "producto" | "servicio"; categories?: { slug: string }[] },
  ctx: z.RefinementCtx,
) {
  if (!data.tipo || !data.categories) return;

  data.categories.forEach((elegida, i) => {
    const cat = CATEGORIES.find((c) => c.slug === elegida.slug);
    if (!cat || cat.type === "otro") return;

    if (cat.type !== data.tipo) {
      const esperado = cat.type === "servicio" ? "servicio" : "producto";
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["categories", i, "slug"],
        message: `"${cat.name}" es una categoría de ${esperado}. Cambia el tipo de tu publicación o elige otra categoría.`,
      });
    }
  });
}

export const createProductSchema = baseProductSchema.superRefine((data, ctx) => {
  if (data.modo_precio === "precio") {
    if (data.precio == null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["precio"],
        message: "Pon un precio o cambia el modo a Cotización o Reservación" });
    }
  } else if (data.precio != null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["precio"],
      message: "En modo Cotización o Reservación no se envía precio" });
  }

  validarCoherenciaTipoCategoria(data, ctx);
});

// El .partial() deja tipo y categories opcionales, asi que la comprobacion solo
// aplica cuando la edicion manda los dos. Editar solo el titulo no tiene por que
// arrastrar una validacion de categorias.
export const updateProductSchema = baseProductSchema
  // Zod 4 aplica defaults incluso dentro de optional. Un PATCH omitido debe
  // conservar lo guardado, sin vaciar descripcion ni reiniciar precio/entrega.
  .extend({
    descripcion: baseProductSchema.shape.descripcion.removeDefault(),
    modo_precio: baseProductSchema.shape.modo_precio.removeDefault(),
    tipo_entrega: baseProductSchema.shape.tipo_entrega.removeDefault(),
  })
  .partial()
  .superRefine(validarCoherenciaTipoCategoria);

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
