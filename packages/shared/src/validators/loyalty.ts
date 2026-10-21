import { z } from "zod";
import { LIMITES_LEALTAD, PALETA_LEALTAD, PLANTILLAS_LEALTAD } from "../constants/loyalty";

// El vendedor y el cliente nunca viajan en el payload: la base los deriva de
// auth.uid() (misma regla que sale-confirmation.ts).

export const loyaltyProgramSchema = z.object({
  nombre: z
    .string()
    .trim()
    .min(1, "Ponle nombre a tu programa")
    .max(LIMITES_LEALTAD.nombre, `El nombre tiene máximo ${LIMITES_LEALTAD.nombre} caracteres`),
  premio: z
    .string()
    .trim()
    .min(1, "Describe el premio")
    .max(LIMITES_LEALTAD.premio, `El premio tiene máximo ${LIMITES_LEALTAD.premio} caracteres`),
  meta_sellos: z.coerce
    .number()
    .int("La meta debe ser un número entero")
    .min(LIMITES_LEALTAD.metaMin, `Mínimo ${LIMITES_LEALTAD.metaMin} sellos`)
    .max(LIMITES_LEALTAD.metaMax, `Máximo ${LIMITES_LEALTAD.metaMax} sellos`),
  condiciones: z
    .string()
    .trim()
    .max(LIMITES_LEALTAD.condiciones, `Las condiciones tienen máximo ${LIMITES_LEALTAD.condiciones} caracteres`)
    .optional()
    .transform((valor) => (valor ? valor : undefined)),
  color: z.enum(PALETA_LEALTAD, { message: "Elige un color de la paleta" }),
  plantilla: z.enum(PLANTILLAS_LEALTAD, { message: "Elige una plantilla" }),
});
export type LoyaltyProgramInput = z.infer<typeof loyaltyProgramSchema>;

export const loyaltyProgramStatusSchema = z.enum(["activo", "pausado"]);

export const loyaltyEnrollSchema = z.object({ programId: z.string().uuid() });

export const loyaltyRedeemStartSchema = z.object({
  membershipId: z.string().uuid(),
  clave: z.string().uuid(),
});

export const loyaltyConfirmRedemptionSchema = z.object({
  codigo: z
    .string()
    .trim()
    .regex(/^[0-9]{6}$/, "El código tiene 6 dígitos"),
});

export const loyaltyReverseEventSchema = z.object({
  eventId: z.string().uuid(),
  motivo: z
    .string()
    .trim()
    .max(LIMITES_LEALTAD.motivoReversa, `El motivo tiene máximo ${LIMITES_LEALTAD.motivoReversa} caracteres`)
    .optional()
    .transform((valor) => (valor ? valor : undefined)),
});

export const walletProviderSchema = z.enum(["apple", "google"]);
export type WalletProvider = z.infer<typeof walletProviderSchema>;
