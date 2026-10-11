/** One URL and one saved marker per question. `perfil` is a legacy marker. */
export const PASOS_ONBOARDING = [
  "categoria", "tipo", "usuario", "nombre", "foto", "descripcion", "pagos",
  "intereses", "ubicacion", "activar", "notificaciones", "listo",
] as const;

export type PasoOnboardingActual = (typeof PASOS_ONBOARDING)[number];
export type PasoOnboarding = PasoOnboardingActual | "perfil";
export type CaminoOnboarding = "explorar" | "vender";

export interface OnboardingContext {
  camino: CaminoOnboarding;
  tipo: "casual" | "business";
}

export function esPasoOnboarding(value: string): value is PasoOnboardingActual {
  return PASOS_ONBOARDING.some((step) => step === value);
}

export function pasosDelCamino({ camino, tipo }: OnboardingContext): PasoOnboardingActual[] {
  return PASOS_ONBOARDING.filter((step) => {
    if (["categoria", "tipo", "activar"].includes(step)) return camino === "vender";
    if (step === "pagos") return camino === "vender" && tipo === "business";
    return true;
  });
}

export function pasoParaReanudar(value: string | null, context: OnboardingContext): PasoOnboardingActual {
  const steps = pasosDelCamino(context);
  if (value === "perfil") return "usuario";
  return value && esPasoOnboarding(value) && steps.includes(value) ? value : steps[0]!;
}

export function siguientePaso(step: PasoOnboardingActual, context: OnboardingContext): PasoOnboardingActual | null {
  const steps = pasosDelCamino(context);
  const index = steps.indexOf(step);
  return index < 0 ? steps[0]! : steps[index + 1] ?? null;
}

export function rutaDePaso(step: PasoOnboardingActual, camino?: CaminoOnboarding): string {
  return `/completar-perfil/${step}${camino === "vender" ? "?camino=vender" : ""}`;
}
