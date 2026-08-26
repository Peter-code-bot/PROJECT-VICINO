import {
  Armchair, Baby, BookOpen, Briefcase, Building, Cake, Camera, Car, Code,
  Dumbbell, Gamepad2, Gem, Gift, GraduationCap, Hammer, HeartPulse, Home,
  MoreHorizontal, Mountain, Package, Palette, PartyPopper, PawPrint,
  Refrigerator, Shirt, Smartphone, Sparkles, Stethoscope, Ticket, Truck,
  UtensilsCrossed, Warehouse, Wrench,
  type LucideIcon,
} from "lucide-react";
import { CATEGORIES } from "@vicino/shared";

/**
 * Un solo mapa de iconos de categoria, derivado del catalogo.
 *
 * Habia CUATRO copias del mismo Record<string, LucideIcon> con las mismas 32
 * entradas: en el home, en los filtros de busqueda, en la barra lateral y en
 * el feed de solicitudes. Anadir una categoria obligaba a tocar las cuatro, y
 * olvidarse de una no rompia nada de forma visible — solo salia un icono
 * generico en esa pantalla y no en las otras.
 *
 * Ahora el nombre del icono vive donde vive la categoria (el campo `icon` de
 * CATEGORIES) y aqui solo queda la traduccion de ese nombre al componente.
 * El coste de anadir una categoria baja de cuatro sitios a uno, mas este si
 * el icono es nuevo.
 *
 * Se importan los 33 por nombre y NO con `import * as`: el comodin traeria la
 * libreria entera al paquete y anularia el optimizePackageImports que ya
 * configura next.config.ts para lucide-react.
 */
const POR_NOMBRE: Record<string, LucideIcon> = {
  Armchair, Baby, BookOpen, Briefcase, Building, Cake, Camera, Car, Code,
  Dumbbell, Gamepad2, Gem, Gift, GraduationCap, Hammer, HeartPulse, Home,
  MoreHorizontal, Mountain, Package, Palette, PartyPopper, PawPrint,
  Refrigerator, Shirt, Smartphone, Sparkles, Stethoscope, Ticket, Truck,
  UtensilsCrossed, Warehouse, Wrench,
};

/** Icono de reserva. Es el mismo `?? MoreHorizontal` que ya hacian los cuatro. */
export const ICONO_POR_DEFECTO: LucideIcon = MoreHorizontal;

export const ICONO_POR_SLUG: Record<string, LucideIcon> = Object.fromEntries(
  CATEGORIES.map((c) => [c.slug, POR_NOMBRE[c.icon] ?? ICONO_POR_DEFECTO]),
);

/** Nunca devuelve undefined: una categoria desconocida cae al icono generico. */
export function iconoDeCategoria(slug: string | null | undefined): LucideIcon {
  return (slug && ICONO_POR_SLUG[slug]) || ICONO_POR_DEFECTO;
}
