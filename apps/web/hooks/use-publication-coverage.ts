'use client';
import { useEffect, useRef, useState } from 'react';
import type { MapCoverageResult, MapQuery } from '@vicino/shared';
import { COVERAGE_TTL, coverageQuery } from '@/lib/geo/map-coverage';
import { cachedCoverage, clearCoverages, coverageIsLimited, CoverageError, preloadCoverage, requestCoverage, saveCoverage, type CoverageCenter } from '@/lib/geo/coverage-client';

interface CoverageState {
  key: string; contextKey: string; attempt: number; center: CoverageCenter;
  data?: MapCoverageResult; pending?: boolean; error?: string; errorKey?: string;
}

/** Camera bounds are intentionally absent from the key. */
export function usePublicationCoverage(query: MapQuery, coverageCenter: CoverageCenter, viewerScope: string) {
  const canonical = coverageQuery(query, coverageCenter);
  const key = JSON.stringify([viewerScope, canonical, coverageCenter]);
  // Only the camera's coverage center may change while retaining a layer.
  // Filters, buyer location/radius, viewer and invalidation all isolate it.
  const contextKey = JSON.stringify([viewerScope, coverageQuery(query, null)]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<CoverageState>({ key: '', contextKey: '', attempt: -1, center: null });
  const blockedUntil = useRef(0);
  const sequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  useEffect(() => {
    const invalid = (event: Event) => {
      if ((event as CustomEvent).detail === '/api/session/chats') return;
      // Stop publication/cache writes immediately, before React's next effect.
      activeRequest.current?.abort(); sequence.current++;
      clearCoverages(); setAttempt(n => n + 1);
    };
    window.addEventListener('vicino:data-invalidated', invalid);
    window.addEventListener('vicino_location_updated', invalid);
    return () => { window.removeEventListener('vicino:data-invalidated', invalid); window.removeEventListener('vicino_location_updated', invalid); };
  }, []);
  useEffect(() => {
    const id = ++sequence.current;
    const abort = new AbortController();
    activeRequest.current = abort;
    let running = false;
    let wasHidden = document.visibilityState === 'hidden';
    const canPreload = () => document.visibilityState !== 'hidden' && navigator.onLine !== false && !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    const publish = (data: MapCoverageResult) => {
      if (abort.signal.aborted || sequence.current !== id) return;
      saveCoverage(key, data);
      setState({ key, contextKey, attempt, center: coverageCenter, data, pending: false });
    };
    const reportError = (message: string, stored?: MapCoverageResult) => {
      setState(previous => stored
        ? { key, contextKey, attempt, center: coverageCenter, data: stored, pending: false, error: message, errorKey: key }
        : previous.contextKey === contextKey && previous.attempt === attempt && previous.data
          ? { ...previous, pending: false, error: message, errorKey: key }
          : { key, contextKey, attempt, center: coverageCenter, pending: false, error: message, errorKey: key });
    };
    const run = async (forceCheck = false) => {
      if (running || abort.signal.aborted || document.visibilityState === 'hidden') return;
      const stored = cachedCoverage(key);
      if (stored) setState({ key, contextKey, attempt, center: coverageCenter, data: stored.data, pending: false });
      if (navigator.onLine === false) {
        reportError('Sin conexión. Conéctate para actualizar los puntos del mapa.', stored?.data);
        return;
      }
      if (Date.now() < blockedUntil.current) { reportError('Espera un momento antes de actualizar el mapa.', stored?.data); return; }
      running = true;
      try {
        let data = stored?.data;
        if (!data || forceCheck || Date.now() - (stored?.checkedAt ?? 0) >= COVERAGE_TTL) {
          const fresh = await requestCoverage({ action: data ? 'check' : 'overview', query: canonical, coverage_center: coverageCenter, revision: null, cell_cursor: null }, abort.signal);
          // Keep the same object when unchanged (also retains the budget marker).
          data = data?.revision === fresh.revision ? data : fresh;
          publish(data);
        }
        if (data && !data.complete && !coverageIsLimited(data) && canPreload()) {
          try { await preloadCoverage(canonical, coverageCenter, data, abort.signal, publish, canPreload); }
          catch (error) {
            if (!(error instanceof CoverageError) || error.status !== 409) throw error;
            // One restart only; never mix cells of different generations.
            const fresh = await requestCoverage({ action: 'overview', query: canonical, coverage_center: coverageCenter, revision: null, cell_cursor: null }, abort.signal);
            publish(fresh);
            await preloadCoverage(canonical, coverageCenter, fresh, abort.signal, publish, canPreload);
          }
        }
      } catch (error) {
        if (!abort.signal.aborted && sequence.current === id) {
          if (error instanceof CoverageError && error.status === 429) blockedUntil.current = Date.now() + error.retryAfter * 1000;
          reportError(error instanceof Error ? error.message : 'No pudimos cargar el mapa.', cachedCoverage(key)?.data);
        }
      } finally { running = false; }
    };
    const timer = setTimeout(() => { void run(); }, 350);
    const interval = setInterval(() => { void run(); }, COVERAGE_TTL + 1_000);
    const resume = () => {
      const hidden = document.visibilityState === 'hidden';
      if (!hidden) void run(wasHidden);
      wasHidden = hidden;
    };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    window.addEventListener('offline', resume);
    return () => { abort.abort(); if (activeRequest.current === abort) activeRequest.current = null; clearTimeout(timer); clearInterval(interval); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('offline', resume); };
  // Serialized key fixes coverage and viewer; camera-only renders cannot requery.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const current = state.key === key && state.attempt === attempt;
  const compatible = state.contextKey === contextKey && state.attempt === attempt;
  // Return the retained layer's center together with its data. Selecting it
  // during a camera transition must not pair its revision with the new center.
  return { data: compatible ? state.data : undefined, center: compatible ? state.center : coverageCenter,
    contextKey: contextKey + ':' + attempt, pending: (!current && (!compatible || state.errorKey !== key)) || !!state.pending, error: compatible && state.errorKey === key ? state.error : undefined,
    retry: () => { if (Date.now() >= blockedUntil.current) setAttempt(n => n + 1); } };
}
