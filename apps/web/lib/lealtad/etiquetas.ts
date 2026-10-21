/** Etiquetas de estado para el panel del negocio (fuera del render: react-hooks/purity). */
export function etiquetaCanje(status: string, expiresAt: string, ahora: number = Date.now()): string {
  if (status === "canjeado") return "Entregado";
  if (status === "cancelado") return "Cancelado";
  if (status === "pendiente") return Date.parse(expiresAt) < ahora ? "Expirado" : "Pendiente";
  return "Expirado";
}
