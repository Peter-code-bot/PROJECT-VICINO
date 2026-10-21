/**
 * Limites de producto del programa de lealtad (PDF de Alejandro, seccion 2).
 * Son decisiones de producto, no maximos de Apple ni de Google: la vista
 * previa valida los recortes con nombres largos.
 */
export const LIMITES_LEALTAD = {
  nombre: 32,
  premio: 60,
  condiciones: 500,
  metaMin: 3,
  metaMax: 20,
  motivoReversa: 200,
} as const;

/**
 * Paleta cerrada: colores oscuros con contraste suficiente para texto blanco
 * (los dos primeros son la marca de VICINO). Sin editor libre, sin HTML/CSS.
 */
export const PALETA_LEALTAD = [
  "#1F5A4E",
  "#2E8773",
  "#1A1A2E",
  "#7C2D12",
  "#9D174D",
  "#1E3A8A",
  "#5B21B6",
  "#B45309",
] as const;
export type ColorLealtad = (typeof PALETA_LEALTAD)[number];

export const PLANTILLAS_LEALTAD = ["clasica", "sellos", "minimal"] as const;
export type PlantillaLealtad = (typeof PLANTILLAS_LEALTAD)[number];

export const ETIQUETAS_PLANTILLA: Record<PlantillaLealtad, string> = {
  clasica: "Clásica",
  sellos: "Cuadrícula de sellos",
  minimal: "Minimal",
};

export const ESTADOS_PROGRAMA = ["borrador", "activo", "pausado", "archivado"] as const;
export type EstadoPrograma = (typeof ESTADOS_PROGRAMA)[number];

/** Minutos de vida de un codigo de canje (loyalty_canje_iniciar). */
export const MINUTOS_CANJE = 15;
