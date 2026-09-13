"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Clock, Lock, LogOut, UserPlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { hapticMedium } from "@/lib/haptics";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { COMMUNITY_JOIN_MESSAGE_MAX } from "@vicino/shared";
import {
  alternarMembresia,
  solicitarUnion,
  cancelarSolicitudPropia,
} from "@/app/(marketplace)/comunidades/actions";
import { ConfirmarDialog } from "./confirmar-dialog";

export interface EstadoRelacion {
  soy_miembro: boolean;
  mi_rol: string | null;
  solicitud_pendiente: boolean;
  miembros_count: number;
}

interface JoinButtonProps {
  communityId: string;
  nombre: string;
  esPrivada: boolean;
  estado: EstadoRelacion;
  /** El padre recibe el estado autoritativo (o el optimista) para pintar el conteo. */
  onEstado?: (estado: EstadoRelacion) => void;
  size?: "sm" | "md";
  className?: string;
}

/**
 * Un solo boton para toda la relacion con una comunidad (decision 3):
 *   publica y no soy miembro   -> "Únete"
 *   privada y no soy miembro   -> "Solicitar unirse" (abre el mensaje opcional)
 *   solicitud pendiente        -> "Solicitud enviada" con Cancelar
 *   miembro                    -> "Salir" (con confirmacion; el owner tambien
 *                                 puede: el traspaso lo hace la base)
 * Optimista y reconciliado con lo que devuelve la RPC.
 */
export function JoinButton({
  communityId,
  nombre,
  esPrivada,
  estado,
  onEstado,
  size = "md",
  className,
}: JoinButtonProps) {
  const [local, setLocal] = useState<EstadoRelacion>(estado);
  const [confirmarSalir, setConfirmarSalir] = useState(false);
  const [pedirMensaje, setPedirMensaje] = useState(false);
  const [mensaje, setMensaje] = useState("");

  // El servidor manda: si el padre trae una copia fresca, la local se rinde.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resincronizar con el estado del servidor cuando cambia la prop
    setLocal(estado);
  }, [estado]);

  function aplicar(siguiente: EstadoRelacion) {
    setLocal(siguiente);
    onEstado?.(siguiente);
  }

  const alternar = useOptimisticMutation(() => alternarMembresia(communityId), {
    onMutate: () => {
      const previo = local;
      const entra = !previo.soy_miembro;
      aplicar({
        ...previo,
        soy_miembro: entra,
        mi_rol: entra ? "member" : null,
        solicitud_pendiente: false,
        miembros_count: Math.max(0, previo.miembros_count + (entra ? 1 : -1)),
      });
      return () => aplicar(previo);
    },
    onSuccess: (r) => {
      if ("data" in r) {
        aplicar({
          ...local,
          soy_miembro: r.data.soy_miembro,
          mi_rol: r.data.soy_miembro ? (local.mi_rol ?? "member") : null,
          solicitud_pendiente: false,
          miembros_count: r.data.miembros_count,
        });
        toast.success(r.data.soy_miembro ? `Ya eres parte de ${nombre}` : `Saliste de ${nombre}`);
      }
      setConfirmarSalir(false);
    },
    onError: (err) => {
      setConfirmarSalir(false);
      toast.error(err instanceof Error ? err.message : "No se pudo completar");
    },
  });

  const solicitar = useOptimisticMutation(
    (texto: string) => solicitarUnion({ community_id: communityId, mensaje: texto }),
    {
      onMutate: () => {
        const previo = local;
        aplicar({ ...previo, solicitud_pendiente: true });
        return () => aplicar(previo);
      },
      onSuccess: (r) => {
        setPedirMensaje(false);
        setMensaje("");
        if ("data" in r) {
          toast.success(r.data.repetida ? "Tu solicitud sigue pendiente" : "Solicitud enviada");
        }
      },
      onError: (err) => {
        toast.error(err instanceof Error ? err.message : "No se pudo enviar la solicitud");
      },
    },
  );

  const cancelar = useOptimisticMutation(() => cancelarSolicitudPropia(communityId), {
    onMutate: () => {
      const previo = local;
      aplicar({ ...previo, solicitud_pendiente: false });
      return () => aplicar(previo);
    },
    onSuccess: () => toast.success("Solicitud cancelada"),
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo cancelar"),
  });

  const pendiente = alternar.isPending || solicitar.isPending || cancelar.isPending;
  const tam = size === "sm" ? "sm" : "md";

  if (local.soy_miembro) {
    return (
      <>
        <Button
          type="button"
          variant="secondary"
          size={tam}
          className={cn("rounded-full", className)}
          onClick={() => setConfirmarSalir(true)}
          disabled={pendiente}
          aria-label={`Salir de ${nombre}`}
        >
          <LogOut className="h-4 w-4" />
          Salir
        </Button>
        <ConfirmarDialog
          open={confirmarSalir}
          onOpenChange={setConfirmarSalir}
          titulo={`Salir de ${nombre}`}
          cuerpo={
            local.mi_rol === "owner"
              ? "Eres quien administra esta comunidad. Si sales, el mando pasa a otra persona y dejarás de ver el muro. Puedes volver a unirte después."
              : "Dejarás de ver el muro y de recibir avisos de esta comunidad. Puedes volver a unirte después."
          }
          confirmar="Salir"
          peligroso
          pendiente={alternar.isPending}
          onConfirmar={() => {
            void hapticMedium();
            void alternar.mutate(undefined);
          }}
        />
      </>
    );
  }

  if (local.solicitud_pendiente) {
    return (
      <div className={cn("inline-flex items-center gap-1.5", className)}>
        <span className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[color:var(--brand-tint)] px-3 text-[13px] font-semibold text-[color:var(--brand-hi)]">
          <Clock className="h-4 w-4" />
          Solicitud enviada
        </span>
        <button
          type="button"
          onClick={() => void cancelar.mutate(undefined)}
          disabled={pendiente}
          aria-label="Cancelar solicitud"
          className="flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--card-2)] text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:text-[color:var(--fg)] disabled:opacity-60"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  if (esPrivada) {
    return (
      <>
        <Button
          type="button"
          variant="primary"
          size={tam}
          className={cn("rounded-full", className)}
          onClick={() => setPedirMensaje(true)}
          disabled={pendiente}
        >
          <Lock className="h-4 w-4" />
          Solicitar unirse
        </Button>
        <Dialog open={pedirMensaje} onOpenChange={(v) => (!solicitar.isPending ? setPedirMensaje(v) : undefined)}>
          <DialogContent className="max-w-sm">
            <DialogHeader>
              <DialogTitle className="font-heading text-lg font-bold">Solicitar unirse a {nombre}</DialogTitle>
              <DialogDescription>
                Esta comunidad es privada. Quien la administra revisará tu solicitud. Puedes dejar un mensaje.
              </DialogDescription>
            </DialogHeader>
            <textarea
              value={mensaje}
              onChange={(e) => setMensaje(e.target.value.slice(0, COMMUNITY_JOIN_MESSAGE_MAX))}
              rows={3}
              maxLength={COMMUNITY_JOIN_MESSAGE_MAX}
              placeholder="Hola, vivo por aquí y me gustaría unirme"
              className="w-full resize-none rounded-xl border border-input bg-background px-4 py-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/50 focus:ring-2 focus:ring-primary/20"
            />
            <p className="-mt-2 text-right text-xs text-[color:var(--fg-dim)]">
              {mensaje.length}/{COMMUNITY_JOIN_MESSAGE_MAX}
            </p>
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={() => setPedirMensaje(false)} disabled={solicitar.isPending}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void solicitar.mutate(mensaje)} loading={solicitar.isPending}>
                Enviar solicitud
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  return (
    <Button
      type="button"
      variant="primary"
      size={tam}
      className={cn("rounded-full", className)}
      onClick={() => {
        void hapticMedium();
        void alternar.mutate(undefined);
      }}
      disabled={pendiente}
    >
      {pendiente ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
      Únete
    </Button>
  );
}
