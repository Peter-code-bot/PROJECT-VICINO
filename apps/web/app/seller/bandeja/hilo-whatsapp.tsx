"use client";

import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { AlertCircle, Check, CheckCheck, Clock, Send } from "lucide-react";

import { BotonRegresar } from "@/components/ui/boton-regresar";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { canalesGestionados } from "@/lib/realtime/canales-gestionados";
import { TEXTO_MAXIMO_WHATSAPP, mensajeParaUsuario, textoDeMensaje } from "@/lib/whatsapp/presentacion";
import { etiquetaVentana, ventanaWhatsApp } from "@/lib/whatsapp/ventana";
import { cn } from "@/lib/utils";
import { useRouter } from "next/navigation";
import { marcarLeidaWhatsApp, responderWhatsApp } from "./actions";

export interface MensajeHilo {
  id: string;
  direccion: "entrante" | "saliente";
  tipo: string;
  texto: string | null;
  estado: string;
  /** Codigo de Meta (o propio, negativo) de un envio fallido. El detalle crudo no viaja al cliente. */
  error_codigo: number | null;
  marca_tiempo: string;
}

export type EstadoCanal = "activo" | "pausado" | "desconocido";

interface Props {
  conversacionId: string;
  nombre: string;
  numero: string;
  ultimoEntranteAt: string | null;
  estadoCanal: EstadoCanal;
  mensajes: MensajeHilo[];
  errorCarga: boolean;
  hayMasAntiguos: boolean;
}

function EstadoEnvio({ estado }: { estado: string }) {
  const comun = "h-3.5 w-3.5 shrink-0";
  switch (estado) {
    case "pendiente":
      return <Clock className={cn(comun, "opacity-70")} aria-label="Sin confirmar" />;
    case "enviado":
      return <Check className={comun} aria-label="Enviado" />;
    case "entregado":
      return <CheckCheck className={comun} aria-label="Entregado" />;
    case "leido":
      return <CheckCheck className={cn(comun, "text-sky-300")} aria-label="Leído" />;
    case "fallido":
      return <AlertCircle className={cn(comun, "text-red-200")} aria-label="No se envió" />;
    default:
      return null;
  }
}

const horaFormatter = new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit" });

/**
 * true solo despues de hidratar. La hora se pinta con la zona del navegador,
 * que no es la del servidor (UTC): formatearla en el servidor daria un texto
 * distinto al del cliente y React lo marcaria como error de hidratacion.
 */
function useHidratado() {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

const TEXTO_CANAL: Record<Exclude<EstadoCanal, "activo">, string> = {
  pausado: "Tu número está pausado: no puedes responder hasta que el equipo de VICINO lo reactive. Los mensajes que te lleguen se siguen guardando.",
  desconocido: "No se pudo comprobar el estado de tu número. Recarga la página; si sigue así, avisa al equipo de VICINO.",
};

export function HiloWhatsApp({ conversacionId, nombre, numero, ultimoEntranteAt, estadoCanal, mensajes, errorCarga, hayMasAntiguos }: Props) {
  const router = useRouter();
  const hidratado = useHidratado();
  const [texto, setTexto] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [enviando, startEnviar] = useTransition();
  // Reloj del cliente: la ventana se calcula aqui para que la etiqueta no salga
  // en la hora del servidor (UTC) ni se quede vieja.
  const [ahora, setAhora] = useState<number>(() => Date.now());
  const finRef = useRef<HTMLDivElement>(null);
  const ultimoIdRef = useRef<string | null>(null);

  const ventana = ventanaWhatsApp(ultimoEntranteAt, ahora);
  const puedeResponder = estadoCanal === "activo" && ventana.abierta;
  const ultimo = mensajes[mensajes.length - 1];

  useEffect(() => {
    const t = setInterval(() => setAhora(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  // Marcar leida al abrir y cada vez que llega algo nuevo del cliente.
  useEffect(() => {
    if (ultimo?.direccion === "entrante" || mensajes.length === 0) {
      void marcarLeidaWhatsApp({ conversacionId });
    }
    // Solo cuando cambia el ultimo mensaje, no en cada render.
  }, [conversacionId, ultimo?.id, ultimo?.direccion, mensajes.length]);

  // Bajar al final solo cuando hay un mensaje NUEVO (no cuando cambia la
  // palomita de uno que ya estaba: eso arrastraria a quien subio a leer).
  useEffect(() => {
    if (!ultimo || ultimoIdRef.current === ultimo.id) return;
    ultimoIdRef.current = ultimo.id;
    finRef.current?.scrollIntoView({ block: "end" });
  }, [ultimo]);

  // Cambios en vivo: mensajes nuevos o estados (entregado, leido) de esta
  // conversacion. Tras responder no hace falta refrescar a mano: la accion ya
  // revalida y realtime trae lo demas.
  useEffect(() => {
    const supabase = createClient();
    const controller = canalesGestionados(supabase);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let disposed = false;
    const programar = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!disposed) router.refresh();
      }, 300);
    };
    const unregister = controller.registrar(`wa-hilo:${conversacionId}`, ({ vigente }) =>
      supabase
        .channel(`wa-hilo:${conversacionId}`)
        .on(
          "postgres_changes",
          { event: "*", schema: "public", table: "mensajes_whatsapp", filter: `conversacion_id=eq.${conversacionId}` },
          () => {
            if (vigente()) programar();
          },
        )
        .on(
          "postgres_changes",
          { event: "UPDATE", schema: "public", table: "conversaciones_whatsapp", filter: `id=eq.${conversacionId}` },
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
  }, [conversacionId, router]);

  const enviar = () => {
    const limpio = texto.trim();
    if (!limpio || enviando) return;
    setError(null);
    startEnviar(async () => {
      const r = await responderWhatsApp({ conversacionId, texto: limpio });
      if (r.ok) setTexto("");
      else setError(r.error);
    });
  };

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex items-center gap-3 min-w-0">
        <BotonRegresar href="/seller/bandeja" aria-label="Volver a la bandeja de WhatsApp" />
        <div className="min-w-0">
          <h1 className="text-lg font-bold truncate">{nombre}</h1>
          <p className="text-xs text-[color:var(--fg-dim)] truncate">{numero}</p>
        </div>
      </div>

      <p
        className={cn(
          "rounded-[var(--r-xl)] px-3 py-2 text-xs",
          puedeResponder
            ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-100"
            : "bg-amber-50 text-amber-900 dark:bg-amber-950/40 dark:text-amber-100",
        )}
        suppressHydrationWarning
      >
        {estadoCanal !== "activo" ? TEXTO_CANAL[estadoCanal] : etiquetaVentana(ventana)}
      </p>

      {errorCarga ? (
        <p className="text-sm text-[color:var(--danger)]">No se pudieron cargar los mensajes. Intenta de nuevo.</p>
      ) : null}

      {hayMasAntiguos ? (
        <p className="text-center text-xs text-[color:var(--fg-dim)]">Se muestran los últimos {mensajes.length} mensajes.</p>
      ) : null}

      <ol className="flex flex-col gap-2" aria-label="Mensajes">
        {mensajes.map((m) => {
          const saliente = m.direccion === "saliente";
          return (
            <li key={m.id} className={cn("flex", saliente ? "justify-end" : "justify-start")}>
              <div
                className={cn(
                  "max-w-[85%] rounded-[var(--r-xl)] px-3 py-2 text-sm whitespace-pre-wrap break-words",
                  saliente
                    ? "bg-emerald-600 text-white rounded-br-sm"
                    : "bg-[color:var(--sidebar-bg)] text-[color:var(--fg)] rounded-bl-sm",
                )}
              >
                <p>{textoDeMensaje(m)}</p>
                <p className={cn("mt-1 flex items-center justify-end gap-1 text-[10px]", saliente ? "text-white/80" : "text-[color:var(--fg-dim)]")}>
                  <time dateTime={m.marca_tiempo}>{hidratado ? horaFormatter.format(new Date(m.marca_tiempo)) : " "}</time>
                  {saliente ? <EstadoEnvio estado={m.estado} /> : null}
                </p>
                {saliente && m.estado === "fallido" ? (
                  <p className="mt-1 text-[11px] text-red-100">No se envió: {mensajeParaUsuario(m.error_codigo)}</p>
                ) : null}
                {saliente && m.estado === "pendiente" ? (
                  <p className="mt-1 text-[11px] text-white/80">Sin confirmar: espera un momento antes de volver a mandarlo.</p>
                ) : null}
              </div>
            </li>
          );
        })}
        <div ref={finRef} />
      </ol>

      <form
        className="sticky bottom-[calc(env(safe-area-inset-bottom)+0.5rem)] flex flex-col gap-2 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-3"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <label htmlFor="respuesta-whatsapp" className="sr-only">
          Escribe tu respuesta
        </label>
        <textarea
          id="respuesta-whatsapp"
          name="texto"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
              e.preventDefault();
              enviar();
            }
          }}
          maxLength={TEXTO_MAXIMO_WHATSAPP}
          rows={2}
          disabled={!puedeResponder || enviando}
          placeholder={puedeResponder ? "Escribe tu respuesta…" : "No se puede responder ahora"}
          className="w-full resize-y rounded-lg border border-[color:var(--border)] bg-[color:var(--bg)] px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-emerald-500 disabled:opacity-60"
        />
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-[color:var(--fg-dim)]" aria-live="polite">
            {error ? <span className="text-[color:var(--danger)]">{error}</span> : `${texto.length}/${TEXTO_MAXIMO_WHATSAPP}`}
          </p>
          <Button type="submit" size="sm" loading={enviando} disabled={!puedeResponder || !texto.trim()}>
            <Send className="h-4 w-4" aria-hidden="true" />
            Enviar
          </Button>
        </div>
      </form>
    </div>
  );
}
