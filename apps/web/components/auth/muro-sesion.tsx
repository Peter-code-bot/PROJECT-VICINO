"use client";

import { createContext, useCallback, useContext, useMemo, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { loginPara } from "@/lib/auth/acceso-invitado";
import { guardarRetornoHome } from "@/lib/auth/retorno-home";

interface MuroValue {
  haySesion: boolean;
  pedirSesion: (motivo: string, destino?: string) => boolean;
}
const MuroContext = createContext<MuroValue>({ haySesion: true, pedirSesion: () => true });

export function MuroSesionProvider({ haySesion, children }: { haySesion: boolean; children: ReactNode }) {
  const router = useRouter();
  const pedirSesion = useCallback((_motivo: string, destino?: string) => {
    if (haySesion) return true;
    guardarRetornoHome();
    router.push(loginPara(destino ?? (location.pathname + location.search)), { scroll: true });
    return false;
  }, [haySesion, router]);
  const value = useMemo(() => ({ haySesion, pedirSesion }), [haySesion, pedirSesion]);
  return <MuroContext.Provider value={value}>{children}</MuroContext.Provider>;
}

export function useMuroSesion() { return useContext(MuroContext); }
