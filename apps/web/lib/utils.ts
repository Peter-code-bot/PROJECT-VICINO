import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const UNIVERSITY_COLORS: Record<string, string> = {
  "BUAP": "#003B5C",
  "UDLAP": "#006F53",
  "UPAEP": "#E31837",
  "Tecnológico de Monterrey": "#0033A0",
  "Universidad Iberoamericana": "#E03C31",
  "Universidad Anáhuac": "#FF5900",
  "UVM": "#CE1126",
  "UMAD": "#003E7E",
  "UVP": "#003366",
  "Otra": "#0ea5e9" // sky-500
};

export function getContrastYIQ(hexcolor: string): string {
  // Remove # if present
  hexcolor = hexcolor.replace("#", "");
  // Parse r, g, b values
  const r = parseInt(hexcolor.substring(0, 2), 16);
  const g = parseInt(hexcolor.substring(2, 4), 16);
  const b = parseInt(hexcolor.substring(4, 6), 16);
  // Calculate YIQ contrast ratio
  const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
  // Return black or white depending on the YIQ value
  return (yiq >= 128) ? "#000000" : "#ffffff";
}
