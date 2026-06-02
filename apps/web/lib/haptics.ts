/**
 * A4 sub-fase 4.1: helper centralizado de feedback haptico.
 *
 * Uso: void hapticLight() | void hapticMedium() en touch handlers.
 *
 * En web (Capacitor.isNativePlatform() === false) retorna en silencio sin
 * importar `@capacitor/haptics`, asi el bundle del navegador no carga el
 * plugin nativo. Los call-sites NO agregan su propio guard isNativePlatform.
 *
 * Cache a nivel modulo: la deteccion native + los modulos del plugin se
 * resuelven una vez en la primera llamada nativa exitosa; subsiguientes
 * llamadas reusan las refs cacheadas.
 *
 * codex follow-up L2: este es un modulo utility (no UI, no hooks), no
 * necesita "use client". Bundler lo trata como modulo aislado y los
 * dynamic imports se evaluan solo del lado cliente.
 *
 * codex follow-up M1: ensureLoaded cachea la promesa de inicializacion
 * para evitar TOCTOU bajo invocaciones concurrentes (2 taps al mismo
 * tiempo) — antes podian disparar 2 imports paralelos.
 */

import type { Haptics as HapticsType, ImpactStyle as ImpactStyleType } from "@capacitor/haptics";

let _isNative: boolean | null = null;
let _haptics: typeof HapticsType | null = null;
let _impactStyle: typeof ImpactStyleType | null = null;
let _loadPromise: Promise<boolean> | null = null;

async function loadImpl(): Promise<boolean> {
  // SSR guard: durante el render del server, no hay window ni Capacitor.
  if (typeof window === "undefined") {
    _isNative = false;
    return false;
  }

  try {
    const { Capacitor } = await import("@capacitor/core");
    _isNative = Capacitor.isNativePlatform();
    if (!_isNative) return false;

    const mod = await import("@capacitor/haptics");
    _haptics = mod.Haptics;
    _impactStyle = mod.ImpactStyle;
    return true;
  } catch {
    // Si los imports fallan por cualquier razon (build mode raro, plugin no
    // disponible), marcar non-native para no reintentar en cada tap.
    _isNative = false;
    return false;
  }
}

async function ensureLoaded(): Promise<boolean> {
  if (_isNative === false) return false;
  if (_isNative === true && _haptics && _impactStyle) return true;
  // Cachea la promesa: invocaciones concurrentes esperan al mismo load.
  if (!_loadPromise) _loadPromise = loadImpl();
  return _loadPromise;
}

export async function hapticLight(): Promise<void> {
  if (!(await ensureLoaded()) || !_haptics || !_impactStyle) return;
  try {
    await _haptics.impact({ style: _impactStyle.Light });
  } catch {
    // Fail-silent: un haptic que no fire no debe romper la accion del usuario.
  }
}

export async function hapticMedium(): Promise<void> {
  if (!(await ensureLoaded()) || !_haptics || !_impactStyle) return;
  try {
    await _haptics.impact({ style: _impactStyle.Medium });
  } catch {
    // Fail-silent.
  }
}

export async function hapticSelection(): Promise<void> {
  if (!(await ensureLoaded()) || !_haptics) return;
  try {
    await _haptics.selectionChanged();
  } catch {
    // Fail-silent.
  }
}
