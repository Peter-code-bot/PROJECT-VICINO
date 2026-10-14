"use client";

import { useMemo, useSyncExternalStore } from "react";
import {
  instantaneaBoveda,
  instantaneaBovedaServidor,
  interpretarBoveda,
  suscribirBoveda,
  type Cuenta,
} from "./boveda";

/**
 * Las cuentas guardadas en este dispositivo, ordenadas por ultimo uso.
 *
 * La instantanea es el string crudo (comparable por valor, estable entre
 * renders); el parseo va en un useMemo sobre ese string para que la lista solo
 * cambie de identidad cuando cambie el contenido.
 */
export function useCuentas(): Cuenta[] {
  const crudo = useSyncExternalStore(suscribirBoveda, instantaneaBoveda, instantaneaBovedaServidor);
  return useMemo(() => interpretarBoveda(crudo), [crudo]);
}
