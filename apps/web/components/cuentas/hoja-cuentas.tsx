"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { BottomSheet } from "@/components/product/bottom-sheet";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cn } from "@/lib/utils";
import { buscarCuenta, guardarCuenta, MAX_CUENTAS, type Cuenta } from "@/lib/cuentas/boveda";
import { useCuentas } from "@/lib/cuentas/use-cuentas";
import { cambiarACuenta, datosDeSesion, nombreVisible, sesionActivaParaGuardar } from "@/lib/cuentas/cambio";
import { puertoCambioReal } from "@/lib/cuentas/puertos";
import { DESTINO_TRAS_AGREGAR, hrefAgregarCuenta, marcarAgregandoCuenta } from "@/lib/cuentas/agregando-cuenta";
import { desmarcarCambioEnCurso, marcarCambioEnCurso } from "@/lib/cuentas/cambio-en-curso";
import { pedirRegistroPush } from "@/lib/push/registro";

interface HojaCuentasProps {
  open: boolean;
  onClose: () => void;
  /** La cuenta con sesion: la que el servidor pinto en el layout. */
  userId: string;
  /** Cierra la hoja Y el cajon que la abrio, justo antes de navegar. */
  onNavegar: () => void;
}

type Ocupado =
  | { tipo: "cambiar"; userId: string }
  | { tipo: "agregar" }
  | null;

/**
 * La hoja "Cuentas": las cuentas guardadas en este telefono, la activa marcada,
 * y "Agregar cuenta" al final. Es lo que Instagram abre al tocar el nombre de
 * usuario en el perfil (decision D1).
 *
 * Mientras una accion esta en vuelo las filas se deshabilitan, pero la hoja
 * SE PUEDE CERRAR (Escape, Atras, el fondo): una peticion colgada no puede
 * dejar a nadie atrapado en un modal. Si se cierra con la accion en vuelo, el
 * resultado llega por toast.
 */
export function HojaCuentas({ open, onClose, userId, onNavegar }: HojaCuentasProps) {
  const router = useRouter();
  const cuentas = useCuentas();
  const [ocupado, setOcupado] = useState<Ocupado>(null);
  const [error, setError] = useState<string | null>(null);
  const abiertaRef = useRef(open);
  useEffect(() => {
    abiertaRef.current = open;
  }, [open]);
  // Cada apertura empieza limpia: un fallo de una accion que siguio en vuelo
  // con la hoja cerrada ya se aviso por toast. Se ajusta durante el render
  // (patron "estado derivado de una prop" de React), no en un efecto.
  const [abiertaAntes, setAbiertaAntes] = useState(open);
  if (open !== abiertaAntes) {
    setAbiertaAntes(open);
    if (open) {
      setError(null);
    }
  }

  const activa = cuentas.find((c) => c.userId === userId) ?? null;
  const dormidas = cuentas.filter((c) => c.userId !== userId);
  const llena = cuentas.length >= MAX_CUENTAS;
  // La activa sin sitio: cinco dormidas de otras cuentas y la que tiene sesion
  // no cabe. Se dice tal cual; lo contrario era una lista sin marca de activa.
  const activaSinSitio = !activa && llena;

  const cerrar = useCallback(() => {
    setError(null);
    onClose();
  }, [onClose]);

  function avisar(mensaje: string) {
    if (abiertaRef.current) setError(mensaje);
    else toast.error(mensaje);
  }

  function irAlPerfil() {
    onNavegar();
    router.push(DESTINO_TRAS_AGREGAR);
  }

  async function cambiar(cuenta: Cuenta) {
    if (ocupado) return;
    setError(null);
    setOcupado({ tipo: "cambiar", userId: cuenta.userId });
    try {
      const resultado = await cambiarACuenta(cuenta, puertoCambioReal());
      if (!resultado.ok) {
        if (resultado.motivo === "sin_sesion") {
          // La sesion actual murio y la otra no entro: no queda ninguna.
          toast.error(resultado.mensaje);
          onNavegar();
          window.location.replace("/login");
          return;
        }
        if (resultado.motivo !== "en_curso") {
          avisar(resultado.mensaje);
          // El paso 4 pudo soltar el token de push de la cuenta actual antes
          // de que el 6 fallara: se vuelve a pedir (es idempotente).
          pedirRegistroPush();
        }
        return;
      }
      toast.success(`Ahora estás en ${resultado.nombre}`);
      onNavegar();
      // Navegacion BLANDA: el router lee document.cookie en JS. Una navegacion
      // completa podria salir sin la cookie nueva en iOS (ver
      // components/auth/oauth-url-listener.tsx). Mismo compas de 50 ms que ahi.
      router.refresh();
      setTimeout(() => router.replace(DESTINO_TRAS_AGREGAR), 50);
    } finally {
      setOcupado(null);
    }
  }

  async function agregar() {
    if (ocupado) return;
    setError(null);
    if (llena) {
      avisar(activaSinSitio ? "Tu cuenta actual no cabe en la lista. Gestiona tus cuentas en Configuración." : "Gestiona tus cuentas en Configuración para agregar otra.");
      return;
    }
    setOcupado({ tipo: "agregar" });
    try {
      // La cuenta actual se guarda ANTES de salir hacia /login: el login (o
      // Google, o Apple) va a pisar la cookie con la cuenta nueva, y sin esto
      // la actual se perderia. Con la misma exigencia que el paso 1 del cambio
      // (lib/cuentas/cambio.ts): si al token le queda poco, se refresca para
      // que lo guardado no lo roten el ticker ni el proxy mientras la persona
      // esta en /login (EspejoDeTokens cubre el resto). Si no se puede
      // guardar, no se sale.
      const puerto = puertoCambioReal();
      // Marca mientras se asegura la sesion: un refresh puede hacer que
      // auth-js borre y vuelva a poner la cookie, y el proveedor no debe
      // navegar ni recargar por eso. Se quita en cuanto termina.
      marcarCambioEnCurso(userId);
      let activa;
      try {
        activa = await sesionActivaParaGuardar(puerto.principal, puerto.reportar);
      } finally {
        desmarcarCambioEnCurso();
      }
      if (activa.estado === "red") {
        avisar("Sin conexión. Inténtalo de nuevo.");
        return;
      }
      if (activa.estado !== "ok") {
        toast.error("Tu sesión venció. Vuelve a entrar.");
        onNavegar();
        window.location.replace("/login");
        return;
      }
      const sesion = activa.sesion;
      const guardado = guardarCuenta(datosDeSesion(sesion, buscarCuenta(sesion.user.id)));
      if (guardado === "llena") {
        avisar("Gestiona tus cuentas en Configuración para agregar otra.");
        return;
      }
      if (guardado === "sin_almacenamiento") {
        avisar("No se pudo guardar tu cuenta actual. Inténtalo de nuevo.");
        return;
      }
      // El token de push es del telefono: si se queda en el perfil de la
      // cuenta actual, sus avisos aterrizan en la pantalla de la cuenta que
      // entre despues (mismo motivo que use-logout.ts y que el paso 4 del
      // cambio). Mejor esfuerzo y con tope; al cancelar, el aviso de /login
      // vuelve a pedir el registro (lib/push/registro.ts).
      await puerto.soltarTokenPush(sesion.user.id);
      marcarAgregandoCuenta();
      onNavegar();
      router.push(hrefAgregarCuenta("/login"));
    } finally {
      setOcupado(null);
    }
  }

  return (
    <BottomSheet open={open} onClose={cerrar} title="Cuentas" zIndex={60} className="pb-2">
      <ul className="-mx-4 -mt-2" aria-label="Cuentas en este teléfono">
        {activa && (
          <li>
            <button
              type="button"
              onClick={irAlPerfil}
              disabled={!!ocupado}
              aria-current="true"
              aria-label={`Cuenta activa: ${nombreVisible(activa)}. Ver perfil`}
              aria-describedby={idCorreo(activa)}
              className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
            >
              <UserAvatar src={activa.foto} name={nombreVisible(activa)} size="md" />
              <FilaTexto cuenta={activa} />
              <Check className="h-5 w-5 shrink-0 text-[color:var(--brand)]" aria-hidden="true" />
            </button>
          </li>
        )}
        {activaSinSitio && (
          <li className="px-4 py-3 text-xs text-muted-foreground">
            Tu cuenta actual no cabe en la lista (máximo {MAX_CUENTAS}). Gestiona las cuentas guardadas en Configuración.
          </li>
        )}
        {dormidas.map((cuenta) => {
          const nombre = nombreVisible(cuenta);
          const cambiando = ocupado?.tipo === "cambiar" && ocupado.userId === cuenta.userId;
          return (
            <li key={cuenta.userId} className="border-t border-border/15">
              <div className="flex items-stretch">
                <button
                  type="button"
                  onClick={() => void cambiar(cuenta)}
                  disabled={!!ocupado}
                  aria-label={`Cambiar a ${nombre}`}
                  aria-describedby={idCorreo(cuenta)}
                  className="flex min-h-14 flex-1 items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
                >
                  {cambiando ? (
                    <Loader2 className="h-10 w-10 shrink-0 animate-spin p-2 text-[color:var(--brand)]" aria-hidden="true" />
                  ) : (
                    <UserAvatar src={cuenta.foto} name={nombre} size="md" />
                  )}
                  <FilaTexto cuenta={cuenta} />
                </button>
              </div>
            </li>
          );
        })}
        <li className="border-t border-border/15">
          <button
            type="button"
            onClick={() => void agregar()}
            disabled={!!ocupado}
            aria-label="Agregar cuenta"
            className="flex min-h-14 w-full items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-muted disabled:opacity-60"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-tint)] text-[color:var(--brand)]">
              {ocupado?.tipo === "agregar" ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Plus className="h-5 w-5" aria-hidden="true" />}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-display text-sm font-semibold text-foreground">Agregar cuenta</span>
              <span className="block truncate text-xs text-muted-foreground">
                {llena ? `Máximo ${MAX_CUENTAS} cuentas por teléfono` : "La actual sigue guardada en este teléfono"}
              </span>
            </span>
          </button>
        </li>
      </ul>
      {llena && (
        <Link href="/configuracion#cuentas-guardadas" prefetch={false} onClick={onNavegar}
          className="mt-3 inline-flex min-h-12 items-center text-sm font-semibold text-[color:var(--brand)] underline underline-offset-4">
          Gestionar cuentas en Configuración
        </Link>
      )}
      {error && (
        <p role="alert" className="mt-3 rounded-xl bg-[rgba(255,59,48,0.08)] p-3 text-sm text-[color:var(--danger)] shadow-[inset_0_0_0_1px_rgba(255,59,48,0.25)]">
          {error}
        </p>
      )}
    </BottomSheet>
  );
}

/** El id del correo de cada fila: las filas lo enlazan con aria-describedby. */
function idCorreo(cuenta: Cuenta): string {
  return `cuenta-correo-${cuenta.userId}`;
}

function FilaTexto({ cuenta, className }: { cuenta: Cuenta; className?: string }) {
  return (
    <span className={cn("min-w-0 flex-1", className)}>
      <span className="block truncate font-display text-sm font-semibold text-foreground">{nombreVisible(cuenta)}</span>
      {/* El correo va siempre: en un telefono compartido es como alguien sabe
          que una cuenta no es suya y hay que quitarla. Con id para que tambien
          lo oiga quien usa lector de pantalla (el aria-label de la fila lo
          taparia). */}
      <span id={idCorreo(cuenta)} className="block truncate text-xs text-muted-foreground">
        {cuenta.username ? `@${cuenta.username} · ` : ""}
        {cuenta.email}
      </span>
    </span>
  );
}
