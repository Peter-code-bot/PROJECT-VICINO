"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { BellRing, CheckCircle2, Loader2, MessageCircle, ShoppingBag } from "lucide-react";
import {
  leerPermisoPush,
  pedirPermisoPush,
  type EstadoPermisoPush,
} from "@/hooks/usePushNotifications";
import { conTope, esTope } from "@/lib/auth/con-tope";
import * as Sentry from "@sentry/nextjs";

interface PedirPermisoProps {
  /** Ya validado contra la lista cerrada de la pagina. */
  siguiente: string;
}

/**
 * SOLO lo que de verdad hace sonar el telefono hoy.
 *
 * Aqui habia "Te responden la solicitud para entrar a una comunidad", y eso no
 * llega al telefono: nada empuja las notificaciones de comunidades, solo entran
 * en la campana de la app (docs/AUDITORIA-push-2026-09-16.md, seccion 3).
 * Pedir un permiso del sistema prometiendo un aviso que no existe es la forma
 * mas rapida de que la primera notificacion decepcione y se apague todo —y en
 * iOS apagarlo no tiene vuelta desde la app.
 */
const MOTIVOS = [
  {
    Icono: MessageCircle,
    texto: "Alguien te escribe porque quiere comprarte, y lo sabes al momento.",
  },
  {
    Icono: ShoppingBag,
    texto: "Te agendan una cita o te confirman una venta.",
  },
  {
    Icono: BellRing,
    texto: "Y nada más: lo que no corre prisa te espera en la campana de la app.",
  },
] as const;

/**
 * Cuanto se espera al dialogo del sistema antes de dar el paso por perdido.
 *
 * Es mucho mas que el TOPE_ACCION_MS de una accion de servidor (20 s) porque lo
 * que se espera aqui NO es una respuesta de la red: es una persona leyendo un
 * dialogo del sistema. Echarla de la pantalla a los veinte segundos mientras
 * decide seria peor que el fallo que esto arregla.
 *
 * Y tiene que haber un tope, porque el fallo que arregla es real en este repo:
 * una promesa de un plugin de Capacitor que no resuelve nunca deja el paso sin
 * salida (el splash infinito, y los plugins que son thenables y dejan la
 * promesa pendiente para siempre). En iOS no hay gesto atras del sistema, asi
 * que "sin salida" significa cerrar la app.
 */
const TOPE_PERMISO_MS = 60_000;

/**
 * El permiso se pide AQUI y no al arrancar la app.
 *
 * El por que va antes del dialogo del sistema, igual que en el paso de
 * ubicacion: un permiso que aparece sin explicacion se niega, y en iOS negarlo
 * es definitivo — el sistema no vuelve a preguntar y la unica vuelta es
 * Ajustes. El arranque silencioso que hacia usePushNotifications no ganaba
 * permisos: los quemaba.
 *
 * Y "En otro momento" no bloquea nada. Este paso es el unico del alta que no es
 * obligatorio: sin ubicacion el inicio sale vacio, pero sin push la app
 * funciona entera, y cobrar el permiso como peaje es la forma mas rapida de que
 * te lo nieguen para siempre.
 */
export function PedirPermiso({ siguiente }: PedirPermisoProps) {
  const router = useRouter();
  const [permiso, setPermiso] = useState<EstadoPermisoPush | null>(null);
  const [pidiendo, setPidiendo] = useState(false);
  const [saliendo, setSaliendo] = useState(false);

  useEffect(() => {
    let vivo = true;
    void leerPermisoPush().then((estado) => {
      if (vivo) setPermiso(estado);
    });
    return () => {
      vivo = false;
    };
  }, []);

  function continuar() {
    // `replace` y no `push`: este paso no se repite, y dejarlo en el historial
    // hace que el gesto de volver del telefono devuelva a una pantalla de
    // permiso ya resuelta en mitad del alta.
    setSaliendo(true);
    router.replace(siguiente);
  }

  async function activar() {
    setPidiendo(true);
    // El tope es la salida de emergencia. `ocupado` apaga los DOS botones
    // mientras se pide el permiso, asi que si requestPermissions() no resuelve
    // nunca —el fallo que ya se vio con el splash y con los plugins thenables—
    // el alta se queda encallada en una pantalla sin un solo boton vivo y sin
    // gesto atras en iOS. Vencer el plazo se trata como error, y el error
    // AVANZA igual: este paso no es obligatorio y nada de lo que sigue depende
    // de el.
    //
    // pedirPermisoPush() ya atrapa sus propias excepciones y devuelve "error",
    // asi que lo unico que puede rechazar esta promesa es el tope.
    let estado: EstadoPermisoPush;
    try {
      estado = await conTope(pedirPermisoPush(), TOPE_PERMISO_MS);
    } catch (err) {
      // El plazo vencido NO se reporta: es la salida prevista, y el puente
      // nativo que no responde ya se ve en el propio Sentry de
      // pedirPermisoPush. Lo que si hay que saber es si por aqui escapo otra
      // cosa, porque hoy no deberia poder pasar y manana puede.
      if (!esTope(err)) {
        Sentry.captureException(err, {
          tags: { pantalla: "activar-notificaciones", accion: "pedirPermiso" },
        });
      }
      estado = "error";
    }
    setPidiendo(false);
    setPermiso(estado);
    // Se avanza pase lo que pase. Quedarse aqui tras un "No permitir" deja a la
    // persona encerrada en una pantalla cuyo unico boton ya no puede hacer
    // nada: el sistema no vuelve a preguntar.
    continuar();
  }

  // En el navegador no hay tuberia de push, y quien ya lo concedio no tiene
  // nada que conceder: en los dos casos el boton solo avanza, sin prometer un
  // dialogo que no va a salir.
  const soloAvanzar =
    permiso === "concedido" || permiso === "no-nativo" || permiso === "denegado";

  // Los botones NO se apagan mientras el permiso esta sin leer, y eso es
  // deliberado: leerlo es una llamada al puente nativo, y si ese puente no
  // responde nunca, un boton apagado a la espera deja el alta encallada en una
  // pantalla sin salida. Con el permiso aun desconocido, el principal pide —
  // que es lo correcto en todos los casos menos uno: si ya estaba concedido, el
  // sistema devuelve concedido sin ensenar ningun dialogo.
  //
  // `pidiendo` si apaga los dos botones, pero ya no puede quedarse encendido
  // para siempre: la peticion va con tope y el vencimiento avanza (ver
  // activar()). Queda `saliendo`, que se apaga solo cuando la navegacion
  // termina — si el destino no llega a cargar, esta pantalla vuelve a quedarse
  // sin botones. Eso es la navegacion de Next, no este paso.
  const ocupado = pidiendo || saliendo;

  return (
    <div className="w-full max-w-md px-6 py-10">
      <div className="mb-8 flex items-center justify-center">
        <span className="flex h-16 w-16 items-center justify-center rounded-2xl bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]">
          {permiso === "concedido" ? (
            <CheckCircle2 className="h-7 w-7" />
          ) : (
            <BellRing className="h-7 w-7" />
          )}
        </span>
      </div>

      <h1 className="text-center font-heading text-2xl font-bold text-[color:var(--fg)]">
        {permiso === "concedido"
          ? "Ya tienes las notificaciones activadas"
          : "No te pierdas quien te busca"}
      </h1>
      <p className="mt-2 text-center text-sm text-[color:var(--fg-muted)]">
        {permiso === "concedido"
          ? "Te avisaremos de lo importante y nada más. Puedes elegir qué recibir en Configuración."
          : "En VICINO lo que se vende cerca se va rápido. Un aviso a tiempo es la diferencia entre cerrar el trato y llegar tarde."}
      </p>

      <ul className="mt-7 space-y-3">
        {MOTIVOS.map(({ Icono, texto }) => (
          <li key={texto} className="flex items-start gap-3">
            <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[color:var(--bg-elev-2)] text-[color:var(--fg)]">
              <Icono className="h-4 w-4" />
            </span>
            <span className="text-sm text-[color:var(--fg)]">{texto}</span>
          </li>
        ))}
      </ul>

      {permiso === "denegado" && (
        <p className="mt-6 rounded-xl bg-[rgba(255,59,48,0.08)] p-3 text-sm text-[color:var(--danger)]">
          Tu teléfono tiene bloqueadas las notificaciones de VICINO. Se activan
          en Ajustes, en la ficha de VICINO, cuando quieras.
        </p>
      )}

      {permiso === "no-nativo" && (
        <p className="mt-6 text-center text-xs text-[color:var(--fg-muted)]">
          Los avisos al momento llegan en la app de VICINO para Android y
          iPhone.
        </p>
      )}

      <div className="mt-8 space-y-3">
        <button
          type="button"
          onClick={() => {
            if (soloAvanzar) {
              continuar();
              return;
            }
            void activar();
          }}
          disabled={ocupado}
          className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
        >
          {ocupado && <Loader2 className="h-4 w-4 animate-spin" />}
          {soloAvanzar ? "Continuar" : "Activar notificaciones"}
        </button>

        {!soloAvanzar && (
          <button
            type="button"
            onClick={continuar}
            disabled={ocupado}
            className="w-full rounded-2xl py-3 text-sm font-medium text-[color:var(--fg-muted)] hover:text-[color:var(--fg)] disabled:opacity-40"
          >
            En otro momento
          </button>
        )}
      </div>

      <p className="mt-6 text-center text-xs text-[color:var(--fg-muted)]">
        Sin publicidad de terceros. Puedes apagar cada tipo de aviso en
        Configuración.
      </p>
    </div>
  );
}
