import type { AppPlugin } from "@capacitor/app";
import type { CanalesGestionados } from "./canales-gestionados";

type Handle = { remove: () => Promise<void> };
type AppLifecycle = Pick<AppPlugin, "addListener" | "getState">;

/** El plugin viaja DENTRO de un objeto, nunca como valor de resolucion directo.
 *
 * Los plugins de Capacitor son Proxy: cualquier propiedad que no conozcan se
 * convierte en una llamada nativa, incluida `then`. Eso los vuelve thenables,
 * asi que `Promise.resolve(App)` (o un `.then(({ App }) => App)`) hace que el
 * motor de promesas invoque `App.then(resolve, reject)`, iOS responda
 * `"App.then()" is not implemented on ios` y la promesa se quede pendiente
 * PARA SIEMPRE: ni resuelve ni rechaza, asi que el `.catch` de abajo tampoco
 * salta. Envolverlo obliga a que el valor de resolucion sea un objeto plano.
 */
type Puente = { app: AppLifecycle };

/** Listener antes de getState: el resultado inicial nunca pisa un evento nuevo.
 * El controlador limita la espera inicial a 2s, incluidos imports del puente.
 */
export function instalarPausa(puente: Promise<Puente>, controller: CanalesGestionados, onActive: () => void = () => {}): Handle {
  controller.esperarEstadoNativo();
  let disposed = false;
  let revision = 0;
  let handle: Handle | undefined;
  const start = (async () => {
    const { app: nativeApp } = await puente;
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
    installation = { users: 0, handle: instalarPausa(import("@capacitor/app").then(({ App }) => ({ app: App })), controller, () => {
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
