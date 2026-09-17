"use client";

import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import {
  BellRing,
  Loader2,
  Megaphone,
  MessageCircle,
  ShieldAlert,
  ShoppingBag,
  Smartphone,
  Users,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  leerPermisoPush,
  pedirPermisoPush,
  type EstadoPermisoPush,
} from "@/hooks/usePushNotifications";
import type { ClaveNotificacion } from "@/lib/notificaciones/claves";
import { guardarPreferenciaNotificacion } from "./actions";

/**
 * El catalogo visual: como se cuenta cada tipo. QUE tipos existen lo decide
 * @/lib/notificaciones/claves, que es la misma lista que valida actions.ts.
 *
 * `clave` esta tipada con ClaveNotificacion y no con `string`, y eso es el
 * arreglo: antes esta lista y la del servidor eran dos colecciones de cadenas
 * independientes, asi que una errata ("ventass") compilaba limpio y el
 * interruptor solo fallaba al tocarlo. Ahora no compila.
 */
interface TipoNotificacion {
  readonly clave: ClaveNotificacion;
  readonly titulo: string;
  readonly descripcion: string;
  readonly Icono: LucideIcon;
  /**
   * Hoy este tipo no tiene quien mande push: nada en el servidor lo empuja al
   * telefono, solo entra en la campana de la app.
   *
   * Se dice en pantalla en vez de esconder el interruptor porque la preferencia
   * SI se guarda y valdra el dia que exista el productor (DECISION 1 de la
   * migracion 20260916180000: anadir el emisor no cuesta migracion). Quitar el
   * interruptor obligaria a volver a pedirle a todo el mundo lo que ya eligio.
   */
  readonly soloCampana?: boolean;
}

const TIPOS: readonly TipoNotificacion[] = [
  {
    clave: "chat",
    titulo: "Mensajes de chat",
    descripcion:
      "Cuando alguien te escribe por una publicación tuya o por una que te interesa.",
    Icono: MessageCircle,
  },
  {
    clave: "ventas",
    titulo: "Ventas y citas",
    descripcion:
      "Confirmaciones de venta y citas que te agendan.",
    Icono: ShoppingBag,
  },
  {
    // Nada empuja esto al telefono todavia: no hay trigger de push sobre
    // notifications, que es donde escriben las comunidades
    // (docs/AUDITORIA-push-2026-09-16.md, seccion 3).
    clave: "comunidades",
    titulo: "Comunidades",
    descripcion:
      "Solicitudes para entrar, respuestas a la tuya y comentarios en tus publicaciones.",
    Icono: Users,
    soloCampana: true,
  },
  {
    clave: "novedades",
    titulo: "Novedades de VICINO",
    descripcion: "Avisos de la app y funciones nuevas. Nunca publicidad de terceros.",
    Icono: Megaphone,
    soloCampana: true,
  },
];

interface PreferenciasFormProps {
  /**
   * Lo guardado tal cual. Una clave ausente significa ENCENDIDO, igual que en
   * la base: asi un tipo nuevo nace encendido para todo el mundo y los perfiles
   * antiguos no necesitan relleno.
   */
  preferenciasIniciales: Record<string, boolean>;
}

export function PreferenciasForm({ preferenciasIniciales }: PreferenciasFormProps) {
  const [preferencias, setPreferencias] =
    useState<Record<string, boolean>>(preferenciasIniciales);
  // Que claves tienen un guardado en curso. Un arreglo y no una sola clave:
  // con dos interruptores tocados seguidos, el primero que respondia apagaba el
  // spinner del segundo y parecia guardado cuando aun no lo estaba.
  const [enVuelo, setEnVuelo] = useState<readonly string[]>([]);
  const [permiso, setPermiso] = useState<EstadoPermisoPush | null>(null);
  const [pidiendoPermiso, setPidiendoPermiso] = useState(false);
  // Cuantas veces se ha intentado guardar CADA clave. Solo la ultima cuenta.
  //
  // Sin esto, dos guardados en vuelo de la misma clave se pisaban en las dos
  // direcciones: `enVuelo` deduplica por clave, asi que el primero que
  // respondia borraba la marca de los dos y apagaba un spinner que seguia
  // esperando; y el revert lo aplicaba el que FALLABA de ultimo, aunque otro
  // posterior ya hubiera guardado lo contrario. El escenario concreto: tocar
  // chat (A), volver a tocar chat (B) y pulsar "Reintentar" del aviso viejo de
  // A (C). B guardaba false, C fallaba y la pantalla volvia a true, con la base
  // en false y sin nada que las volviera a juntar — la prop nueva del servidor
  // no se lee sin remonte.
  //
  // Va en un ref y no en estado porque no se pinta: cambiarlo no tiene que
  // provocar un render, y el valor tiene que ser el vigente en el instante en
  // que vuelve cada respuesta, no el del render que la lanzo.
  const generaciones = useRef<Readonly<Record<string, number>>>({});
  // El aviso de fallo que hay en pantalla por cada clave, para poder retirarlo.
  //
  // Se guarda el id que devuelve sonner y NO se reutiliza un id fijo por clave:
  // crear un aviso con el mismo id que se acaba de retirar cae dentro de la
  // animacion de salida del anterior, y el aviso nuevo puede no llegar a verse.
  const avisos = useRef<Readonly<Record<string, string | number>>>({});

  useEffect(() => {
    let vivo = true;
    void leerPermisoPush().then((estado) => {
      // Sin este guard, una respuesta que llega despues de salir de la pantalla
      // escribe estado en un componente desmontado.
      if (vivo) setPermiso(estado);
    });
    return () => {
      vivo = false;
    };
  }, []);

  /**
   * Guardado optimista: el interruptor se mueve ya y la escritura va detras.
   * Si falla, vuelve a su sitio y el aviso ofrece reintentar el MISMO cambio
   * (por eso `deseado` viaja como argumento en vez de recalcularse: recalcular
   * desde el estado, que ya volvio atras, reintentaria el cambio contrario).
   */
  async function aplicar(clave: ClaveNotificacion, deseado: boolean) {
    // Esta llamada pasa a ser la vigente para esta clave. Las que estuvieran en
    // vuelo quedan caducadas: cuando vuelvan no tocan ni la pantalla ni la
    // marca de "guardando", porque lo que la base acabara teniendo es lo que
    // decida ESTA.
    const generacion = (generaciones.current[clave] ?? 0) + 1;
    generaciones.current = { ...generaciones.current, [clave]: generacion };
    // Y el aviso del intento anterior se retira, que es lo que cierra la puerta
    // por la que se entraba a la divergencia: mientras ese aviso siga en
    // pantalla, su boton "Reintentar" puede lanzar una segunda escritura de la
    // MISMA clave con el valor viejo, y entonces cual de las dos gana en la base
    // depende de cual llegue ultima al servidor — algo que la pantalla no puede
    // saber ni corregir. El contador de generaciones de arriba arregla lo que se
    // pinta; esto evita la segunda escritura.
    const avisoPrevio = avisos.current[clave];
    if (avisoPrevio !== undefined) toast.dismiss(avisoPrevio);

    setPreferencias((previas) => ({ ...previas, [clave]: deseado }));
    setEnVuelo((previas) => (previas.includes(clave) ? previas : [...previas, clave]));

    const resultado = await guardarPreferenciaNotificacion(clave, deseado);

    // Ya hay otra llamada mas nueva para esta clave: ella manda. Ni se apaga su
    // spinner, ni se revierte la pantalla a un valor que nadie pidio, ni se
    // ofrece reintentar algo que ya esta superado. El fallo, si lo hubo, ya
    // viajo a Sentry desde la accion.
    if (generaciones.current[clave] !== generacion) return;

    setEnVuelo((previas) => previas.filter((c) => c !== clave));
    if (!resultado.error) return;

    // Se revierte SOLO esta clave, no el objeto entero: restaurar la foto
    // completa borraria lo que otro interruptor haya guardado mientras tanto.
    setPreferencias((previas) => ({ ...previas, [clave]: !deseado }));
    const idAviso = toast.error(resultado.error, {
      action: {
        label: "Reintentar",
        onClick: () => {
          void aplicar(clave, deseado);
        },
      },
    });
    avisos.current = { ...avisos.current, [clave]: idAviso };
  }

  async function activarEnElSistema() {
    setPidiendoPermiso(true);
    const estado = await pedirPermisoPush();
    setPidiendoPermiso(false);
    setPermiso(estado);

    if (estado === "concedido") {
      toast.success("Listo, ya puedes recibir notificaciones.");
      return;
    }
    if (estado === "denegado") {
      toast.error("Tu teléfono las dejó bloqueadas. Puedes cambiarlo en Ajustes.");
      return;
    }
    if (estado === "error") {
      toast.error("No pudimos pedir el permiso. Inténtalo de nuevo.");
    }
  }

  return (
    // `data-preferencias-listas` se pone cuando el permiso del sistema ya se
    // leyo, o sea cuando este componente esta hidratado y sus interruptores
    // responden de verdad. Existe porque sin el no hay forma de esperar a la
    // hidratacion: el marcado del servidor ya trae los cuatro botones, asi que
    // un toque que llegue antes de que React se enganche se pierde en silencio
    // y la prueba lee el valor viejo sin que nada falle. Es el unico atributo
    // de este archivo que no pinta nada.
    <div className="space-y-6" data-preferencias-listas={permiso !== null ? "true" : undefined}>
      <AvisoDePermiso
        permiso={permiso}
        pidiendo={pidiendoPermiso}
        onActivar={() => {
          void activarEnElSistema();
        }}
      />

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--fg-dim)]">
          Qué quieres recibir
        </h2>
        <div className="space-y-2">
          {TIPOS.map(({ clave, titulo, descripcion, Icono, soloCampana }) => {
            // Ausente = encendido. Es la misma regla que aplica el push del
            // servidor, y tenerla escrita de dos formas distintas seria la
            // manera de que la pantalla y el telefono discrepen.
            const activa = preferencias[clave] !== false;
            const guardando = enVuelo.includes(clave);
            return (
              <button
                key={clave}
                type="button"
                role="switch"
                aria-checked={activa}
                disabled={guardando}
                onClick={() => {
                  void aplicar(clave, !activa);
                }}
                className="flex w-full items-center gap-3 rounded-2xl bg-[color:var(--sidebar-bg)] px-4 py-3 text-left transition-shadow shadow-[inset_0_0_0_1px_var(--border)] hover:shadow-[inset_0_0_0_1px_var(--brand-hi)] disabled:opacity-70"
              >
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)]">
                  {guardando ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icono className="h-4 w-4" />
                  )}
                </span>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="font-heading text-sm font-semibold text-[color:var(--fg)]">
                    {titulo}
                  </span>
                  <span className="text-xs text-[color:var(--fg-muted)]">
                    {descripcion}
                  </span>
                  {soloCampana && (
                    <span className="mt-1 text-xs text-[color:var(--fg-dim)]">
                      Por ahora esto solo aparece en la campana de la app, no
                      suena en el teléfono. Guardamos tu elección para cuando
                      empiece a sonar.
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "relative h-6 w-11 shrink-0 rounded-full transition-colors",
                    activa
                      ? "bg-[color:var(--brand)]"
                      : "bg-[color:var(--fg-dim)]/40",
                  )}
                >
                  <span
                    className={cn(
                      "absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform",
                      activa ? "translate-x-5" : "translate-x-0.5",
                    )}
                  />
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* LO QUE DICE ESTE PARRAFO TIENE QUE SER VERDAD HOY.
          El texto anterior ("lo que se apaga es que suene el teléfono") prometia
          un control que el servidor no ejercia: send-push no consultaba la
          preferencia de nadie. Ya lo hace, pero solo para lo que de verdad
          manda push — mensajes de chat, confirmaciones de venta y citas. Los
          otros dos tipos no tienen quien los empuje al telefono todavia
          (docs/AUDITORIA-push-2026-09-16.md, seccion 3), y eso se dice en cada
          uno de sus interruptores en vez de insinuar lo contrario aqui.

          Y no dice "sigue en la campana" a secas, que tambien era falso: un
          mensaje de chat NO deja fila en notifications (su trigger se borro en
          20260511000001 y la campana filtra .neq("tipo","message")), asi que lo
          que espera es el chat, no la campana. */}
      <p className="px-1 text-xs text-[color:var(--fg-muted)]">
        Mensajes, ventas y citas son los avisos que suenan en tu teléfono. Si
        los apagas, el teléfono se queda callado y nada más: los mensajes te
        siguen esperando en tu chat, y las ventas y citas en la campana de la
        app. Apagar un aviso no cancela ni borra nada.
      </p>
    </div>
  );
}

interface AvisoDePermisoProps {
  permiso: EstadoPermisoPush | null;
  pidiendo: boolean;
  onActivar: () => void;
}

/**
 * El aviso honesto sobre el permiso del sistema.
 *
 * Es la mitad que faltaba: estos interruptores no pueden nada contra el
 * permiso del sistema operativo. Si el telefono tiene VICINO bloqueado, un
 * interruptor encendido no hace sonar nada; y apagarlo tampoco cambia nada,
 * porque ya estaba todo apagado por fuera. Sin decirlo, la pantalla promete
 * un control que no tiene.
 */
function AvisoDePermiso({ permiso, pidiendo, onActivar }: AvisoDePermisoProps) {
  // Mientras no se sabe, no se pinta nada: un aviso que aparece y desaparece
  // al medio segundo se lee como un error de la app.
  if (permiso === null || permiso === "concedido") return null;

  if (permiso === "denegado") {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-[rgba(255,59,48,0.08)] p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--danger)]" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-[color:var(--danger)]">
            Tu teléfono tiene bloqueadas las notificaciones de VICINO
          </p>
          <p className="text-[color:var(--fg-muted)]">
            Mientras siga así, lo que elijas aquí no cambia nada: no va a sonar
            ni aparecer en tu pantalla de bloqueo, aunque esté encendido. Se
            activa en Ajustes del teléfono, en la ficha de VICINO.
          </p>
        </div>
      </div>
    );
  }

  if (permiso === "no-nativo") {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-[color:var(--bg-elev-2)] p-4">
        <Smartphone className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--fg-dim)]" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-[color:var(--fg)]">
            Aquí puedes elegir, pero el aviso llega en la app
          </p>
          {/* "Se respeta en todos lados" era falso: lo unico que lee estas
              preferencias es el push. La campana de la app las ignora — pinta
              todo lo que entra en notifications. */}
          <p className="text-[color:var(--fg-muted)]">
            Lo que elijas aquí se guarda en tu cuenta y decide qué te suena en
            el teléfono. Eso solo ocurre en la app de VICINO para Android y
            iPhone; aquí, en el navegador, los avisos te esperan en la campana.
          </p>
        </div>
      </div>
    );
  }

  if (permiso === "error") {
    return (
      <div className="flex items-start gap-3 rounded-2xl bg-[color:var(--bg-elev-2)] p-4">
        <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--fg-dim)]" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-[color:var(--fg)]">
            No pudimos comprobar el permiso de tu teléfono
          </p>
          <p className="text-[color:var(--fg-muted)]">
            Tus preferencias se guardan igual. Si no te llega nada, revisa la
            ficha de VICINO en Ajustes.
          </p>
        </div>
      </div>
    );
  }

  // "sin-pedir": todavia se puede preguntar, y este es el unico sitio donde
  // tiene sentido hacerlo — hay un boton y una frase que lo explica.
  return (
    <div className="space-y-3 rounded-2xl bg-[color:var(--brand-tint)] p-4">
      <div className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--brand-hi)]" />
        <div className="space-y-1 text-sm">
          <p className="font-semibold text-[color:var(--fg)]">
            Falta el permiso de tu teléfono
          </p>
          <p className="text-[color:var(--fg-muted)]">
            Sin él, ninguno de estos avisos puede llegarte. Enciéndelo una vez y
            luego eliges aquí qué quieres recibir.
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={onActivar}
        disabled={pidiendo}
        className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--brand)] py-3 text-sm font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
      >
        {pidiendo && <Loader2 className="h-4 w-4 animate-spin" />}
        Activar notificaciones
      </button>
    </div>
  );
}
