"use client";
import { useEffect, useRef, useState } from "react";
import { mapResultSchema, type MapQuery, type MapResult } from "@vicino/shared";

/** A result belongs to one exact query. Clear it immediately on a filter/pan;
 * abort plus sequence protects against servers that complete after cancellation. */
export function usePublicationMap(query: MapQuery | null) {
  const key = JSON.stringify(query);
  const sequence = useRef(0);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; attempt: number; data?: MapResult; error?: string }>({ key: "", attempt: -1 });
  useEffect(() => {
    const id = ++sequence.current;
    if (!query) return;
    const abort = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const timer = setTimeout(async () => {
      // Use AbortController on older supported WebViews as well; timeout/any
      // are newer AbortSignal APIs and need not exist on the device.
      deadline = setTimeout(() => {
        if (id === sequence.current && !abort.signal.aborted) {
          abort.abort();
          setState({ key, attempt, error: "La conexión tardó demasiado. Intenta de nuevo." });
        }
      }, 15_000);
      try {
        const response = await fetch("/api/publications/map", { method: "POST", headers: { "Content-Type": "application/json" }, body: key, signal: abort.signal, cache: "no-store" });
        const body: unknown = await response.json();
        if (!response.ok) throw new Error(typeof body === "object" && body && "error" in body && typeof body.error === "string" ? body.error : "No pudimos actualizar el mapa.");
        const parsed = mapResultSchema.safeParse(body);
        if (!parsed.success) throw new Error("No pudimos actualizar el mapa. Intenta de nuevo.");
        if (id === sequence.current && !abort.signal.aborted) setState({ key, attempt, data: parsed.data });
      } catch (error) {
        if (id === sequence.current && !abort.signal.aborted) setState({ key, attempt, error: error instanceof Error ? error.message : "No pudimos actualizar el mapa." });
      } finally { clearTimeout(deadline); }
    }, 350);
    return () => { clearTimeout(timer); clearTimeout(deadline); abort.abort(); };
  // The canonical serialized query is the dependency, not its object identity.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const current = state.key === key && state.attempt === attempt;
  return { data: current ? state.data : undefined, error: current ? state.error : undefined,
    pending: !!query && (!current || (!state.data && !state.error)), retry: () => setAttempt(n => n + 1) };
}
