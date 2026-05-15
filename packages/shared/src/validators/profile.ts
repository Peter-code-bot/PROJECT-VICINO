import { z } from "zod";

export const updateProfileSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio").max(100),
  bio: z.string().max(500).optional().nullable(),
  foto: z.string().url().max(500).optional().nullable(),
  ubicacion: z.string().max(200).optional().nullable(),
  es_vendedor: z.boolean().default(false),
  seller_type: z.enum(["casual", "business"]).default("casual"),
  nombre_negocio: z.string().max(100).optional().nullable(),
  descripcion_negocio: z.string().max(1000).optional().nullable(),
  metodos_pago_aceptados: z.string().max(500).optional().nullable(),
});

export const sellerOnboardingSchema = z.object({
  nombre_negocio: z.string().min(2, "Mínimo 2 caracteres").max(100),
  descripcion_negocio: z.string().min(10).max(1000),
  categoria_negocio: z.string().min(1, "Selecciona una categoría"),
  telefono: z.string().min(10, "Teléfono inválido").max(15),
  metodos_pago_aceptados: z.string().min(1, "Indica cómo aceptas pagos").max(500),
});

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type SellerOnboardingInput = z.infer<typeof sellerOnboardingSchema>;
