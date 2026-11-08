/**
 * El ajuste de foco del onboarding solo corre cuando la altura visible BAJA.
 *
 * Al crecer (se cierra el teclado), el borde inferior del área desplazable baja
 * G px, su borde superior no se mueve y el navegador solo puede recortar el
 * scrollTop C ≤ G px: un campo que se veía se sigue viendo. Si el ajuste actuara
 * al crecer, sería porque la persona dejó el campo fuera de vista a propósito
 * (por ejemplo, bajó para leer y cerró el teclado con Atrás, que no quita el
 * foco), y la vista volvería sola al campo sin que nadie lo pidiera.
 *
 * visualViewport da alturas fraccionarias: la tolerancia evita reaccionar al ruido.
 */
export const TOLERANCIA_ALTURA_PX = 1;

export function debeAjustarPorAltura(previa: number | undefined, actual: number): boolean {
  if (previa === undefined || !Number.isFinite(previa) || !Number.isFinite(actual)) return false;
  return actual < previa - TOLERANCIA_ALTURA_PX;
}
