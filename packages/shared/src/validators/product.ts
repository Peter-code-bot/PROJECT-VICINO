import { z } from "zod";
import { CATEGORIES, type CategorySlug } from "../constants/categories";

// Type predicate refine: cumple dos objetivos a la vez.
//   (1) Runtime: rechaza cualquier categoria que no sea uno de los 35 slugs
//       canonicos de CATEGORIES (25 visibles + 10 subcategorias de mayoreo
//       marcadas hidden_in_form). El form pinta solo las 25 visibles, pero
//       el predicate acepta los 35 para no romper rutas alternativas de
//       escritura (admin, RPC, futuro flujo de mayoreo).
//   (2) Type level: el predicate `(v): v is CategorySlug` propaga el literal
//       union a `z.infer<typeof createProductSchema>["categoria"]`. Zod v3
//       `z.enum` con array dinamico ensancharia a `string` (los docs piden
//       valores inline con `as const`); el refine preserva la union literal
//       sin duplicar la lista de slugs.

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
  categoria: z.string().refine(
    (v): v is CategorySlug => CATEGORIES.some((c) => c.slug === v),
    { message: "Selecciona una categoría válida" },
  ),
  ubicacion: z.string().optional(),
  tipo_entrega: z.enum(deliveryValues).default("punto_encuentro"),
  estado: z.enum(PRODUCT_CONDITION_VALUES).optional().nullable(),
  color: z.string().trim().max(40).optional().nullable(),
});

export const updateProductSchema = createProductSchema.partial();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
