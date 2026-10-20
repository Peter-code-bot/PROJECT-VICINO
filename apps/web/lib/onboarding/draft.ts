import type { OnboardingProfile } from "@/app/(onboarding)/completar-perfil/load-profile";
import type { GuardarPasoInput } from "@/app/(onboarding)/completar-perfil/actions";
import type { PasoOnboardingActual } from "./steps";

export interface OnboardingDraft {
  username: string; nombre: string; foto: string; bio: string;
  categoria: string | null; tipo: "casual" | "business";
  nombreNegocio: string; descripcionNegocio: string; pagos: string[]; intereses: string[];
}

export function initialOnboardingDraft(profile: OnboardingProfile): OnboardingDraft {
  return {
    username: profile.username, nombre: profile.nombre ?? "", foto: profile.foto ?? "", bio: profile.bio ?? "",
    categoria: profile.categoria_negocio, tipo: profile.seller_type === "business" ? "business" : "casual",
    nombreNegocio: profile.nombre_negocio ?? "", descripcionNegocio: profile.descripcion_negocio ?? "",
    pagos: profile.metodos_pago_aceptados?.split(",").map((value) => value.trim()).filter(Boolean) ?? [],
    intereses: profile.intereses ?? [],
  };
}

/** Refresh untouched values without losing edits when the same account receives a new snapshot. */
export function reconcileOnboardingDraft(draft: OnboardingDraft, previous: OnboardingProfile, next: OnboardingProfile): OnboardingDraft {
  const before = initialOnboardingDraft(previous);
  const after = initialOnboardingDraft(next);
  const value = <K extends keyof OnboardingDraft>(key: K): OnboardingDraft[K] =>
    JSON.stringify(draft[key]) === JSON.stringify(before[key]) ? after[key] : draft[key];
  return { username: value("username"), nombre: value("nombre"), foto: value("foto"), bio: value("bio"),
    categoria: value("categoria"), tipo: value("tipo"), nombreNegocio: value("nombreNegocio"),
    descripcionNegocio: value("descripcionNegocio"), pagos: value("pagos"), intereses: value("intereses") };
}

export function restoreOnboardingDraft(profile: OnboardingProfile, raw: string | null): OnboardingDraft {
  const clean = initialOnboardingDraft(profile);
  try {
    const saved: unknown = JSON.parse(raw ?? "null");
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return clean;
    const values = saved as Record<string, unknown>;
    for (const key of ["username", "nombre", "foto", "bio", "nombreNegocio", "descripcionNegocio"] as const) {
      if (typeof values[key] === "string") clean[key] = values[key];
    }
    if (typeof values.categoria === "string" || values.categoria === null) clean.categoria = values.categoria;
    if (values.tipo === "business" || values.tipo === "casual") clean.tipo = values.tipo;
    for (const key of ["pagos", "intereses"] as const) {
      if (Array.isArray(values[key]) && values[key].every((value) => typeof value === "string")) clean[key] = values[key];
    }
  } catch { /* A broken editable cache never changes server data. */ }
  return clean;
}

export function fieldsForOnboardingStep(step: PasoOnboardingActual, draft: OnboardingDraft, negocio: boolean): GuardarPasoInput {
  switch (step) {
    case "categoria": return draft.categoria ? { categoria_negocio: draft.categoria } : {};
    case "tipo": return { seller_type: draft.tipo };
    case "usuario": return { username: draft.username };
    case "nombre": return negocio ? { nombre_negocio: draft.nombreNegocio.trim() } : { nombre: draft.nombre.trim() };
    case "foto": return { foto: draft.foto };
    case "descripcion": return negocio ? { descripcion_negocio: draft.descripcionNegocio.trim() } : { bio: draft.bio.trim() };
    case "pagos": return { metodos_pago_aceptados: draft.pagos.join(", ") };
    case "intereses": return { intereses: [...draft.intereses] };
    default: return {};
  }
}

/** Skip resets only this question. It never accepts new text or an uploaded file. */
export function discardOnboardingStepDraft(draft: OnboardingDraft, accepted: OnboardingProfile, step: PasoOnboardingActual, negocio: boolean): OnboardingDraft {
  const saved = initialOnboardingDraft(accepted);
  const key = step === "categoria" ? "categoria" : step === "tipo" ? "tipo" : step === "usuario" ? "username"
    : step === "nombre" ? negocio ? "nombreNegocio" : "nombre"
      : step === "foto" ? "foto" : step === "descripcion" ? negocio ? "descripcionNegocio" : "bio"
        : step === "pagos" ? "pagos" : step === "intereses" ? "intereses" : null;
  return key ? { ...draft, [key]: saved[key] } : draft;
}
