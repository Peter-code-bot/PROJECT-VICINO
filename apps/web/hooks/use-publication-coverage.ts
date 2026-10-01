'use client';
import { useEffect, useRef, useState } from 'react';
import type { MapCoverageResult, MapQuery } from '@vicino/shared';
import { COVERAGE_TTL, coverageQuery } from '@/lib/geo/map-coverage';
import { cachedCoverage, clearCoverages, coverageIsLimited, CoverageError, preloadCoverage, requestCoverage, saveCoverage, type CoverageCenter } from '@/lib/geo/coverage-client';

/** Camera bounds are intentionally absent from the key. */
export function usePublicationCoverage(query: MapQuery, coverageCenter: CoverageCenter, viewerScope: string) {
  const canonical = coverageQuery(query, coverageCenter);
  const key = JSON.stringify([viewerScope, canonical, coverageCenter]);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<{ key: string; attempt: number; data?: MapCoverageResult; pending?: boolean; error?: string }>({ key: '', attempt: -1 });
  const blockedUntil = useRef(0);
  const sequence = useRef(0);
  useEffect(() => {
    const invalid = (event: Event) => { if ((event as CustomEvent).detail === '/api/session/chats') return; clearCoverages(); setAttempt(n => n + 1); };
    window.addEventListener('vicino:data-invalidated', invalid);
    window.addEventListener('vicino_location_updated', invalid);
    return () => { window.removeEventListener('vicino:data-invalidated', invalid); window.removeEventListener('vicino_location_updated', invalid); };
  }, []);
  useEffect(() => {
    const id = ++sequence.current;
    const abort = new AbortController();
    let running = false;
    let wasHidden = document.visibilityState === 'hidden';
    const canPreload = () => document.visibilityState !== 'hidden' && navigator.onLine !== false && !(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData;
    const publish = (data: MapCoverageResult) => {
      if (abort.signal.aborted || sequence.current !== id) return;
      saveCoverage(key, data);
      setState({ key, attempt, data, pending: false });
    };
    const run = async (forceCheck = false) => {
      if (running || abort.signal.aborted || document.visibilityState === 'hidden') return;
      const stored = cachedCoverage(key);
      if (stored) setState({ key, attempt, data: stored.data, pending: false });
      if (navigator.onLine === false) {
        setState({ key, attempt, data: stored?.data, pending: false, error: stored ? 'Sin conexión. Estos puntos pueden haber cambiado.' : 'Conéctate para cargar los puntos del mapa.' });
        return;
      }
      if (Date.now() < blockedUntil.current) { setState({ key, attempt, data: stored?.data, error: 'Espera un momento antes de actualizar el mapa.', pending: false }); return; }
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
          setState({ key, attempt, data: cachedCoverage(key)?.data, pending: false, error: error instanceof Error ? error.message : 'No pudimos cargar el mapa.' });
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
    return () => { abort.abort(); clearTimeout(timer); clearInterval(interval); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); window.removeEventListener('offline', resume); };
  // Serialized key fixes coverage and viewer; camera-only renders cannot requery.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt]);
  const current = state.key === key && state.attempt === attempt;
  return { data: current ? state.data : undefined, pending: !current || !!state.pending, error: current ? state.error : undefined,
    retry: () => { if (Date.now() >= blockedUntil.current) setAttempt(n => n + 1); } };
}
