"use client";

const CLAVE = "vicino:home-antes-login";
export function guardarRetornoHome(): void {
  if (window.location.pathname !== "/") return;
  try {
    sessionStorage.setItem(CLAVE, JSON.stringify({ y: window.scrollY, ruta: location.pathname + location.search, vence: Date.now() + 1800000 }));
  } catch { /* El acceso no depende del almacenamiento. */ }
}

export function restaurarRetornoHome(): void {
  if (window.location.pathname !== "/") return;
  try {
    const raw = sessionStorage.getItem(CLAVE);
    if (!raw) return;
    sessionStorage.removeItem(CLAVE);
    const value = JSON.parse(raw);
    if (value.vence > Date.now() && value.ruta === location.pathname + location.search && Number.isFinite(value.y)) {
      window.scrollTo({ top: Math.max(0, value.y), behavior: "instant" });
    }
  } catch { /* Fallback a Home normal. */ }
}
