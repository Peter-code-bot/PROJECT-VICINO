import { z } from "zod";
import { CATEGORIES, type CategorySlug } from "../constants/categories";

// Type predicate refine sobre cada slug del array: cumple dos objetivos a la vez.
//   (1) Runtime: rechaza cualquier slug que no sea uno de los 35 canonicos
//       de CATEGORIES (25 visibles + 10 subcategorias de mayoreo marcadas
//       hidden_in_form). El form pinta solo las 25 visibles, pero el predicate
//       acepta los 35 para no romper rutas alternativas (admin, RPC, futuro
//       flujo de mayoreo).
//   (2) Type level: el predicate `(v): v is CategorySlug` propaga el literal
//       union a `z.infer<typeof createProductSchema>["categories"][number]["slug"]`.
//       Zod v3 `z.enum` con array dinamico ensancharia a `string` (los docs
//       piden valores inline con `as const`); el refine preserva la union
//       literal sin duplicar la lista.
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

export const createProductSchema = z.object({
  titulo: z.string().min(3, "Mínimo 3 caracteres").max(120),
  descripcion: z.string().min(10, "Mínimo 10 caracteres").max(5000),
  precio: z.number().positive("El precio debe ser mayor a 0").max(99999999),
  tipo: z.enum(["producto", "servicio"]),
  categories: z
    .array(
      z.object({
        slug: z.string().refine(
          (v): v is CategorySlug => CATEGORIES.some((c) => c.slug === v),
          { message: "Categoría no válida" },
        ),
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
  ubicacion: z.string().optional(),
  tipo_entrega: z.enum(deliveryValues).default("punto_encuentro"),
  estado: z.enum(PRODUCT_CONDITION_VALUES).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
});

export const updateProductSchema = createProductSchema.partial();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
