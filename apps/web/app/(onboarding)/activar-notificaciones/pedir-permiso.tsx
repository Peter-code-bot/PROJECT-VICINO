"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, CalendarDays, MessageCircle } from "lucide-react";
import {
  leerPermisoPush,
  pedirPermisoPush,
  type EstadoPermisoPush,
} from "@/hooks/usePushNotifications";
import { OnboardingActions, OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { conTope, esTope } from "@/lib/auth/con-tope";
import * as Sentry from "@sentry/nextjs";

interface PedirPermisoProps {
  /** The legacy page validates this against its destination whitelist. */
  siguiente?: string;
  /** Persist the next step before navigation. A rejection leaves a retry here. */
  onContinue?: () => Promise<void>;
  backHref?: string;
  step?: number;
  totalSteps?: number;
}

// These are the events currently delivered by the push pipeline. Community
// notices remain in the in-app bell and are not promised as phone alerts.
const MOTIVOS = [
  { Icono: MessageCircle, texto: "Mensajes de personas que quieren comprarte." },
  { Icono: CalendarDays, texto: "Citas y confirmaciones de venta." },
  { Icono: Bell, texto: "Los demás avisos te esperan en la campana de la app." },
] as const;

// A person may take time to answer the native dialog. The cap also provides
// an exit when a native plugin promise never resolves.
const TOPE_PERMISO_MS = 60_000;

function permisoResuelto(estado: EstadoPermisoPush | null) {
  return estado === "concedido" || estado === "no-nativo" || estado === "denegado";
}

export function PedirPermiso({
  siguiente = "/completar-perfil/listo",
  onContinue,
  backHref,
  step,
  totalSteps,
}: PedirPermisoProps) {
  const router = useRouter();
  const [permiso, setPermiso] = useState<EstadoPermisoPush | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [saliendo, setSaliendo] = useState(false);
  const [error, setError] = useState<string>();
  const [, startTransition] = useTransition();
  const callbackRef = useRef(onContinue);
  const destinoRef = useRef(siguiente);
  const montadoRef = useRef(true);
  const salidaEnCursoRef = useRef(false);
  const peticionEnCursoRef = useRef(false);
  const intentoManualRef = useRef(false);
  const autoIntentadoRef = useRef(false);

  useEffect(() => {
    callbackRef.current = onContinue;
    destinoRef.current = siguiente;
  }, [onContinue, siguiente]);

  const continuar = useCallback(() => {
    if (salidaEnCursoRef.current) return;
    salidaEnCursoRef.current = true;
    setError(undefined);
    setSaliendo(true);
    startTransition(async () => {
      try {
        await callbackRef.current?.();
        if (montadoRef.current) router.replace(destinoRef.current);
      } catch (err) {
        salidaEnCursoRef.current = false;
        if (!montadoRef.current) return;
        setSaliendo(false);
        setError("No pudimos guardar tu avance. Revisa tu conexión e inténtalo de nuevo.");
        if (!esTope(err)) {
          Sentry.captureException(err, {
            tags: { pantalla: "activar-notificaciones", accion: "guardarAvance" },
          });
        }
      }
    });
  }, [router, startTransition]);

  useEffect(() => {
    let vivo = true;
    montadoRef.current = true;
    // Reading is bounded but never disables either action. An unknown bridge
    // state still leaves the manual Continue and Skip exits available.
    void conTope(leerPermisoPush()).then((estado) => {
      if (!vivo) return;
      setPermiso(estado);
      if (permisoResuelto(estado) && !autoIntentadoRef.current && !intentoManualRef.current) {
        autoIntentadoRef.current = true;
        continuar();
      }
    }).catch((err: unknown) => {
      if (!vivo) return;
      setPermiso("error");
      if (!esTope(err)) {
        Sentry.captureException(err, {
          tags: { pantalla: "activar-notificaciones", accion: "leerPermiso" },
        });
      }
    });
    return () => {
      vivo = false;
      montadoRef.current = false;
    };
  }, [continuar]);

  async function activar() {
    if (peticionEnCursoRef.current || salidaEnCursoRef.current) return;
    intentoManualRef.current = true;
    peticionEnCursoRef.current = true;
    setPidiendo(true);
    setError(undefined);
    let estado: EstadoPermisoPush;
    try {
      estado = await conTope(pedirPermisoPush(), TOPE_PERMISO_MS);
    } catch (err) {
      if (!esTope(err)) {
        Sentry.captureException(err, {
          tags: { pantalla: "activar-notificaciones", accion: "pedirPermiso" },
        });
      }
      estado = "error";
    }
    peticionEnCursoRef.current = false;
    if (!montadoRef.current) return;
    setPidiendo(false);
    setPermiso(estado);
    // Permission refusal, errors and expiry do not prevent using VICINO.
    // Saving the next step must still succeed before replacing the route.
    continuar();
  }

  function omitir() {
    intentoManualRef.current = true;
    continuar();
  }

  const ocupado = pidiendo || saliendo;

  return (
    <OnboardingShell
      title="Activa las notificaciones"
      description="Recibe los avisos importantes de tus mensajes, citas y ventas."
      backHref={backHref}
      step={step}
      totalSteps={totalSteps}
      busy={ocupado}
      error={error}
      footer={
        <OnboardingActions
          busy={ocupado}
          onContinue={() => {
            if (permisoResuelto(permiso) || (intentoManualRef.current && permiso === "error")) {
              continuar();
            } else {
              void activar();
            }
          }}
          onSkip={omitir}
        />
      }
    >
      <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-tint text-brand dark:text-brand-hi">
        <Bell className="h-8 w-8" aria-hidden="true" />
      </div>
      <ul className="space-y-5">
        {MOTIVOS.map(({ Icono, texto }) => (
          <li key={texto} className="flex items-start gap-3">
            <Icono className="mt-0.5 h-5 w-5 shrink-0 text-brand dark:text-brand-hi" aria-hidden="true" />
            <span className="text-base leading-relaxed text-fg">{texto}</span>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-sm leading-relaxed text-fg-muted">
        Puedes elegir qué recibir en Configuración cuando quieras.
      </p>
    </OnboardingShell>
  );
}
