import type { AppPlugin } from "@capacitor/app";
import type { CanalesGestionados } from "./canales-gestionados";

type Handle = { remove: () => Promise<void> };
type AppLifecycle = Pick<AppPlugin, "addListener" | "getState">;

/** Listener antes de getState: el resultado inicial nunca pisa un evento nuevo.
 * El controlador limita la espera inicial a 2s, incluidos imports del puente.
 */
export function instalarPausa(app: Promise<AppLifecycle>, controller: CanalesGestionados, onActive: () => void = () => {}): Handle {
  controller.esperarEstadoNativo();
  let disposed = false;
  let revision = 0;
  let handle: Handle | undefined;
  const start = (async () => {
    const nativeApp = await app;
    if (disposed) return;
    const version = revision;
    const installed = await nativeApp.addListener("appStateChange", ({ isActive }) => {
      if (disposed) return;
      revision++;
      controller.confirmarEstado(isActive);
      if (isActive) onActive();
    });
    if (disposed) { await installed.remove(); return; }
    handle = installed;
    const initial = await nativeApp.getState();
    if (!disposed && version === revision) controller.confirmarEstado(initial.isActive);
  })().catch(() => {
    if (!disposed) controller.deshabilitarPausa();
  });
  // start captura sus errores; no se espera para montar ni para cerrar splash.
  void start;
  return { async remove() {
    disposed = true;
    revision++;
    const installed = handle;
    handle = undefined;
    if (installed) await installed.remove().catch(() => {});
  } };
}

const installations = new WeakMap<CanalesGestionados, { users: number; handle: Handle }>();
export function iniciarPausaNativa(controller: CanalesGestionados): Handle {
  let installation = installations.get(controller);
  if (!installation) {
    installation = { users: 0, handle: instalarPausa(import("@capacitor/app").then(({ App }) => App), controller, () => {
      void import("../observability/sentry-nativo").then(({ iniciarSentryNativo }) => iniciarSentryNativo(true)).catch(() => {});
    }) };
    installations.set(controller, installation);
  }
  const owned = installation;
  owned.users++;
  let removed = false;
  return { async remove() {
    if (removed) return;
    removed = true;
    if (--owned.users === 0) {
      installations.delete(controller);
      await owned.handle.remove();
    }
  } };
}
