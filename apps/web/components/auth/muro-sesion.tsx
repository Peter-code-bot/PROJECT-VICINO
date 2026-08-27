"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogIn, UserPlus, X } from "lucide-react";

/**
 * El muro de sesión que pidió Alejandro el 26-ago-2026.
 *
 * REGLA DE PRODUCTO: sin sesión se puede MIRAR —deslizar el feed, ver
 * publicaciones— pero cualquier INTERACCIÓN manda a identificarse.
 *
 * POR QUÉ UNA HOJA Y NO UN REDIRECT SECO. Es la referencia que Pedro pidió
 * para el producto: Instagram no te saca de donde estás cuando tocas un
 * corazón sin sesión, te enseña una hoja encima y puedes cerrarla. Sacar a
 * alguien de una publicación que estaba mirando para pedirle una cuenta es
 * perder las dos cosas.
 *
 * Y aun así reutiliza la maquinaria que ya funciona: los dos botones llevan
 * `?next=` con la página actual, que es lo que el login y el registro respetan
 * — desde hoy también el registro y los dos caminos de OAuth, que hasta ayer
 * lo tiraban.
 *
 * QUÉ RESUELVE, en concreto. Sin esto, tocar el corazón sin sesión hacía esto:
 * el corazón se pintaba rojo por el optimista, la acción de servidor contestaba
 * `{ error: "No autenticado" }` sin redirigir, y el corazón volvía a gris. Ni
 * aviso, ni destino, nada. En red lenta parecía que había guardado y se había
 * deshecho solo.
 */

interface MuroValue {
  /** true si hay sesión. Lo pone el layout desde el servidor. */
  haySesion: boolean;
  /**
   * Pide identificarse para hacer algo. Devuelve `true` si hay sesión y quien
   * llama puede seguir; `false` si se abrió la hoja y hay que abortar.
   *
   * Se devuelve un booleano a propósito, para que el sitio de llamada sea
   * `if (!pedirSesion("...")) return;` — una línea, imposible de olvidar a
   * medias.
   */
  pedirSesion: (motivo: string) => boolean;
}

const MuroContext = createContext<MuroValue>({
  // Fuera del proveedor NO se bloquea nada: un componente montado sin layout
  // seguiria funcionando como hasta ahora, y el corte de servidor sigue ahi.
  // Bloquear por defecto convertiria un error de montaje en una app muerta.
  haySesion: true,
  pedirSesion: () => true,
});

export function MuroSesionProvider({
  haySesion,
  children,
}: {
  haySesion: boolean;
  children: ReactNode;
}) {
  const [motivo, setMotivo] = useState<string | null>(null);

  const pedirSesion = useCallback(
    (razon: string) => {
      if (haySesion) return true;
      setMotivo(razon);
      return false;
    },
    [haySesion],
  );

  const valor = useMemo(
    () => ({ haySesion, pedirSesion }),
    [haySesion, pedirSesion],
  );

  return (
    <MuroContext.Provider value={valor}>
      {children}
      {motivo !== null && (
        <HojaDeSesion motivo={motivo} onCerrar={() => setMotivo(null)} />
      )}
    </MuroContext.Provider>
  );
}

export function useMuroSesion() {
  return useContext(MuroContext);
}

function HojaDeSesion({
  motivo,
  onCerrar,
}: {
  motivo: string;
  onCerrar: () => void;
}) {
  const pathname = usePathname();
  // El destino es la página donde está la persona AHORA. Es lo que hace que
  // cerrar el paréntesis funcione: entra, y vuelve a la misma publicación.
  const destino = encodeURIComponent(pathname);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 backdrop-blur-[2px]"
      onClick={onCerrar}
      role="dialog"
      aria-modal="true"
      aria-label="Inicia sesión para continuar"
    >
      <div
        className="w-full max-w-md rounded-t-3xl bg-card p-6 pb-[calc(1.5rem+env(safe-area-inset-bottom))] shadow-[0_-8px_40px_rgba(0,0,0,0.35)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mx-auto mb-5 h-1 w-10 rounded-full bg-[color:var(--border)]" />

        <button
          type="button"
          onClick={onCerrar}
          aria-label="Cerrar"
          className="absolute right-5 top-5 rounded-full p-1 text-[color:var(--fg-dim)] transition-colors hover:text-[color:var(--fg)]"
        >
          <X className="h-5 w-5" />
        </button>

        <h2 className="font-heading text-lg font-bold text-[color:var(--fg)]">
          {motivo}
        </h2>
        <p className="mt-1.5 text-sm text-[color:var(--fg-muted)]">
          Crea tu cuenta en un minuto. Volvemos justo a donde estabas.
        </p>

        <div className="mt-5 flex flex-col gap-2.5">
          <Link
            href={`/register?next=${destino}`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[color:var(--brand)] font-semibold text-white shadow-[var(--shadow-glow)] transition-colors hover:bg-[color:var(--brand-dark)]"
          >
            <UserPlus className="h-4 w-4" />
            Crear cuenta
          </Link>
          <Link
            href={`/login?next=${destino}`}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-2xl bg-[color:var(--card-2)] font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
          >
            <LogIn className="h-4 w-4" />
            Ya tengo cuenta
          </Link>
        </div>
      </div>
    </div>
  );
}
