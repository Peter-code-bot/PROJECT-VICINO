"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

import { createClient } from "@/lib/supabase/client";
import { canalesGestionados } from "@/lib/realtime/canales-gestionados";

/**
 * Refresca la lista de conversaciones cuando la base cambia (llega un
 * mensaje, se responde, se marca leida). La suscripcion pasa por la RLS: el
 * negocio solo recibe cambios de sus propias filas. Mismo patron que
 * hooks/use-chat-unread-count.ts (canalesGestionados pausa en segundo plano
 * y reconecta solo).
 */
export function RefrescoBandeja({ negocioId }: { negocioId: string }) {
  const router = useRouter();

  useEffect(() => {
    if (!negocioId) return;
    const supabase = createClient();
    const controller = canalesGestionados(supabase);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const programar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed) router.refresh();
      }, 400);
    };
    const unregister = controller.registrar(`wa-bandeja:${negocioId}`, ({ vigente }) =>
      supabase
        .channel(`wa-bandeja:${negocioId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "conversaciones_whatsapp", filter: `negocio_id=eq.${negocioId}` },
          () => {
            if (vigente()) programar();
          },
        )
        .subscribe(),
    );
    return () => {
      disposed = true;
      clearTimeout(timer);
      unregister();
    };
  }, [negocioId, router]);

  return null;
}
