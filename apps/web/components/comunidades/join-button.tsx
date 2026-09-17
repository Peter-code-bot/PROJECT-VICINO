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
  /**
   * La privacidad no me frena: publica, o tengo el mando, o el pase de una
   * aceptacion anterior sigue vigente (sali y puedo volver sin pedir permiso).
   * Lo calcula la base (detalle_comunidad / descubrir_comunidades).
   */
  puedo_entrar?: boolean;
}

interface JoinButtonProps {
  communityId: string;
  nombre: string;
  esPrivada: boolean;
  estado: EstadoRelacion;
  /** El padre recibe el estado autoritativo (o el optimista) para pintar el conteo. */
  onEstado?: (estado: EstadoRelacion) => void;
  size?: "sm" | "md";
  /**
   * "icono": salir se pinta como un icono redondo, para la triada de la
   * cabecera. Solo cambia la forma; la confirmacion, el caso de la ultima
   * persona, los toasts y el optimismo son los mismos. Existe para que la
   * cabecera no reimplemente la salida a mano y se quede sin ellos.
   * Entrar, solicitar y "solicitud enviada" se pintan igual en las dos
   * variantes: la cabecera solo pide "icono" cuando ya eres miembro.
   */
  variante?: "boton" | "icono";
  className?: string;
}

/**
 * Misma forma que el boton de volver de la cabecera. El after: esta porque un
 * circulo de 40 px no llega a los 44 px de area tactil, y agrandar el circulo
 * lo descuadraria de los otros iconos de la fila.
 */
const BOTON_ICONO =
  "relative flex h-10 w-10 items-center justify-center rounded-full bg-[color:var(--card-2)] text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-[color:var(--border)]/20 disabled:opacity-60 after:absolute after:left-1/2 after:top-1/2 after:h-11 after:w-11 after:-translate-x-1/2 after:-translate-y-1/2 after:content-['']";

/**
 * Un solo boton para toda la relacion con una comunidad (decision 3):
 *   miembro                    -> "Salir" (con confirmacion; el owner tambien
 *                                 puede: el traspaso lo hace la base; si era
 *                                 la unica persona, la comunidad se archiva
 *                                 y el dialogo lo dice)
 *   publica y no soy miembro   -> "Únete" (aunque quede una solicitud vieja
 *                                 de cuando era privada: en una publica se
 *                                 entra con un toque)
 *   privada con pase vigente   -> "Volver a entrar" (la base ya me deja)
 *   solicitud pendiente        -> "Solicitud enviada" con Cancelar
 *   privada y no soy miembro   -> "Solicitar unirse" (abre el mensaje opcional)
 * Optimista y reconciliado con lo que devuelve la RPC. Si solicitar responde
 * que se entra directo (publica, o pase vigente), encadena Únete.
 */
export function JoinButton({
  communityId,
  nombre,
  esPrivada,
  estado,
  onEstado,
  size = "md",
  variante = "boton",
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
        if (r.data.soy_miembro) toast.success(`Ya eres parte de ${nombre}`);
        else if (r.data.archivada) toast.success(`Saliste de ${nombre}. Como no quedaba nadie, la comunidad se archivó.`);
        else toast.success(`Saliste de ${nombre}`);
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
        if (!("data" in r)) return;
        if (r.data.entrarDirecto) {
          // La base dijo que solicitar no es el camino (se abrio entre el
          // render y el toque, o mi pase sigue vigente): se entra directo.
          aplicar({ ...local, solicitud_pendiente: false });
          void alternar.mutate(undefined);
          return;
        }
        toast.success(r.data.repetida ? "Tu solicitud sigue pendiente" : "Solicitud enviada");
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

  // Si sale la unica persona, comunidad_traspasa_mando archiva la comunidad
  // sin vuelta desde la app: el dialogo tiene que decir eso y no "el mando
  // pasa a otra persona".
  const ultimaPersona = local.mi_rol === "owner" && local.miembros_count <= 1;
  // Publica, o pase vigente: se entra con un toque, sin solicitud.
  const entraDirecto = !esPrivada || local.puedo_entrar === true;

  if (local.soy_miembro) {
    return (
      <>
        {variante === "icono" ? (
          <button
            type="button"
            className={cn(BOTON_ICONO, className)}
            onClick={() => setConfirmarSalir(true)}
            disabled={pendiente}
            aria-label={`Salir de ${nombre}`}
          >
            <LogOut className="h-5 w-5" aria-hidden="true" />
          </button>
        ) : (
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
        )}
        <ConfirmarDialog
          open={confirmarSalir}
          onOpenChange={setConfirmarSalir}
          titulo={ultimaPersona ? `Salir y archivar ${nombre}` : `Salir de ${nombre}`}
          cuerpo={
            ultimaPersona
              ? "Eres la única persona en esta comunidad. Si sales, se archiva: dejará de verse, nadie podrá leerla ni unirse, y no se puede recuperar desde la app."
              : local.mi_rol === "owner"
                ? "Eres quien administra esta comunidad. Si sales, el mando pasa a otra persona y dejarás de ver el muro. Puedes volver a unirte después."
                : "Dejarás de ver el muro y de recibir avisos de esta comunidad. Puedes volver a unirte después."
          }
          confirmar={ultimaPersona ? "Salir y archivar" : "Salir"}
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

  if (local.solicitud_pendiente && !entraDirecto) {
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

  if (esPrivada && !entraDirecto) {
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
      {esPrivada ? "Volver a entrar" : "Únete"}
    </Button>
  );
}
