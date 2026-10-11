"use client";

import { createContext, startTransition, useCallback, useContext, useEffect, useEffectEvent, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { guardarCheckpointOnboarding, finalizarOnboarding, type GuardarPasoInput } from "./actions";
import type { OnboardingProfile } from "./load-profile";
import { acknowledgeOnboardingCheckpoint, appendOnboardingCheckpoint, createOnboardingJournal, journalStorageKey, parseOnboardingJournal, prepareOnboardingCheckpoint, type OnboardingJournal } from "@/lib/onboarding/journal";
import { discardOnboardingStepDraft, initialOnboardingDraft, restoreOnboardingDraft, type OnboardingDraft } from "@/lib/onboarding/draft";
import { pasoParaReanudar, rutaDePaso, type CaminoOnboarding, type PasoOnboardingActual } from "@/lib/onboarding/steps";
import { recordOnboardingAcknowledgement } from "@/lib/onboarding/client-metrics";
import { conTope, esTope } from "@/lib/auth/con-tope";

interface FinalOperation { operationId: string; expectedRevision: number; decision: "explorar" | "activar" }
const SessionContext = createContext<ReturnType<typeof useSessionController> | null>(null);

function useSessionController(input: OnboardingProfile) {
  const [initial] = useState(input);
  const router = useRouter();
  const [profile, setProfile] = useState(initial);
  const [draft, setDraft] = useState(() => initialOnboardingDraft(initial));
  const [pending, setPending] = useState(0);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notificacionesResueltas, setNotificacionesResueltas] = useState(false);
  const [finalPending, setFinalPending] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const confirmed = useRef(initial);
  const editable = useRef(draft);
  const journal = useRef<OnboardingJournal | null>(null);
  const durablePending = useRef(false);
  const failed = useRef(false);
  const mounted = useRef(false);
  const accountValid = useRef(true);
  const bootstrapped = useRef(false);
  const notificationAdvance = useRef(false);
  const knownResolvedPermission = useRef(false);
  const generation = useRef(0);
  const drainPromise = useRef<{ generation: number; promise: Promise<void> } | null>(null);
  const finalOperation = useRef<FinalOperation | null>(null);
  const rejectedOperation = useRef<string | null>(null);
  const queueKey = journalStorageKey(initial.id);
  const draftKey = `vicino_onboarding_draft:${initial.id}`;
  const finalKey = `vicino_onboarding_final_v1:${initial.id}`;
  const onPermissionRead = useEffectEvent((permission: string) => notifyPermission(permission));

  const persistJournal = useCallback((next: OnboardingJournal): boolean => {
    if (!mounted.current || !accountValid.current) return false;
    journal.current = next;
    if (mounted.current) setPending(next.entries.length);
    try { sessionStorage.setItem(queueKey, JSON.stringify(next)); durablePending.current = next.entries.length > 0; return true; }
    catch { return false; }
  }, [queueKey]);

  const mergeCanonical = useCallback((snapshot: OnboardingProfile) => {
    if (snapshot.id !== initial.id) throw new Error("Tu sesión cambió. Vuelve a entrar para continuar.");
    // A replay receipt can precede the snapshot loaded after a page refresh.
    if (snapshot.onboarding_revision >= confirmed.current.onboarding_revision) {
      confirmed.current = snapshot;
      if (mounted.current) setProfile(snapshot);
    }
  }, [initial.id]);

  const flush = useCallback((retry = false): Promise<void> => {
    const epoch = generation.current;
    if (drainPromise.current?.generation === epoch) return drainPromise.current.promise;
    if (failed.current && !retry) return Promise.reject(new Error("Hay cambios pendientes de guardar. Reintenta antes de continuar."));
    failed.current = false;
    if (mounted.current) setError("");
    const work = async () => {
      while (journal.current?.entries.length) {
        if (!accountValid.current || !mounted.current || generation.current !== epoch) throw new Error("Tu sesión cambió. Vuelve a entrar para continuar.");
        if (navigator.onLine === false) throw new Error("Sin conexión. Tus pasos están pendientes de guardar; reintenta cuando vuelva la conexión.");
        const previousHead = journal.current.entries[0]!;
        const wasUncertain = previousHead.uncertain ?? previousHead.expectedRevision !== null;
        const prepared = persistJournal(prepareOnboardingCheckpoint(journal.current, journal.current.baseRevision));
        if (!prepared && durablePending.current) throw new Error("No pudimos proteger los pasos pendientes en esta sesión. Reintenta antes de continuar.");
        const entry = journal.current.entries[0]!;
        const started = performance.now();
        const result = await conTope(guardarCheckpointOnboarding({ expectedUserId: initial.id, operationId: entry.operationId,
          expectedRevision: entry.expectedRevision!, fromStep: entry.fromStep, nextStep: entry.nextStep, camino: entry.camino, fields: entry.fields }));
        if (!accountValid.current || !mounted.current || generation.current !== epoch) throw new Error("Tu sesión cambió. Vuelve a entrar para continuar.");
        if ("error" in result && result.error) {
          const definitive = result.conflict || (!result.uncertain && !wasUncertain);
          rejectedOperation.current = definitive && !result.conflict ? entry.operationId : null;
          if (definitive) persistJournal({ ...journal.current!, entries: [{ ...entry, uncertain: false }, ...journal.current!.entries.slice(1)] });
          const changed = "conflict" in result && result.conflict;
          recordOnboardingAcknowledgement(entry.fromStep, started, changed ? "conflict" : "error");
          if (changed && result.data) { mergeCanonical(result.data.snapshot); if (mounted.current) setConflict(true); }
          throw new Error(result.error);
        }
        if (!("data" in result) || !result.data || result.data.status !== "saved") throw new Error("No pudimos confirmar el guardado. Reintenta para recuperar tu avance.");
        mergeCanonical(result.data.snapshot);
        const acknowledged = persistJournal(acknowledgeOnboardingCheckpoint(journal.current!, entry.operationId, result.data.revision));
        recordOnboardingAcknowledgement(entry.fromStep, started, "saved");
        if (mounted.current) setUncertain(false);
        if (!acknowledged && journal.current!.entries.length) throw new Error("El último paso se guardó, pero no pudimos proteger los siguientes. Reintenta para continuar.");
      }
    };
    const promise = work().catch((failure: unknown) => {
      if (generation.current !== epoch || !mounted.current) throw failure;
      failed.current = true;
      const head = journal.current?.entries[0];
      setUncertain(head?.uncertain ?? (head?.expectedRevision !== null && head?.expectedRevision !== undefined));
      setError(esTope(failure) ? "Falta confirmar el guardado. Tus pasos siguen pendientes; reintenta con la misma operación."
        : failure instanceof Error ? failure.message : "No pudimos guardar tu avance. Tus pasos siguen pendientes; reintenta.");
      throw failure;
    }).finally(() => { if (drainPromise.current?.promise === promise) drainPromise.current = null; });
    drainPromise.current = { generation: epoch, promise };
    return promise;
  }, [initial.id, mergeCanonical, persistJournal]);

  useEffect(() => {
    generation.current += 1;
    mounted.current = true;
    let disposed = false;
    let unsubscribe: (() => void) | undefined;
    startTransition(() => {
      const camino: CaminoOnboarding = new URLSearchParams(window.location.search).get("camino") === "vender" || initial.onboarding_camino === "vender" ? "vender" : "explorar";
      const step = pasoParaReanudar(initial.onboarding_paso, { camino, tipo: initial.seller_type === "business" ? "business" : "casual" });
      let recovered: OnboardingJournal | null = null;
      let corrupt = false;
      try {
        const raw = sessionStorage.getItem(queueKey);
        recovered = parseOnboardingJournal(raw, initial.id);
        const recoveredHead = recovered?.entries[0];
        setUncertain(recoveredHead?.uncertain ?? (recoveredHead?.expectedRevision !== null && recoveredHead?.expectedRevision !== undefined));
        durablePending.current = !!recovered?.entries.length;
        corrupt = raw !== null && recovered === null;
        const savedDraft = restoreOnboardingDraft(initial, sessionStorage.getItem(draftKey));
        editable.current = savedDraft; setDraft(savedDraft);
        const rawFinal = sessionStorage.getItem(finalKey);
        if (rawFinal) {
          let saved: unknown;
          try { saved = JSON.parse(rawFinal); } catch { corrupt = true; }
          if (saved && typeof saved === "object" && "operationId" in saved && typeof saved.operationId === "string"
            && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(saved.operationId)
            && "expectedRevision" in saved && Number.isSafeInteger(saved.expectedRevision) && Number(saved.expectedRevision) >= 0
            && "decision" in saved && (saved.decision === "activar" || saved.decision === "explorar")) {
            finalOperation.current = saved as FinalOperation;
            setFinalPending(true);
          }
          else corrupt = true;
        }
      } catch { /* Blocked storage uses server-confirmed navigation instead. */ }
      if (corrupt) {
        failed.current = true; setConflict(true);
        setError("No pudimos recuperar los pasos pendientes de esta sesión. Puedes volver al avance guardado.");
        journal.current = createOnboardingJournal(initial.id, step, camino, initial.onboarding_revision);
      } else {
        persistJournal(recovered ?? createOnboardingJournal(initial.id, step, camino, initial.onboarding_revision));
        if (finalOperation.current) window.history.replaceState(null, "", rutaDePaso("listo", camino));
        else if (recovered?.entries.length) window.history.replaceState(null, "", rutaDePaso(recovered.viewStep, recovered.camino));
        if (recovered?.entries.length) void flush().catch(() => {});
      }
      bootstrapped.current = true; setReady(true);
    });
    // Server-side expectedUserId also closes the race between this listener and dispatch.
    void import("@/lib/supabase/client").then(({ createClient }) => {
      if (disposed) return;
      const { data } = createClient().auth.onAuthStateChange((event, session) => {
        if (event !== "SIGNED_OUT" && (!session || session.user.id === initial.id)) return;
        accountValid.current = false; failed.current = true;
        generation.current += 1;
        try { sessionStorage.removeItem(queueKey); sessionStorage.removeItem(draftKey); sessionStorage.removeItem(finalKey); } catch { /* No other account may replay the memory queue. */ }
        setError("Tu sesión cambió. Vuelve a entrar para continuar."); router.replace("/login");
      });
      unsubscribe = () => data.subscription.unsubscribe();
    });
    const permissionEpoch = generation.current;
    void import("@/hooks/usePushNotifications").then(({ leerPermisoPush }) => conTope(leerPermisoPush())).then((permission) => {
      if (disposed || !mounted.current || generation.current !== permissionEpoch) return;
      onPermissionRead(permission);
    }).catch(() => { /* Unknown native bridge state keeps the optional manual screen. */ });
    return () => { disposed = true; mounted.current = false; generation.current += 1; unsubscribe?.(); };
  }, [initial, queueKey, draftKey, finalKey, flush, persistJournal, router]);

  function update<K extends keyof OnboardingDraft>(key: K, value: OnboardingDraft[K]) {
    if (!mounted.current || !accountValid.current) return;
    const next = { ...editable.current, [key]: value }; editable.current = next; setDraft(next);
    try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* Editing remains available. */ }
  }

  function discardStep(step: PasoOnboardingActual, negocio: boolean) {
    if (!mounted.current || !accountValid.current) return;
    const accepted = { ...confirmed.current };
    for (const entry of journal.current?.entries ?? []) Object.assign(accepted, entry.fields);
    const next = discardOnboardingStepDraft(editable.current, accepted, step, negocio);
    editable.current = next; setDraft(next);
    try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* Optional editable cache. */ }
  }

  async function checkpoint(fromStep: PasoOnboardingActual, nextStep: PasoOnboardingActual, camino: CaminoOnboarding, fields: GuardarPasoInput = {}, barrier = false) {
    const epoch = generation.current;
    if (!bootstrapped.current || !accountValid.current || failed.current || finalOperation.current) throw new Error("Recupera el guardado pendiente antes de continuar.");
    const next = appendOnboardingCheckpoint(journal.current!, { operationId: crypto.randomUUID(), revision: confirmed.current.onboarding_revision,
      fromStep, nextStep, camino, fields });
    const persisted = persistJournal(next);
    if (barrier || !persisted) {
      setBusy(true);
      try { await flush(); }
      catch (failure) {
        const head = journal.current?.entries[0];
        // A barrier cannot have descendants. A confirmed SQL rollback lets the person correct this question.
        if (barrier && generation.current === epoch && head?.operationId === rejectedOperation.current
          && journal.current?.entries.length === 1 && head.fromStep === fromStep) {
          const previous = journal.current;
          const empty = { ...previous, entries: [], viewStep: fromStep };
          if (persistJournal(empty) || !durablePending.current) {
            failed.current = false; rejectedOperation.current = null; setError("");
            setUncertain(false);
          } else { journal.current = previous; setPending(1); }
        }
        throw failure;
      } finally { if (mounted.current && generation.current === epoch) setBusy(false); }
    } else { void flush().catch(() => {}); }
    if (!accountValid.current || !mounted.current || generation.current !== epoch) throw new Error("Tu sesión cambió. Recupera tu avance antes de continuar.");
  }

  async function retry() {
    const epoch = generation.current;
    setBusy(true);
    try {
      await flush(true);
      if (mounted.current && generation.current === epoch && knownResolvedPermission.current) setNotificacionesResueltas(true);
    } finally { if (mounted.current && generation.current === epoch) setBusy(false); }
  }

  function notifyPermission(permission: string, source: "read" | "request" = "read") {
    if (!mounted.current || !accountValid.current) return;
    const resolved = permission === "concedido" || permission === "denegado" || permission === "no-nativo";
    knownResolvedPermission.current = resolved;
    if (!resolved) return;
    const onNotificationStep = window.location.pathname.endsWith("/notificaciones");
    const queued = journal.current?.entries.some((entry) => entry.fromStep === "notificaciones" && entry.nextStep === "listo");
    // A resolved read skips this question, but still records its checkpoint exactly once.
    // A permission request already continues through PedirPermiso's explicit callback.
    if (source === "request" || !onNotificationStep || queued || confirmed.current.onboarding_paso === "listo" || failed.current || notificationAdvance.current) {
      setNotificacionesResueltas(true); return;
    }
    notificationAdvance.current = true;
    const camino: CaminoOnboarding = new URLSearchParams(window.location.search).get("camino") === "vender" || confirmed.current.onboarding_camino === "vender" ? "vender" : "explorar";
    const epoch = generation.current;
    void checkpoint("notificaciones", "listo", camino).then(() => {
      if (mounted.current && generation.current === epoch) setNotificacionesResueltas(true);
    }).catch(() => { /* The queue displays the failure and retry preserves the same operation. */ });
  }

  function recoverConfirmed() {
    if (!mounted.current || !accountValid.current || drainPromise.current || finalOperation.current || uncertain) return;
    const saved = confirmed.current;
    const camino = saved.onboarding_camino === "vender" ? "vender" : "explorar";
    const step = pasoParaReanudar(saved.onboarding_paso, { camino, tipo: saved.seller_type === "business" ? "business" : "casual" });
    const previous = journal.current;
    const empty = createOnboardingJournal(saved.id, step, camino, saved.onboarding_revision);
    if (!persistJournal(empty) && durablePending.current) {
      journal.current = previous;
      setPending(previous?.entries.length ?? 0);
      setError("No pudimos descartar los pasos pendientes de esta sesión. Reintenta cuando el almacenamiento esté disponible.");
      return;
    }
    failed.current = false; setConflict(false); setUncertain(false); setError("");
    editable.current = initialOnboardingDraft(saved); setDraft(editable.current);
    try { sessionStorage.removeItem(finalKey); sessionStorage.removeItem(draftKey); } catch { /* State remains isolated. */ }
    window.history.replaceState(null, "", rutaDePaso(step, camino));
  }

  async function finalize(decision: "explorar" | "activar") {
    const epoch = generation.current;
    if (!accountValid.current || failed.current) throw new Error("Guarda los pasos pendientes antes de entrar.");
    setBusy(true);
    try {
      await flush();
      if (!accountValid.current || !mounted.current || generation.current !== epoch) throw new Error("Tu sesión cambió. Recupera tu avance antes de entrar.");
      const retrying = !!finalOperation.current;
      const operation = finalOperation.current ?? { operationId: crypto.randomUUID(), expectedRevision: confirmed.current.onboarding_revision, decision };
      finalOperation.current = operation;
      setFinalPending(true);
      try { sessionStorage.setItem(finalKey, JSON.stringify(operation)); } catch { /* Memory ID protects retries in this view. */ }
      const started = performance.now();
      const result = await conTope(finalizarOnboarding({ ...operation, expectedUserId: initial.id }));
      if (!accountValid.current || !mounted.current || generation.current !== epoch) throw new Error("Tu sesión cambió. Vuelve a entrar para continuar.");
      if ("error" in result && result.error) {
        // Returned transactional failures are definitive. Transport rejections retain the operation ID.
        // An earlier uncertain attempt remains uncertain even if this retry was rejected before dispatch.
        if (result.conflict || (!result.uncertain && !retrying)) {
          finalOperation.current = null;
          setFinalPending(false);
          try { sessionStorage.removeItem(finalKey); } catch { /* Optional cache. */ }
        }
        if ("conflict" in result && result.conflict && result.data) {
          mergeCanonical(result.data.snapshot); failed.current = true; setConflict(true); setError(result.error);
        }
        recordOnboardingAcknowledgement("listo", started, "error"); throw new Error(result.error);
      }
      recordOnboardingAcknowledgement("listo", started, "saved");
      try { sessionStorage.removeItem(queueKey); sessionStorage.removeItem(draftKey); sessionStorage.removeItem(finalKey); } catch { /* Server completion remains authoritative. */ }
      finalOperation.current = null; setFinalPending(false); router.replace(result.destino ?? "/");
    } catch (failure) {
      if (esTope(failure)) throw new Error("Falta confirmar tu entrada. Reintenta para recuperar la misma decisión.");
      throw failure;
    } finally { if (mounted.current && generation.current === epoch) setBusy(false); }
  }

  return { profile, draft, update, discardStep, checkpoint, finalize, retry, recoverConfirmed, notifyPermission, pending, error, conflict, uncertain, ready, busy, notificacionesResueltas,
    blocked: conflict || !!error, finalPending };
}

export function OnboardingSessionProvider({ profile, children }: { profile: OnboardingProfile; children: ReactNode }) {
  const session = useSessionController(profile);
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useOnboardingSession() {
  const value = useContext(SessionContext);
  if (!value) throw new Error("Onboarding necesita su contexto compartido.");
  return value;
}
