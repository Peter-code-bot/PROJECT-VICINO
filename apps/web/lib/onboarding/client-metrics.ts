import type { PasoOnboardingActual } from "./steps";

type Action = "continue" | "skip" | "back" | "finish";
interface NavigationSample { started: number; step: PasoOnboardingActual; action: Action }
let navigation: NavigationSample | null = null;

/** Events contain timing and step enums only, never profile fields or coordinates. */
function emit(detail: Record<string, string | number>) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("vicino:onboarding-metric", { detail }));
}

export function startOnboardingNavigation(step: PasoOnboardingActual, action: Action) {
  navigation = { started: performance.now(), step, action };
  const sample = navigation;
  requestAnimationFrame(() => emit({ metric: "feedback", step, action, duration: performance.now() - sample.started }));
}

export function finishOnboardingNavigation(step: PasoOnboardingActual): () => void {
  const sample = navigation;
  if (!sample) return () => {};
  let secondFrame = 0;
  const firstFrame = requestAnimationFrame(() => {
    secondFrame = requestAnimationFrame(() => {
      if (navigation !== sample) return;
      emit({ metric: "view", step, from: sample.step, action: sample.action, duration: performance.now() - sample.started });
      navigation = null;
    });
  });
  return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
}

export function recordOnboardingAcknowledgement(step: PasoOnboardingActual, started: number, status: "saved" | "error" | "conflict") {
  emit({ metric: "ack", step, status, duration: performance.now() - started });
}
