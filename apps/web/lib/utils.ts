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
