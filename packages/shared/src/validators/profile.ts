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

/**
 * Formato del @ publico. Es el MISMO que el CHECK profiles_username_formato
 * de la base (migracion 20260826250000): si divergen, el usuario ve un error
 * distinto segun donde se valide.
 *
 * La lista de nombres reservados NO se duplica aqui a proposito. Vive en el
 * RPC set_username, que es la fuente de verdad, y su mensaje llega ya
 * redactado para el usuario. Copiarla aqui garantizaria que las dos se
 * separen la primera vez que alguien anada una palabra.
 */
export const usernameSchema = z
  .string()
  .trim()
  .min(3, "Minimo 3 caracteres")
  .max(30, "Maximo 30 caracteres")
  .regex(
    /^[A-Za-z0-9_]+$/,
    "Solo letras, numeros y guion bajo",
  );

export const sellerOnboardingSchema = z.object({
  nombre_negocio: z.string().min(2, "Mínimo 2 caracteres").max(100),
  descripcion_negocio: z.string().min(10).max(1000),
  categoria_negocio: z.string().min(1, "Selecciona una categoría"),
  telefono: z.string().min(10, "Teléfono inválido").max(15),
  metodos_pago_aceptados: z.string().min(1, "Indica cómo aceptas pagos").max(500),
});

export type Username = z.infer<typeof usernameSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type SellerOnboardingInput = z.infer<typeof sellerOnboardingSchema>;
