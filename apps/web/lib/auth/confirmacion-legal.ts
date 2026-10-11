import { z } from "zod";
import { destinoAutenticadoSeguro } from "./destino-seguro";
import { esRutaLegal } from "../navigation/rutas-legales";

export const legalStateSchema = z.object({
  confirmed: z.boolean(),
  documents: z.array(z.object({ documento: z.enum(["terminos", "aviso"]), version: z.string().min(1), confirmada: z.boolean() })).length(2),
}).superRefine((state, ctx) => {
  if (new Set(state.documents.map(doc => doc.documento)).size !== 2
    || state.confirmed !== state.documents.every(doc => doc.confirmada)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "Estado de confirmación legal inválido." });
  }
});
export type LegalState = z.infer<typeof legalStateSchema>;

export function rutaConfirmacionCuenta(next: unknown): string {
  const destino = destinoAutenticadoSeguro(next);
  return `/confirmar-cuenta?next=${encodeURIComponent(destino.startsWith("/confirmar-cuenta") ? "/" : destino)}`;
}

/** A valid session with no acknowledgement can still reach these routes. */
export function exentaDeConfirmacionLegal(ruta: string): boolean {
  const path = ruta.split(/[?#]/, 1)[0] ?? "/";
  return esRutaLegal(path) || ["/confirmar-cuenta", "/auth", "/callback", "/forgot-password", "/reset-password", "/logout", "/cuenta-eliminada", "/centro-de-ayuda"]
    .some(base => path === base || path.startsWith(`${base}/`));
}
