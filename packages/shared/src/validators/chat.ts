import { z } from "zod";

/**
 * Un adjunto de chat. `path` es la ruta DENTRO del bucket privado chat-media,
 * nunca una URL: las URLs de ese bucket son firmadas y caducan, asi que
 * guardarlas en la base seria guardar algo que deja de servir.
 *
 * La forma se valida tambien en la base (constraint messages_attachments_validos),
 * y no por duplicar por gusto: la policy de INSERT de messages deja escribir al
 * participante DIRECTAMENTE desde el navegador con la llave anon. Esta capa da
 * el mensaje de error legible; la de la base es la que de verdad obliga.
 */
export const chatAttachmentSchema = z.object({
  path: z.string().min(1).max(300),
  tipo: z.literal("image"),
  /** Dimensiones reales del archivo subido, para reservar el hueco y que la
   *  conversacion no pegue un salto cuando la imagen termina de cargar. */
  w: z.number().int().positive().max(20000).optional(),
  h: z.number().int().positive().max(20000).optional(),
});

export const MAX_ADJUNTOS_POR_MENSAJE = 5;

/**
 * texto pasa a `min(0)`: una foto sola es un mensaje valido y viaja con texto
 * vacio, porque messages.texto es NOT NULL y no admite default. El refinamiento
 * de abajo es el que impide que eso abra la puerta al mensaje sin nada.
 */
export const sendMessageSchema = z
  .object({
    chat_id: z.string().uuid(),
    texto: z.string().max(2000),
    attachments: z.array(chatAttachmentSchema).max(MAX_ADJUNTOS_POR_MENSAJE).default([]),
  })
  .refine((v) => v.texto.trim().length > 0 || v.attachments.length > 0, {
    message: "El mensaje no puede estar vacío",
    path: ["texto"],
  });

export const getOrCreateChatSchema = z.object({
  seller_id: z.string().uuid(),
  product_id: z.string().uuid().optional(),
});

export const markChatReadSchema = z.object({
  chat_id: z.string().uuid(),
});

/**
 * Contrato de contacto/compra: una sola operacion que obtiene o crea la
 * conversacion y, si la intencion es de compra, registra el aviso "quiere
 * comprar" con una clave de idempotencia (uuid generado por el cliente al
 * pintar el boton). Repetir la misma clave no duplica; una clave nueva es
 * una intencion nueva. Los limites reales viven en la RPC iniciar_conversacion
 * (20260912300000): esto solo da un mensaje legible antes de ir a la base.
 */
export const INTENCIONES_CONVERSACION = ["contacto", "compra"] as const;

export const iniciarConversacionSchema = z
  .object({
    seller_id: z.string().uuid(),
    product_id: z.string().uuid().optional(),
    intencion: z.enum(INTENCIONES_CONVERSACION).default("contacto"),
    clave: z.string().uuid().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.intencion === "compra" && (!v.product_id || !v.clave)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "La intención de compra necesita producto y clave de idempotencia",
        path: ["clave"],
      });
    }
  });

export type SendMessageInput = z.infer<typeof sendMessageSchema>;
export type IniciarConversacionInput = z.infer<typeof iniciarConversacionSchema>;
export type ChatAttachment = z.infer<typeof chatAttachmentSchema>;
export type GetOrCreateChatInput = z.infer<typeof getOrCreateChatSchema>;
export type MarkChatReadInput = z.infer<typeof markChatReadSchema>;
