export type Snapshot<T> = { data?: T; error?: string; updatedAt: number; pending: boolean };
type Entry = { snapshot: Snapshot<unknown>; listeners: Set<() => void>; controller?: AbortController; generation: number; promise?: Promise<void> };
const EMPTY: Snapshot<never> = { updatedAt: 0, pending: false };

/** Memory only. One instance per authenticated layout; nothing is shared with another account. */
export class SessionCache {
  private entries = new Map<string, Entry>();
  active = true;
  readonly ui = new Map<string, unknown>();
  constructor(readonly userId: string, private transport: typeof fetch = fetch, private invalidSession: () => void = () => {}) {}
  private entry(key: string) {
    let entry = this.entries.get(key);
    if (!entry) { entry = { snapshot: EMPTY, listeners: new Set(), generation: 0 }; this.entries.set(key, entry); }
    return entry;
  }
  snapshot<T>(key: string): Snapshot<T> { return this.entry(key).snapshot as Snapshot<T>; }
  subscribe(key: string, listener: () => void) {
    const entry = this.entry(key); entry.listeners.add(listener);
    return () => { entry.listeners.delete(listener); };
  }
  private emit(entry: Entry) { entry.listeners.forEach(listener => listener()); }
  async load(key: string, force = false): Promise<void> {
    if (!this.active || key.endsWith("#unhydrated")) return;
    const entry = this.entry(key);
    if (entry.promise) return entry.promise;
    if (!force && Date.now() - entry.snapshot.updatedAt < 30_000) return;
    const controller = new AbortController();
    entry.controller = controller;
    const generation = ++entry.generation;
    entry.snapshot = { ...entry.snapshot, pending: true };
    this.emit(entry);
    entry.promise = (async () => {
      const timeout = setTimeout(() => controller.abort(), 15_000);
      try {
        const response = await this.transport.call(globalThis, key, { signal: controller.signal, cache: "no-store" });
        if (!this.active || generation !== entry.generation) return;
        if (response.status === 401) { this.clear(); this.invalidSession(); return; }
        if (!response.ok) throw new Error("No se pudo actualizar. Intenta de nuevo.");
        const result = await response.json();
        if (!this.active || generation !== entry.generation) return;
        if (result.userId !== this.userId) { this.clear(); this.invalidSession(); return; }
        if (!this.active || generation !== entry.generation) return;
        entry.snapshot = { data: result.value, updatedAt: Date.now(), pending: false };
      } catch {
        if (!this.active || generation !== entry.generation) return;
        entry.snapshot = { ...entry.snapshot, error: "No se pudo actualizar. Intenta de nuevo.", pending: false };
      } finally {
        clearTimeout(timeout);
        if (generation === entry.generation) { entry.promise = undefined; this.emit(entry); }
      }
    })();
    return entry.promise;
  }
  invalidate(prefix = "/api/session/") {
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(prefix)) continue;
      entry.generation++; entry.controller?.abort(); entry.promise = undefined;
      entry.snapshot = { ...entry.snapshot, updatedAt: 0, pending: false };
      this.emit(entry);
      if (entry.listeners.size) void this.load(key);
    }
  }
  refreshActive() {
    for (const [key, entry] of this.entries) if (entry.listeners.size) void this.load(key);
  }
  mutate<T>(key: string, update: (data: T) => T) {
    const entry = this.entry(key);
    if (entry.snapshot.data === undefined || !this.active) return;
    entry.generation++; entry.controller?.abort(); entry.promise = undefined;
    entry.snapshot = { data: update(entry.snapshot.data as T), updatedAt: 0, pending: false };
    this.emit(entry);
    void this.load(key);
  }
  clear() {
    this.active = false;
    this.ui.clear();
    for (const entry of this.entries.values()) {
      entry.generation++; entry.controller?.abort(); entry.promise = undefined;
      entry.snapshot = EMPTY; this.emit(entry);
    }
  }
}
