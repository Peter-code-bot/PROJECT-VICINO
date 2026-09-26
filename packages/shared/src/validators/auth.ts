import { z } from "zod";

/** Entrada pública de registro. La contraseña se conserva literalmente. */
export const signUpSchema = z.object({
  email: z.string().trim().toLowerCase().email("Escribe un correo válido."),
  password: z.string().min(6, "La contraseña debe tener al menos 6 caracteres."),
  fullName: z.string().trim().min(1, "Escribe tu nombre."),
});
