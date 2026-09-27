import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

import { COBERTURA_PAIS, reglaDesdeFila, type ReglaCobertura } from "./cobertura-regla";

export { COBERTURA_PAIS, reglaDesdeFila, type ReglaCobertura };

let pendiente: Promise<ReglaCobertura> | null = null;

/** Una lectura por sesion. Si falla, no se guarda: la siguiente vuelve a intentar. */
export function leerReglaCobertura(): Promise<ReglaCobertura> {
  if (!pendiente) {
    pendiente = (async () => {
      const { data, error } = await createClient()
        .from("vicino_cobertura")
        .select("modo, centro_lat, centro_lng, radio_km")
        .eq("clave", "operacion")
        .maybeSingle();
      if (error) throw error;
      return reglaDesdeFila(data);
    })().catch(() => {
      pendiente = null;
      return COBERTURA_PAIS;
    });
  }
  return pendiente;
}

/** Regla vigente para los buscadores; Mexico entero mientras llega. */
export function useReglaCobertura(): ReglaCobertura {
  const [regla, setRegla] = useState<ReglaCobertura>(COBERTURA_PAIS);
  useEffect(() => {
    let vigente = true;
    void leerReglaCobertura().then((r) => {
      if (vigente) setRegla(r);
    });
    return () => {
      vigente = false;
    };
  }, []);
  return regla;
}
