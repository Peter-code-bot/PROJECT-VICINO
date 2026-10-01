import { mapCoverageResultSchema, type MapCoverageRequest, type MapCoverageResult, type MapQuery } from '@vicino/shared';
import { coverageQuery } from './map-coverage';

export class CoverageError extends Error {
  constructor(message: string, public status = 0, public retryAfter = 0) { super(message); }
}
export type CoverageCenter = { lat: number; lng: number } | null;
export const MAX_COVERAGE_CELLS = 10_000;
export const MAX_COVERAGE_BYTES = 2 * 1024 * 1024;
const limited = new WeakSet<MapCoverageResult>();
export function coverageIsLimited(data: MapCoverageResult) { return limited.has(data); }
export function serializedBytes(value: unknown) { return new TextEncoder().encode(JSON.stringify(value)).byteLength; }

/** Each request has its own deadline; the outer signal also cancels queued pages. */
export async function requestCoverage(input: MapCoverageRequest, signal: AbortSignal): Promise<MapCoverageResult> {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) controller.abort();
  const timeout = setTimeout(cancel, 15_000);
  try {
    const response = await fetch('/api/publications/map/coverage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input),
      signal: controller.signal, cache: 'no-store',
    });
    const body: unknown = await response.json();
    if (signal.aborted || controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    if (!response.ok) {
      const message = body && typeof body === 'object' && 'error' in body && typeof body.error === 'string' ? body.error : 'No pudimos actualizar el mapa.';
      const raw = response.headers.get('Retry-After');
      const seconds = raw && /^\d+$/.test(raw) ? Number(raw) : 60;
      throw new CoverageError(message, response.status, response.status === 429 ? Math.min(300, Math.max(1, seconds)) : 0);
    }
    const result = mapCoverageResultSchema.safeParse(body);
    if (!result.success) throw new CoverageError('La respuesta del mapa no es válida. Intenta de nuevo.');
    return result.data;
  } catch (error) {
    if (controller.signal.aborted && !signal.aborted) throw new CoverageError('La conexión tardó demasiado. Intenta de nuevo.');
    throw error;
  } finally { clearTimeout(timeout); signal.removeEventListener('abort', cancel); }
}

/** Only commit a full set after the last page of the same revision. */
export async function preloadCoverage(
  query: MapQuery, center: CoverageCenter, first: MapCoverageResult, signal: AbortSignal,
  publish: (data: MapCoverageResult) => void, mayContinue: () => boolean = () => true,
): Promise<MapCoverageResult> {
  if (!center || first.complete) return first;
  let result = first;
  let cells = first.cells;
  let cursor = first.next_cell_cursor;
  const seen = new Set(cells.map(c => `${c.x}:${c.y}`));
  const cursors = new Set<string>();
  while (!signal.aborted && mayContinue()) {
    const page = await requestCoverage({ action: 'cells', query: coverageQuery(query, center), coverage_center: center, revision: first.revision, cell_cursor: cursor }, signal);
    if (page.revision !== first.revision) throw new CoverageError('La zona cambió. Actualiza el mapa.', 409);
    for (const cell of page.cells) {
      const key = `${cell.x}:${cell.y}`;
      if (seen.has(key)) throw new CoverageError('No pudimos completar los puntos del mapa.');
      seen.add(key);
    }
    const combined = [...cells, ...page.cells];
    if (combined.length > MAX_COVERAGE_CELLS || serializedBytes(combined) > MAX_COVERAGE_BYTES) { limited.add(result); return result; }
    cells = combined;
    cursor = page.next_cell_cursor;
    if (page.complete !== (cursor === null)) throw new CoverageError('No pudimos completar los puntos del mapa.');
    if (cursor && cursors.has(JSON.stringify(cursor))) throw new CoverageError('No pudimos completar los puntos del mapa.');
    if (cursor) cursors.add(JSON.stringify(cursor));
    if (page.complete && cells.reduce((n, c) => n + c.count, 0) !== page.total) throw new CoverageError('No pudimos completar los puntos del mapa.');
    result = { ...first, cells, next_cell_cursor: cursor, complete: page.complete };
    publish(result);
    if (page.complete) return result;
  }
  return result;
}

type Cached = { data: MapCoverageResult; checkedAt: number; bytes: number };
const cache = new Map<string, Cached>();
export function clearCoverages() { cache.clear(); }
export function cachedCoverage(key: string): Cached | undefined {
  const item = cache.get(key);
  if (item) { cache.delete(key); cache.set(key, item); }
  return item;
}
export function saveCoverage(key: string, data: MapCoverageResult, checkedAt = Date.now()) {
  const bytes = serializedBytes(data);
  if (bytes > MAX_COVERAGE_BYTES) return;
  cache.delete(key); cache.set(key, { data, checkedAt, bytes });
  while (cache.size > 4 || [...cache.values()].reduce((n, entry) => n + entry.bytes, 0) > 8 * 1024 * 1024) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest); else break;
  }
}
