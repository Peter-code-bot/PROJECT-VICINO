import { z } from "zod";

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

export const createProductSchema = z.object({
  titulo: z.string().min(3, "Mínimo 3 caracteres").max(120),
  descripcion: z.string().min(10, "Mínimo 10 caracteres").max(5000),
  precio: z.number().positive("El precio debe ser mayor a 0").max(999999),
  tipo: z.enum(["producto", "servicio"]),
  categoria: z.string().min(1, "Selecciona una categoría"),
  ubicacion: z.string().optional(),
  tipo_entrega: z.enum(deliveryValues).default("punto_encuentro"),
});

export const updateProductSchema = createProductSchema.partial();

export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
