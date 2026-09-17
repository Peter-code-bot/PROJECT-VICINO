import { SkeletonFormulario } from "@/components/shared/loading-skeletons";

/**
 * Sin este archivo la ruta hereda el loading del padre, que describe la
 * configuracion entera y no cuatro interruptores. Y sin ningun loading, la
 * navegacion se queda sin dibujar hasta que el servidor contesta: es la leccion
 * de latencia del 5-sep-2026, cuando la app no tenia un solo loading.tsx.
 */
export default function Loading() {
  return <SkeletonFormulario n={4} etiqueta="Cargando tus preferencias de notificaciones" />;
}
