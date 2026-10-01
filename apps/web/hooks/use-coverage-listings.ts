'use client';
import { useEffect, useRef, useState } from 'react';
import type { MapCoverageResult, MapCursor, MapQuery } from '@vicino/shared';
import { COVERAGE_TTL, coverageQuery } from '@/lib/geo/map-coverage';
import { clearCoverages, CoverageError, requestCoverage, type CoverageCenter } from '@/lib/geo/coverage-client';

export function useCoverageListings(query: MapQuery, center: CoverageCenter, node: string | null, revision: string | null) {
  const key = JSON.stringify([coverageQuery(query, center), center, node, revision]);
  const [attempt, setAttempt] = useState(0);
  const [cursor, setCursor] = useState<MapCursor | null>(null);
  const [state, setState] = useState<{ key: string; attempt: number; data?: MapCoverageResult; pending: boolean; error?: string }>({ key: '', attempt: -1, pending: false });
  const sequence = useRef(0);
  const activeRequest = useRef<AbortController | null>(null);
  const previous = useRef<{ key: string; data: MapCoverageResult } | null>(null);
  const activeRevision = useRef<{ key: string; revision: string | null }>({ key: '', revision: null });
  const blockedUntil = useRef(0);
  const cursorKey = JSON.stringify(cursor);
  useEffect(() => {
    if (!node) { previous.current = null; return; }
    const id = ++sequence.current;
    const abort = new AbortController();
    activeRequest.current = abort;
    const same = previous.current?.key === key;
    const old = same ? previous.current?.data : undefined;
    let pageCursor = same ? cursor : null;
    if (activeRevision.current.key !== key) activeRevision.current = { key, revision };
    setState({ key, attempt, data: old, pending: true });
    let running = false;
    const load = async (check = false) => {
      if (running || abort.signal.aborted || document.visibilityState === 'hidden') return;
      let retained = previous.current?.key === key ? previous.current.data : undefined;
      if (Date.now() < blockedUntil.current) { setState({ key, attempt, data: retained, pending: false, error: 'Espera un momento antes de actualizar.' }); return; }
      running = true;
      try {
        if (check && retained) {
          const manifest = await requestCoverage({ action: 'check', query: { ...coverageQuery(query, center), cell_id: node }, coverage_center: center, revision: null, cell_cursor: null }, abort.signal);
          if (manifest.revision === retained.revision) return;
          // Keep the group/camera frozen, but remove expired cards immediately.
          retained = undefined; previous.current = null; pageCursor = null;
          activeRevision.current = { key, revision: manifest.revision };
          setState({ key, attempt, pending: true });
        }
        let data: MapCoverageResult;
        const request = { action: 'listings' as const, query: { ...coverageQuery(query, center), cell_id: node, cursor: pageCursor }, coverage_center: center, revision: activeRevision.current.revision, cell_cursor: null };
        try { data = await requestCoverage(request, abort.signal); }
        catch (error) {
          if (!(error instanceof CoverageError) || error.status !== 409) throw error;
          clearCoverages();
          retained = undefined;
          previous.current = null;
          setState({ key, attempt, pending: true });
          data = await requestCoverage({ ...request, query: { ...request.query, cursor: null }, revision: null }, abort.signal);
          activeRevision.current = { key, revision: data.revision };
          pageCursor = null;
        }
        if (abort.signal.aborted || sequence.current !== id) return;
        activeRevision.current = { key, revision: data.revision };
        const prefix = pageCursor && previous.current?.key === key && previous.current.data.revision === data.revision ? previous.current.data.listings : [];
        const ids = new Set(prefix.map(p => p.id));
        data = { ...data, listings: [...prefix, ...data.listings.filter(p => !ids.has(p.id))] };
        previous.current = { key, data };
        setState({ key, attempt, data, pending: false });
      } catch (error) {
        if (!abort.signal.aborted && sequence.current === id) {
          if (error instanceof CoverageError && error.status === 429) blockedUntil.current = Date.now() + error.retryAfter * 1000;
          setState({ key, attempt, data: retained, pending: false, error: error instanceof Error ? error.message : 'No pudimos cargar las publicaciones.' });
        }
      } finally { running = false; }
    };
    if (Date.now() >= blockedUntil.current) void load();
    else setState({ key, attempt, data: old, pending: false, error: 'Espera un momento antes de actualizar.' });
    const interval = setInterval(() => { void load(true); }, COVERAGE_TTL + 1_000);
    const resume = () => { if (document.visibilityState !== 'hidden') void load(true); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('online', resume);
    return () => { abort.abort(); if (activeRequest.current === abort) activeRequest.current = null; clearInterval(interval); document.removeEventListener('visibilitychange', resume); window.removeEventListener('online', resume); };
  // Frozen drawer context and page cursor; camera bounds do not participate.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, cursorKey, attempt, node]);
  useEffect(() => {
    const invalid = (event: Event) => {
      if ((event as CustomEvent).detail === '/api/session/chats') return;
      activeRequest.current?.abort(); sequence.current++;
      previous.current = null; activeRevision.current = { key: '', revision: null }; setCursor(null); setAttempt(n => n + 1);
    };
    window.addEventListener('vicino:data-invalidated', invalid);
    return () => window.removeEventListener('vicino:data-invalidated', invalid);
  }, []);
  const current = state.key === key && state.attempt === attempt;
  return { data: current ? state.data : undefined, pending: !!node && (!current || state.pending), error: current ? state.error : undefined,
    retry: () => { if (Date.now() >= blockedUntil.current) { previous.current = null; setCursor(null); setAttempt(n => n + 1); } },
    loadMore: () => { if (current && !state.pending && state.data?.next_cursor && Date.now() >= blockedUntil.current) {
      setCursor(state.data.next_cursor);
      setState({ key, attempt: attempt + 1, data: state.data, pending: true });
      setAttempt(n => n + 1);
    } } };
}
