export type MapPreviewInput = { center: { lat: number; lng: number } | null; theme: "light" | "dark" };
export type MapPreviewState = { url: string | null; status: "empty" | "pending" | "ready" | "error" | "expired" };
const EMPTY: MapPreviewState = { url: null, status: "empty" };
const TTL_MS = 300_000;
type Entry = { snapshot: MapPreviewState; promise: Promise<string>; controller: AbortController; expires: number; timer?: ReturnType<typeof setTimeout> };
type Resources = { fetch: typeof fetch; createURL: (blob: Blob) => string; revokeURL: (url: string) => void; now: () => number };

/** Small document-session cache. No image is written to storage or a service worker. */
export class MapPreviewCache {
  private entries = new Map<string, Entry>();
  private listeners = new Map<string, Set<() => void>>();
  private context = "";
  constructor(private resources: Resources, private ttl = TTL_MS) {}
  snapshot = (key: string): MapPreviewState => this.entries.get(key)?.snapshot ?? EMPTY;
  subscribe(key: string, listener: () => void) {
    const listeners = this.listeners.get(key) ?? new Set();
    listeners.add(listener); this.listeners.set(key, listeners);
    return () => { listeners.delete(listener); if (!listeners.size) this.listeners.delete(key); };
  }
  private emit(key: string) { this.listeners.get(key)?.forEach(listener => listener()); }
  private dispose(entry: Entry) {
    entry.controller.abort(); clearTimeout(entry.timer);
    if (entry.snapshot.url) this.resources.revokeURL(entry.snapshot.url);
  }
  activateContext(viewer: string, theme: string) {
    const next = JSON.stringify([viewer, theme]);
    if (this.context !== next) { this.context = next; this.clear(); }
  }
  clear() {
    const keys = [...this.entries.keys()];
    for (const entry of this.entries.values()) this.dispose(entry);
    this.entries.clear(); keys.forEach(key => this.emit(key));
  }
  load(key: string, body: MapPreviewInput, force = false): Promise<string> {
    const cached = this.entries.get(key);
    if (!force && cached && cached.expires > this.resources.now()) return cached.promise;
    if (cached) { this.dispose(cached); this.entries.delete(key); }
    // At most four resources including pending images, each no more than 2 MiB.
    if (this.entries.size >= 4) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) { this.dispose(this.entries.get(oldest)!); this.entries.delete(oldest); this.emit(oldest); }
    }
    const entry: Entry = { snapshot: { url: null, status: "pending" }, controller: new AbortController(), expires: this.resources.now() + this.ttl, promise: Promise.resolve("") };
    entry.timer = setTimeout(() => entry.controller.abort(), 15_000);
    this.entries.set(key, entry);
    entry.promise = (async () => {
      try {
        const response = await this.resources.fetch("/api/map-preview", {
          method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
          cache: "no-store", signal: entry.controller.signal,
        });
        if (!response.ok || !response.headers.get("content-type")?.startsWith("image/png")) throw new Error("Preview unavailable");
        const blob = await response.blob();
        if (!blob.size || blob.size > 2 * 1024 * 1024 || entry.controller.signal.aborted || this.entries.get(key) !== entry) throw new Error("Preview unavailable");
        const url = this.resources.createURL(blob);
        clearTimeout(entry.timer);
        entry.snapshot = { url, status: "ready" };
        entry.expires = this.resources.now() + this.ttl;
        entry.timer = setTimeout(() => {
          if (this.entries.get(key) !== entry) return;
          this.dispose(entry); entry.snapshot = { url: null, status: "expired" }; entry.expires = 0; this.emit(key);
        }, this.ttl);
        this.emit(key); return url;
      } catch {
        clearTimeout(entry.timer);
        if (this.entries.get(key) === entry) { entry.snapshot = { url: null, status: "error" }; this.emit(key); }
        // A failed navigation cannot silently start another paid request.
        throw new Error("Preview unavailable");
      }
    })();
    this.emit(key); return entry.promise;
  }
}

export const mapPreviewCache = new MapPreviewCache({
  fetch: (...args) => fetch(...args), createURL: blob => URL.createObjectURL(blob),
  revokeURL: url => URL.revokeObjectURL(url), now: () => Date.now(),
});
export const emptyMapPreview = () => EMPTY;
export const clearMapPreviews = () => mapPreviewCache.clear();
