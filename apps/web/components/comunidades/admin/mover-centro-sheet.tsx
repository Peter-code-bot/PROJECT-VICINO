"use client";

import { useEffect, useState, startTransition } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
import { AnimatePresence, motion } from "framer-motion";
import { toast } from "sonner";
import { X, Loader2, LocateFixed } from "lucide-react";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { editarCentro } from "@/app/(marketplace)/comunidades/actions";
import type { CentroComunidad } from "@/lib/comunidades/tipos";

const CentroMap = dynamic(() => import("./centro-map"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[240px] items-center justify-center rounded-2xl bg-[color:var(--card-2)]">
      <Loader2 className="h-5 w-5 animate-spin text-[color:var(--brand-hi)]" />
    </div>
  ),
});

interface Props {
  open: boolean;
  onClose: () => void;
  communityId: string;
  centro: CentroComunidad;
  onMovido: (centro: CentroComunidad) => void;
}

/**
 * Sheet para mover el centro: mapa que se arrastra y se acerca con la pinza,
 * pin movible y guardado sin limite de distancia. La base sigue siendo quien
 * decide: si rechaza el punto (fuera de Mexico, otra comunidad propia
 * demasiado cerca, nombre ya usado en la celda destino, cuota diaria agotada)
 * el mensaje llega ya traducido desde la accion y se pinta tal cual. Aqui no
 * se adelanta ningun veredicto: adelantarlo deshabilitaba el boton en puntos
 * que la base habria aceptado.
 */
export function MoverCentroSheet({ open, onClose, communityId, centro, onMovido }: Props) {
  const [mounted, setMounted] = useState(false);
  const [punto, setPunto] = useState({ lat: centro.lat, lng: centro.lng });
  // El encuadre NO sigue al pin: solo se mueve al abrir y cuando el GPS da un
  // punto, que puede caer fuera de la pantalla. Si siguiera al pin, cada toque
  // recentraria el mapa y tiraria el zoom que la persona acaba de hacer.
  const [vista, setVista] = useState({ lat: centro.lat, lng: centro.lng });
  const [guardando, setGuardando] = useState(false);
  const [buscandoGps, setBuscandoGps] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useBodyScrollLock(open);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal mount-detection pattern
    setMounted(true);
  }, []);

  // Reset al abrir, en una transicion (mismo patron que change-location-sheet).
  useEffect(() => {
    if (!open) return;
    startTransition(() => {
      setPunto({ lat: centro.lat, lng: centro.lng });
      setVista({ lat: centro.lat, lng: centro.lng });
      setError(null);
    });
  }, [open, centro.lat, centro.lng]);

  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !guardando) onClose();
    };
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open, onClose, guardando]);

  // Un punto con coordenadas no finitas llegaria a la RPC como NaN y volveria
  // como un error de validacion sin nada que senalar en el mapa.
  const puntoValido = Number.isFinite(punto.lat) && Number.isFinite(punto.lng);
  const puedeGuardar = !guardando && puntoValido;

  function usarGps() {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setError("Geolocalización no disponible en este dispositivo");
      return;
    }
    setBuscandoGps(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setBuscandoGps(false);
        setPunto({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setVista({ lat: pos.coords.latitude, lng: pos.coords.longitude });
      },
      (err) => {
        setBuscandoGps(false);
        setError(err.code === 1 ? "Permiso de ubicación denegado" : "No se pudo obtener tu ubicación");
      },
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 300_000 },
    );
  }

  async function guardar() {
    if (!puedeGuardar) return;
    setGuardando(true);
    setError(null);
    const r = await editarCentro({ community_id: communityId, lat: punto.lat, lng: punto.lng });
    setGuardando(false);
    if ("error" in r) {
      setError(r.error);
      return;
    }
    if (!r.data.movido) {
      toast.info("El centro ya estaba en esa zona; no se gastó ningún movimiento.");
      onClose();
      return;
    }
    toast.success("Centro movido");
    // Solo se refrescan las coordenadas. El contador de movimientos ya no se
    // pinta en ningun sitio y leerlo aqui ataria este archivo a una columna
    // que la RPC puede dejar de devolver.
    onMovido({ ...centro, lat: r.data.lat, lng: r.data.lng });
    onClose();
  }

  if (!mounted) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            key="overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            onClick={guardando ? undefined : onClose}
            className="fixed inset-0 z-[100] bg-black/60 backdrop-blur-sm md:left-64"
            aria-hidden
          />
          <div className="pointer-events-none fixed inset-0 z-[100] flex items-end md:left-64" data-modal-open="true">
            <motion.div
              key="sheet"
              role="dialog"
              aria-modal="true"
              aria-label="Mover el centro de la comunidad"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="pointer-events-auto w-full overflow-y-auto overscroll-contain rounded-t-3xl bg-[color:var(--bg)] px-5 pb-[calc(env(safe-area-inset-bottom)_+_1.5rem)]"
              style={{ maxHeight: "90vh" }}
            >
              <div className="mx-auto mt-3 mb-4 h-1 w-12 rounded-full bg-[color:var(--fg-dim)]/30" />
              <div className="flex items-center justify-between pb-4">
                <div>
                  <h2 className="font-heading text-xl font-bold text-[color:var(--fg)]">Mover el centro</h2>
                  <p className="text-xs text-[color:var(--fg-muted)]">
                    Arrastra el pin o toca el mapa. Se guarda como zona aproximada, no como dirección.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  disabled={guardando}
                  aria-label="Cerrar"
                  className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--card-2)] transition-colors hover:bg-[color:var(--border)]/20"
                >
                  <X size={18} className="text-[color:var(--fg-muted)]" />
                </button>
              </div>

              <CentroMap
                lat={punto.lat}
                lng={punto.lng}
                vista={vista}
                onMove={(lat, lng) => setPunto({ lat, lng })}
              />

              <button
                type="button"
                onClick={usarGps}
                disabled={buscandoGps || guardando}
                className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-[color:var(--card-2)] px-4 py-3 text-left shadow-[inset_0_0_0_1px_var(--border)] transition-all hover:shadow-[inset_0_0_0_1px_var(--brand-hi)] disabled:opacity-60"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-tint)]">
                  {buscandoGps ? (
                    <Loader2 size={18} className="animate-spin text-[color:var(--brand-hi)]" />
                  ) : (
                    <LocateFixed size={18} className="text-[color:var(--brand-hi)]" />
                  )}
                </span>
                <span className="font-heading text-sm font-semibold text-[color:var(--fg)]">Usar mi ubicación actual</span>
              </button>

              {error && <p className="mt-3 text-sm font-medium text-[color:var(--danger)]">{error}</p>}

              <button
                type="button"
                onClick={() => void guardar()}
                disabled={!puedeGuardar}
                className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--brand)] font-semibold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)] disabled:opacity-50 disabled:shadow-none"
              >
                {guardando && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar nuevo centro
              </button>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
