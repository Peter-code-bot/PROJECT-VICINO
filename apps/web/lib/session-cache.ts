export type Snapshot<T> = { data?: T; error?: string; updatedAt: number; pending: boolean };
type Entry = { snapshot: Snapshot<unknown>; listeners: Set<() => void>; controller?: AbortController; generation: number; promise?: Promise<void> };
const EMPTY: Snapshot<never> = { updatedAt: 0, pending: false };

/** Edad, en el reloj del cliente, a partir de la cual una entrada se vuelve a pedir al volver. */
export const SESSION_TTL_MS = 30_000;
/** Renders del servidor recordados para no volver a sembrar una copia servida por el router. */
const MAX_RENDERS_RECORDADOS = 500;

/** Memory only. One instance per authenticated layout; nothing is shared with another account. */
export class SessionCache {
  private entries = new Map<string, Entry>();
  private seenRenders = new Set<string>();
  /**
   * Cuando se aviso por ultima vez de que cambio cada prefijo, en el reloj del
   * CLIENTE. Se registra el prefijo y no la clave a proposito: cuando Realtime
   * avisa, la pestaña puede no haberse abierto nunca en esta sesion y su
   * entrada no existe todavia, pero la precarga ya tiene un render en la cache
   * del router listo para sembrarla.
   *
   * Acotado por diseño: los prefijos son los que usan las invalidaciones
   * (`/api/session/`, `/api/session/chats`, `/api/session/home`).
   */
  private avisos = new Map<string, number>();
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
  /**
   * Siembra lo que trajo el render del SERVIDOR, para que la primera visita
   * pinte con datos en el HTML y no vuelva a pedirlos tras hidratar.
   *
   * `renderId` identifica ese render. Con `staleTimes` el router de Next puede
   * volver a entregar el MISMO payload de una pagina ya vista, y con el la
   * misma semilla: se reconoce por el id y se ignora, porque lo que hay en
   * memoria es igual o mas nuevo.
   *
   * Y una semilla NUNCA borra un aviso pendiente. Un render puede ser viejo
   * aunque su id sea nuevo: la precarga (PrefetchKind.FULL) renderiza /chat al
   * pasar el dedo por encima y la persona entra medio minuto despues, con un
   * mensaje nuevo avisado por Realtime en ese hueco. Si la semilla naciera
   * "fresca" taparia ese mensaje durante los 30 s del TTL. Por eso, si la
   * clave estaba invalidada, la semilla se ensena pero nace caducada
   * (`updatedAt: 0`) y dispara una lectura inmediata.
   */
  seed(key: string, value: unknown, renderId: string): boolean {
    if (!this.active || this.seenRenders.has(renderId)) return false;
    this.seenRenders.add(renderId);
    if (this.seenRenders.size > MAX_RENDERS_RECORDADOS) {
      const oldest = this.seenRenders.values().next().value;
      if (oldest !== undefined) this.seenRenders.delete(oldest);
    }
    const entry = this.entry(key);
    entry.generation++; entry.controller?.abort(); entry.promise = undefined;
    // ¿Se aviso de un cambio DESPUES de la ultima vez que esta clave se sirvio
    // de la base? Entonces este render puede ser anterior al aviso (la
    // precarga lo produjo antes) y no puede nacer fresco.
    const pendienteDeAviso = this.avisadoDespuesDe(key, entry.snapshot.updatedAt);
    entry.snapshot = { data: value, updatedAt: pendienteDeAviso ? 0 : Date.now(), pending: false };
    this.emit(entry);
    if (pendienteDeAviso && entry.listeners.size) void this.load(key);
    return true;
  }
  private avisadoDespuesDe(key: string, servidoEn: number): boolean {
    for (const [prefijo, cuando] of this.avisos) {
      if (key.startsWith(prefijo) && cuando > servidoEn) return true;
    }
    return false;
  }
  async load(key: string, force = false): Promise<void> {
    if (!this.active || key.endsWith("#unhydrated")) return;
    const entry = this.entry(key);
    if (entry.promise) return entry.promise;
    if (!force && Date.now() - entry.snapshot.updatedAt < SESSION_TTL_MS) return;
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
        // Con el `updatedAt` nuevo, cualquier aviso anterior queda servido:
        // lo que hay en memoria ya salio de la base despues de el.
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
    this.avisos.set(prefix, Date.now());
    for (const [key, entry] of this.entries) {
      if (!key.startsWith(prefix)) continue;
      entry.generation++; entry.controller?.abort(); entry.promise = undefined;
      entry.snapshot = { ...entry.snapshot, updatedAt: 0, pending: false };
      this.emit(entry);
      if (entry.listeners.size) void this.load(key);
    }
  }
  /**
   * Olvida por completo unas claves, sin releerlas.
   *
   * Para cuando lo guardado ya no responde a la pregunta de ahora: al cambiar
   * de zona, las entradas del inicio pertenecen a la zona anterior y su clave
   * lleva esa zona dentro. Invalidarlas las volveria a pedir con la cookie
   * NUEVA y guardaria el feed de la zona nueva bajo la clave de la vieja; el
   * consumidor, que ya calcula su clave con la zona nueva, pediria otra vez.
   * Tres RPC pesadas y una entrada envenenada. Borrarlas no cuesta nada: la
   * clave nueva nace vacia y se pide una sola vez.
   */
  drop(prefix: string) {
    this.avisos.delete(prefix);
    for (const [key, entry] of [...this.entries]) {
      if (!key.startsWith(prefix)) continue;
      entry.generation++; entry.controller?.abort(); entry.promise = undefined;
      if (entry.listeners.size) {
        entry.snapshot = EMPTY;
        this.emit(entry);
      } else {
        this.entries.delete(key);
      }
    }
  }
  refreshActive() {
    for (const [key, entry] of this.entries) if (entry.listeners.size) void this.load(key);
  }
  mutate<T>(key: string, update: (data: T) => T) {
    const entry = this.entry(key);
    if (entry.snapshot.data === undefined || !this.active) return;
    // Cambio local confirmado por el servidor: tambien es un aviso, para que
    // una semilla de un render anterior no lo deshaga.
    this.avisos.set(key, Date.now());
    entry.generation++; entry.controller?.abort(); entry.promise = undefined;
    entry.snapshot = { data: update(entry.snapshot.data as T), updatedAt: 0, pending: false };
    this.emit(entry);
    void this.load(key);
  }
  clear() {
    this.active = false;
    this.ui.clear();
    this.seenRenders.clear();
    this.avisos.clear();
    for (const entry of this.entries.values()) {
      entry.generation++; entry.controller?.abort(); entry.promise = undefined;
      entry.snapshot = EMPTY; this.emit(entry);
    }
  }
}
