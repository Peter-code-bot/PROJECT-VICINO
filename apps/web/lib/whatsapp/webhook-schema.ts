import { z } from "zod";

/**
 * Forma minima que debe tener un aviso de Meta para molestar a la base. El
 * desglose de verdad (entry/changes/value/messages/statuses) lo hace el RPC
 * ingerir_webhook_whatsapp campo por campo; aqui solo se descarta lo que ni
 * siquiera parece un webhook de Graph API. `looseObject` deja pasar las
 * claves que Meta agregue despues.
 */
export const cuerpoWebhookMetaSchema = z.looseObject({
  object: z.string().min(1).max(64),
  // Meta agrupa hasta 1000 cambios por aviso.
  entry: z.array(z.looseObject({})).max(1000).optional(),
});

export type CuerpoWebhookMeta = z.infer<typeof cuerpoWebhookMetaSchema>;

export const OBJETO_WHATSAPP = "whatsapp_business_account";

/** Lo que devuelve el RPC. Se valida porque es lo que se responde a Meta y lo que se mide. */
export const resumenIngestaSchema = z.looseObject({
  duplicado: z.boolean(),
  nuevos: z.number().int().nonnegative(),
  estados: z.number().int().nonnegative(),
  sin_canal: z.number().int().nonnegative(),
  ignorados: z.number().int().nonnegative(),
});

export type ResumenIngesta = z.infer<typeof resumenIngestaSchema>;
