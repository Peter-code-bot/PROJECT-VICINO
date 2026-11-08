import { z } from "zod";
import {
  normalizarNumeroWhatsApp,
  normalizarUrlGoogleMaps,
  normalizarUrlResenasGoogle,
  normalizarUsuarioInstagram,
} from "../utils/enlaces-negocio";

export const updateProfileSchema = z.object({
  nombre: z.string().min(1, "El nombre es obligatorio").max(100),
  bio: z.string().max(500).optional().nullable(),
  foto: z.string().url().max(500).optional().nullable(),
  ubicacion: z.string().max(200).optional().nullable(),
  es_vendedor: z.boolean().default(false),
  seller_type: z.enum(["casual", "business"]).default("casual"),
  nombre_negocio: z.string().trim().max(100).optional().nullable(),
  descripcion_negocio: z.string().max(1000).optional().nullable(),
  metodos_pago_aceptados: z.string().max(500).optional().nullable(),
}).superRefine((profile, ctx) => {
  if (profile.es_vendedor && profile.seller_type === "business" && !profile.nombre_negocio) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["nombre_negocio"], message: "Escribe el nombre de la tienda" });
  }
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

/** Nuevas elecciones del onboarding; los IDs históricos se conservan al omitir. */
export const onboardingUsernameSchema = z.string().superRefine((value, ctx) => {
  const message = !value ? "Escribe un ID o elige Omitir."
    : /\s/u.test(value) ? "El ID no puede tener espacios. Usa guion bajo (_) para separar palabras."
      : /[A-Z]/.test(value) ? "Usa solo letras minúsculas (a–z)."
        : /\./.test(value) ? "El ID no admite puntos (.). Usa guion bajo (_), por ejemplo: ana_lopez."
          : /[-\u2010-\u2015\u2212\uff0d]/u.test(value) ? "El ID no admite guiones (-). Usa guion bajo (_), por ejemplo: ana_lopez."
        : /[^a-z0-9_]/.test(value) ? "Usa solo letras sin acentos (a–z), números y guion bajo (_)."
          : value.length < 3 ? "Usa al menos 3 caracteres."
            : value.length > 30 ? "Usa como máximo 30 caracteres." : null;
  if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
});

export const sellerOnboardingSchema = z.object({
  nombre_negocio: z.string().trim().min(2, "Mínimo 2 caracteres").max(100),
  descripcion_negocio: z.string().min(10).max(1000),
  categoria_negocio: z.string().min(1, "Selecciona una categoría"),
  telefono: z.string().min(10, "Teléfono inválido").max(15),
  metodos_pago_aceptados: z.string().min(1, "Indica cómo aceptas pagos").max(500),
});

/**
 * Un campo de enlace del negocio: lo que la persona escribio (con @, con URL
 * completa, con espacios) se LIMPIA aqui y sale ya en la forma que guarda la
 * base, o falla con el mensaje de su campo. Vacio es null: el formulario manda
 * los cuatro campos siempre, y vacio significa "ya no lo muestres".
 *
 * El limite de 600 solo corta pegados absurdos antes de normalizar; los
 * limites reales (30 del usuario, 500 y 300 de las URL) los aplica cada
 * normalizador, igual que los CHECK de la migracion 20261108120000.
 */
function campoEnlaceNegocio(normalizar: (valor: string) => string | null, mensaje: string) {
  return z
    .string()
    .max(600, mensaje)
    .nullable()
    .optional()
    .transform((valor, ctx) => {
      if (valor === null || valor === undefined || valor.trim() === "") return null;
      const normalizado = normalizar(valor);
      if (normalizado === null) {
        ctx.addIssue({ code: "custom", message: mensaje });
        return z.NEVER;
      }
      return normalizado;
    });
}

export const enlacesNegocioSchema = z.object({
  instagram_usuario: campoEnlaceNegocio(
    normalizarUsuarioInstagram,
    "El usuario de Instagram solo admite letras, números, puntos y guion bajo (máximo 30).",
  ),
  whatsapp_numero: campoEnlaceNegocio(
    normalizarNumeroWhatsApp,
    "Escribe el WhatsApp con lada de país y solo dígitos, por ejemplo 52 222 123 4567.",
  ),
  google_maps_url: campoEnlaceNegocio(
    normalizarUrlGoogleMaps,
    "El enlace de Google Maps debe ser un enlace de Google Maps (por ejemplo maps.app.goo.gl/…).",
  ),
  google_resenas_url: campoEnlaceNegocio(
    normalizarUrlResenasGoogle,
    "El enlace de reseñas debe ser el que genera Google en tu Perfil de Negocio (g.page/r/…/review).",
  ),
});

export type Username = z.infer<typeof usernameSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type SellerOnboardingInput = z.infer<typeof sellerOnboardingSchema>;
export type EnlacesNegocioInput = z.input<typeof enlacesNegocioSchema>;
export type EnlacesNegocioNormalizados = z.output<typeof enlacesNegocioSchema>;
