"use client";

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
 */

type ImpactStyleEnum = { Light: string; Medium: string; Heavy: string };
type HapticsApi = {
  impact: (opts: { style: string }) => Promise<void>;
  selectionStart: () => Promise<void>;
  selectionChanged: () => Promise<void>;
  selectionEnd: () => Promise<void>;
};

let _isNative: boolean | null = null;
let _haptics: HapticsApi | null = null;
let _impactStyle: ImpactStyleEnum | null = null;

async function ensureLoaded(): Promise<boolean> {
  if (_isNative === false) return false;
  if (_isNative === true && _haptics && _impactStyle) return true;

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
    _haptics = mod.Haptics as unknown as HapticsApi;
    _impactStyle = mod.ImpactStyle as unknown as ImpactStyleEnum;
    return true;
  } catch {
    // Si los imports fallan por cualquier razon (build mode raro, plugin no
    // disponible), marcar non-native para no reintentar en cada tap.
    _isNative = false;
    return false;
  }
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
