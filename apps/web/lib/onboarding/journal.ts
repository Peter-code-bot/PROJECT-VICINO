import type { GuardarPasoInput } from "@/app/(onboarding)/completar-perfil/actions";
import { esPasoOnboarding, type CaminoOnboarding, type PasoOnboardingActual } from "./steps";

/** Only explicitly continued fields enter the journal. Editable drafts live separately. */
export interface OnboardingCheckpoint {
  operationId: string;
  expectedRevision: number | null;
  fromStep: PasoOnboardingActual;
  nextStep: PasoOnboardingActual;
  camino: CaminoOnboarding;
  fields: GuardarPasoInput;
  /** Replays also invalidate the cached entry layout after a path-choice ACK. */
  purpose?: "path-choice";
  /** A dispatched operation may have committed until a canonical response proves otherwise. */
  uncertain?: boolean;
}

export interface OnboardingJournal {
  version: 1;
  userId: string;
  baseRevision: number;
  entries: OnboardingCheckpoint[];
  viewStep: PasoOnboardingActual;
  camino: CaminoOnboarding;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STRING_LIMITS: Record<string, number> = {
  username: 30, nombre: 60, bio: 160, foto: 4096, categoria_negocio: 100,
  nombre_negocio: 100, descripcion_negocio: 1000, metodos_pago_aceptados: 500,
};
const MAX_ENTRIES = 40;

function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function validFields(value: unknown): value is GuardarPasoInput {
  if (!record(value) || Object.keys(value).length > 1) return false;
  return Object.entries(value).every(([key, field]) => {
    if (key === "seller_type") return field === "casual" || field === "business";
    if (key === "intereses") return Array.isArray(field) && field.length <= 5
      && field.every((item) => typeof item === "string" && item.length <= 100);
    return key in STRING_LIMITS && typeof field === "string" && field.length <= STRING_LIMITS[key]!;
  });
}

export function journalStorageKey(userId: string): string {
  return `vicino_onboarding_journal_v1:${userId}`;
}

export function createOnboardingJournal(userId: string, step: PasoOnboardingActual, camino: CaminoOnboarding, revision = 0): OnboardingJournal {
  return { version: 1, userId, baseRevision: revision, entries: [], viewStep: step, camino };
}

/** Malformed/foreign data is never replayed. The caller must surface corrupt pending data. */
export function parseOnboardingJournal(raw: string | null, userId: string): OnboardingJournal | null {
  if (raw === null) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (!record(value) || value.version !== 1 || value.userId !== userId
      || !Number.isSafeInteger(value.baseRevision) || Number(value.baseRevision) < 0
      || typeof value.viewStep !== "string" || !esPasoOnboarding(value.viewStep)
      || (value.camino !== "explorar" && value.camino !== "vender")
      || !Array.isArray(value.entries) || value.entries.length > MAX_ENTRIES) return null;
    const ids = new Set<string>();
    let prepared = false;
    for (const entry of value.entries) {
      if (!record(entry) || typeof entry.operationId !== "string" || !UUID.test(entry.operationId)
        || ids.has(entry.operationId) || (entry.expectedRevision !== null && (!Number.isSafeInteger(entry.expectedRevision) || Number(entry.expectedRevision) < 0))
        || typeof entry.fromStep !== "string" || !esPasoOnboarding(entry.fromStep)
        || typeof entry.nextStep !== "string" || !esPasoOnboarding(entry.nextStep)
        || (entry.camino !== "explorar" && entry.camino !== "vender") || !validFields(entry.fields)) return null;
      if (entry.uncertain !== undefined && typeof entry.uncertain !== "boolean") return null;
      if (entry.purpose !== undefined && (entry.purpose !== "path-choice" || Object.keys(entry.fields).length !== 0
        || entry.nextStep !== (entry.camino === "vender" ? "categoria" : "usuario"))) return null;
      // Only the head can have been dispatched. Its revision survives a lost response.
      if (entry.expectedRevision !== null && (prepared || ids.size > 0)) return null;
      if (entry.expectedRevision !== null) prepared = true;
      ids.add(entry.operationId);
    }
    return value as unknown as OnboardingJournal;
  } catch { return null; }
}

export function appendOnboardingCheckpoint(journal: OnboardingJournal, input: {
  operationId: string; revision: number; fromStep: PasoOnboardingActual;
  nextStep: PasoOnboardingActual; camino: CaminoOnboarding; fields?: GuardarPasoInput; purpose?: "path-choice";
}): OnboardingJournal {
  if (journal.entries.length >= MAX_ENTRIES) throw new Error("Espera a que se guarden tus pasos pendientes antes de continuar.");
  if (!UUID.test(input.operationId) || journal.entries.some((entry) => entry.operationId === input.operationId)) {
    throw new Error("No se pudo preparar el guardado. Intenta de nuevo.");
  }
  if (!validFields(input.fields ?? {})) throw new Error("Revisa los datos de este paso antes de continuar.");
  if (input.purpose && (Object.keys(input.fields ?? {}).length !== 0
    || input.nextStep !== (input.camino === "vender" ? "categoria" : "usuario")))
    throw new Error("Revisa cómo quieres empezar antes de continuar.");
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) throw new Error("No pudimos recuperar la versión de tu perfil.");
  const entry: OnboardingCheckpoint = {
    operationId: input.operationId, expectedRevision: null,
    fromStep: input.fromStep, nextStep: input.nextStep, camino: input.camino,
    // Detach arrays and values from subsequent edits to the form.
    fields: JSON.parse(JSON.stringify(input.fields ?? {})) as GuardarPasoInput,
    ...(input.purpose ? { purpose: input.purpose } : {}),
    uncertain: false,
  };
  return { ...journal, baseRevision: journal.entries.length ? journal.baseRevision : input.revision,
    entries: [...journal.entries, entry], viewStep: input.nextStep, camino: input.camino };
}

/** Revisions are assigned from the actual ACK, never guessed as previous + 1. */
export function prepareOnboardingCheckpoint(journal: OnboardingJournal, revision: number): OnboardingJournal {
  const head = journal.entries[0];
  if (!head || (head.expectedRevision !== null && head.uncertain === true)) return journal;
  if (!Number.isSafeInteger(revision) || revision < 0) throw new Error("No pudimos recuperar la versión de tu perfil.");
  return { ...journal, entries: [{ ...head, expectedRevision: head.expectedRevision ?? revision, uncertain: true }, ...journal.entries.slice(1)] };
}

export function acknowledgeOnboardingCheckpoint(journal: OnboardingJournal, operationId: string, revision = journal.baseRevision): OnboardingJournal {
  if (journal.entries[0]?.operationId !== operationId) throw new Error("El orden del guardado cambió. Recupera tu avance antes de continuar.");
  return { ...journal, baseRevision: revision, entries: journal.entries.slice(1) };
}
