"use client";

const CLAVE = "vicino:home-antes-login";
export function guardarRetornoHome(): void {
  if (window.location.pathname !== "/") return;
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify({ y: window.scrollY, ruta: location.pathname + location.search, vence: Date.now() + 1800000 }));
  } catch { /* El acceso no depende del almacenamiento. */ }
}

export function restaurarRetornoHome(): (() => void) | undefined {
  if (window.location.pathname !== "/") return;
  try {
    const raw = sessionStorage.getItem(CLAVE);
    if (!raw) return;
    const value = JSON.parse(raw);
    if (value.vence > Date.now() && value.ruta === location.pathname + location.search && Number.isFinite(value.y)) {
      const y = Math.max(0, value.y);
      let frame = 0;
      let detenido = false;
      let estableDesde: number | undefined;
      const inicio = performance.now();
      const eventos = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
      const detener = (consumir: boolean) => {
        if (detenido) return;
        detenido = true;
        cancelAnimationFrame(frame);
        for (const evento of eventos) window.removeEventListener(evento, interactuar);
        // Another navigation may have written a newer Home return meanwhile.
        try {
          if (consumir && sessionStorage.getItem(CLAVE) === raw) sessionStorage.removeItem(CLAVE);
        } catch { /* The restored position does not depend on storage access. */ }
      };
      const interactuar = () => detener(true);
      const restaurar = () => {
        if (location.pathname + location.search !== value.ruta) { detener(false); return; }
        const maximo = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
        const ahora = performance.now();
        if (maximo >= y) {
          if (Math.abs(window.scrollY - y) > 1) {
            window.scrollTo({ top: y, behavior: "instant" });
            estableDesde = undefined;
          } else estableDesde ??= ahora;
          if (estableDesde !== undefined && ahora - estableDesde >= 500) { detener(true); return; }
        } else estableDesde = undefined;
        if (ahora - inicio >= 3000) {
          window.scrollTo({ top: Math.min(y, maximo), behavior: "instant" });
          detener(true);
          return;
        }
        frame = requestAnimationFrame(restaurar);
      };
      // Next's ancestor scroll/focus runs after the child's layout effect.
      // Observe a bounded settling window; never override a new user gesture.
      for (const evento of eventos) window.addEventListener(evento, interactuar, { passive: true });
      frame = requestAnimationFrame(() => { frame = requestAnimationFrame(restaurar); });
      return () => detener(false);
    }
    sessionStorage.removeItem(CLAVE);
  } catch { /* Fallback a Home normal. */ }
}
