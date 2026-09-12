import type { RealtimeChannel, SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database.types";

type Client = Pick<SupabaseClient<Database>, "removeChannel" | "getChannels" | "realtime">;
export type Vigencia = { vigente: () => boolean };
type Factory = (scope: Vigencia) => RealtimeChannel;
type Entry = { topic: string; create: Factory; channel?: RealtimeChannel; closing?: Promise<unknown>; generation: number; removed: boolean; failed?: boolean; pending?: () => void };

/** Un propietario por cliente. La generacion invalida tambien consultas en vuelo.
 * Solo APIs publicas: retirar antes de disconnect, nunca reutilizar un canal.
 */
export class CanalesGestionados {
  private entries = new Set<Entry>();
  private active: boolean;
  private running = false;
  private requested = false;
  private initializationTimer?: ReturnType<typeof setTimeout>;
  pausaDeshabilitada = false;

  constructor(private client: Client, native = false) {
    this.active = !native;
    if (native) this.esperarEstadoNativo();
  }

  esperarEstadoNativo() {
    if (this.pausaDeshabilitada || this.initializationTimer) return;
    this.setActive(false);
    this.initializationTimer = setTimeout(() => this.deshabilitarPausa(), 2_000);
  }

  confirmarEstado(active: boolean) {
    if (this.pausaDeshabilitada) return;
    clearTimeout(this.initializationTimer);
    this.initializationTimer = undefined;
    this.setActive(active);
  }

  deshabilitarPausa() {
    clearTimeout(this.initializationTimer);
    this.initializationTimer = undefined;
    this.pausaDeshabilitada = true;
    console.warn("[realtime] pausa nativa deshabilitada");
    this.setActive(true);
  }

  registrar(topic: string, create: Factory, pending?: () => void): () => void {
    const entry: Entry = { topic, create, pending, generation: 0, removed: false };
    this.entries.add(entry);
    this.schedule();
    return () => {
      if (entry.removed) return;
      entry.removed = true;
      entry.generation++;
      this.schedule();
    };
  }

  private setActive(active: boolean) {
    if (this.active === active) return;
    this.active = active;
    if (active) for (const entry of this.entries) entry.failed = false;
    if (!active) for (const entry of this.entries) {
      entry.generation++;
      if (!entry.removed) entry.pending?.();
    }
    this.schedule();
  }

  private schedule() {
    this.requested = true;
    if (this.running) return;
    this.running = true;
    void this.drain().catch(() => {
      console.warn("[realtime] limpieza pendiente");
    }).finally(() => {
      this.running = false;
      if (this.requested) this.schedule();
    });
  }

  private async remove(entry: Entry) {
    const channel = entry.channel!;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const removal = entry.closing ?? Promise.resolve().then(() => this.client.removeChannel(channel));
    entry.closing = removal;
    // Si el cierre acaba tarde se puede completar la limpieza con API publica.
    void removal.then(() => {
      if (!this.client.getChannels().includes(channel)) this.schedule();
    }).catch(() => {});
    try {
      await Promise.race([removal, new Promise<void>((resolve) => { timer = setTimeout(resolve, 2_000); })]);
    } catch {
      console.warn("[realtime] cierre no confirmado");
    } finally { clearTimeout(timer); }
    if (this.client.getChannels().includes(channel)) return false;
    entry.channel = undefined;
    entry.closing = undefined;
    return true;
  }

  private async drain() {
    while (this.requested) {
      this.requested = false;
      await Promise.all([...this.entries].map(async (entry) => {
        if (entry.channel && (entry.removed || !this.active || entry.generation !== 0)) {
          if (!await this.remove(entry)) {
            if (!entry.removed) entry.pending?.();
            return;
          }
        }
        if (entry.removed && !entry.channel) this.entries.delete(entry);
      }));
      if (!this.active || ![...this.entries].some((e) => !e.removed)) {
        // Nunca desmontar canales ajenos. Un cierre sin confirmar queda degradado.
        if (this.client.getChannels().length === 0) this.client.realtime.disconnect();
        continue;
      }
      for (const entry of this.entries) {
        if (entry.removed || entry.channel || entry.failed || !this.active) continue;
        if (this.client.getChannels().some((c) => c.topic === `realtime:${entry.topic}`)) {
          entry.pending?.();
          continue;
        }
        // Cada objeto obtiene su propio token, incluso si el contador se reinicia.
        const token = {};
        const scope = { vigente: () => !entry.removed && this.active && entry.generation === 0 && tokens.get(entry) === token };
        tokens.set(entry, token);
        entry.generation = 0;
        try { entry.channel = entry.create(scope); }
        catch {
          entry.channel = this.client.getChannels().find((c) => c.topic === `realtime:${entry.topic}`);
          entry.generation++;
          entry.failed = true;
          entry.pending?.();
          console.warn("[realtime] suscripcion pendiente");
          // Una vuelta retira el objeto parcial. El siguiente foreground
          // habilita un reintento sin crear un bucle si la factory sigue rota.
          this.schedule();
        }
      }
    }
  }
}
const tokens = new WeakMap<Entry, object>();
const controllers = new WeakMap<object, CanalesGestionados>();
export function canalesGestionados(client: SupabaseClient<Database>) {
  let controller = controllers.get(client);
  if (!controller) {
    const native = typeof window !== "undefined" &&
      (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.() === true;
    controller = new CanalesGestionados(client, native);
    controllers.set(client, controller);
  }
  return controller;
}

/** Una consulta en vuelo, a lo sumo una vuelta adicional por rafaga. */
export function refrescoCoalescido(run: () => Promise<void>, onError: () => void) {
  let running = false;
  let again = false;
  let disposed = false;
  return {
    solicitar() {
      if (disposed) return;
      if (running) { again = true; return; }
      running = true;
      void (async () => {
        for (let turn = 0; turn < 2 && !disposed; turn++) {
          again = false;
          try { await run(); } catch { if (!disposed) onError(); }
          if (!again) break;
        }
      })().finally(() => { running = false; });
    },
    cancelar() { disposed = true; },
  };
}
