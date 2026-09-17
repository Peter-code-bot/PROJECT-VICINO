import { SkeletonFormulario } from "@/components/shared/loading-skeletons";

/**
 * Un paso del alta sin loading deja la pantalla anterior congelada al tocar
 * "Continuar", que es justo donde se abandona el alta. Misma razon que el
 * loading de /configuracion/notificaciones.
 */
export default function Loading() {
  return <SkeletonFormulario n={3} etiqueta="Cargando el paso de notificaciones" />;
}
