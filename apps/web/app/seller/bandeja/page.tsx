import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { cleanDisplayName, formatRelativeTime } from "@vicino/shared";

import { createClient } from "@/lib/supabase/server";
import { BANDEJA_WHATSAPP_ACTIVA } from "@/lib/whatsapp/bandera";
import { etiquetaUltimoMensaje, numeroLegible } from "@/lib/whatsapp/presentacion";
import { duracionCorta, ventanaWhatsApp } from "@/lib/whatsapp/ventana";
import { RefrescoBandeja } from "./refresco-bandeja";

export const metadata = { title: "WhatsApp" };

/** Hora de la peticion, en una funcion aparte: Date.now() dentro del render dispara react-hooks/purity. */
function leerReloj(): number {
  return Date.now();
}

export default async function BandejaPage() {
  if (!BANDEJA_WHATSAPP_ACTIVA) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/seller/bandeja");

  const { data: canal } = await supabase
    .from("canales_whatsapp")
    .select("id, numero_mostrado, estado")
    .eq("negocio_id", user.id)
    .maybeSingle();

  if (!canal) {
    return (
      <div className="space-y-6 min-w-0">
        <h1 className="text-xl font-bold truncate">WhatsApp</h1>
        <div className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-6 space-y-3">
          <div className="flex items-center gap-3">
            <MessageCircle className="h-6 w-6 text-emerald-600" aria-hidden="true" />
            <p className="font-semibold">Tu número de WhatsApp aún no está conectado</p>
          </div>
          <p className="text-sm text-[color:var(--fg-muted)]">
            La bandeja de WhatsApp está en piloto: por ahora funciona con un número de prueba de Meta y
            un solo negocio, y todavía no se conectan números propios. Cuando se abra a más negocios, los
            mensajes que te escriban a tu número aparecerán aquí y podrás responderlos sin salir de VICINO.
          </p>
          <p className="text-sm text-[color:var(--fg-muted)]">
            Mientras tanto, el botón de WhatsApp de tu ficha sigue llevando a los clientes a tu chat de
            WhatsApp de siempre. Lo configuras en{" "}
            <Link href="/perfil/editar" className="underline underline-offset-2">
              editar perfil
            </Link>
            .
          </p>
        </div>
      </div>
    );
  }

  const { data: conversaciones, error } = await supabase
    .from("conversaciones_whatsapp")
    .select("id, wa_id, nombre_perfil, ultimo_mensaje_texto, ultimo_mensaje_at, ultimo_entrante_at, no_leidos")
    .eq("negocio_id", user.id)
    .order("ultimo_mensaje_at", { ascending: false, nullsFirst: false })
    .limit(100);

  // Un solo "ahora" para toda la lista. Es un componente de servidor que se
  // ejecuta una vez por peticion, pero se lee fuera del arbol para que la
  // regla de pureza de React no lo tome por un render impuro.
  const ahora = leerReloj();

  return (
    <div className="space-y-6 min-w-0">
      <RefrescoBandeja negocioId={user.id} />
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <h1 className="text-xl font-bold truncate">WhatsApp</h1>
        <p className="text-xs text-[color:var(--fg-muted)]">
          Número conectado{canal.numero_mostrado ? `: ${canal.numero_mostrado}` : ""}
          {canal.estado !== "activo" ? " · pausado" : ""}
        </p>
      </div>

      {canal.estado !== "activo" ? (
        <p className="rounded-[var(--r-xl)] border border-amber-300/60 bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-100">
          Tu número está pausado: los mensajes que te lleguen se siguen guardando aquí, pero no puedes
          responder hasta que el equipo de VICINO lo reactive.
        </p>
      ) : null}

      {error ? (
        <p className="text-sm text-[color:var(--danger)]">No se pudieron cargar las conversaciones. Intenta de nuevo.</p>
      ) : null}

      {conversaciones && conversaciones.length > 0 ? (
        <ul className="space-y-2" aria-label="Conversaciones de WhatsApp">
          {conversaciones.map((c) => {
            const ventana = ventanaWhatsApp(c.ultimo_entrante_at, ahora);
            const nombre = c.nombre_perfil ? cleanDisplayName(c.nombre_perfil) : numeroLegible(c.wa_id);
            return (
              <li key={c.id}>
                <Link
                  href={`/seller/bandeja/${c.id}`}
                  className="flex items-center justify-between gap-3 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 hover:opacity-90 transition-opacity min-w-0"
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-medium text-sm truncate">{nombre}</span>
                      {c.nombre_perfil ? (
                        <span className="text-xs text-[color:var(--fg-dim)] truncate">{numeroLegible(c.wa_id)}</span>
                      ) : null}
                    </div>
                    <p className="text-sm text-[color:var(--fg-muted)] truncate">
                      {etiquetaUltimoMensaje(c.ultimo_mensaje_texto)}
                    </p>
                    <p className="text-xs text-[color:var(--fg-dim)]">
                      {ventana.abierta
                        ? `Puedes responder ${duracionCorta(ventana.restanteMs)} más`
                        : "Ventana de 24 h cerrada: espera a que te escriba"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {c.ultimo_mensaje_at ? (
                      <span className="text-xs text-[color:var(--fg-dim)]">{formatRelativeTime(c.ultimo_mensaje_at)}</span>
                    ) : null}
                    {c.no_leidos > 0 ? (
                      <span
                        className="inline-flex min-w-6 items-center justify-center rounded-[var(--r-pill)] bg-emerald-600 px-1.5 py-0.5 text-[11px] font-semibold text-white"
                        aria-label={`${c.no_leidos} sin leer`}
                      >
                        {c.no_leidos > 99 ? "99+" : c.no_leidos}
                      </span>
                    ) : null}
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : !error ? (
        <div className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-6 text-sm text-[color:var(--fg-muted)]">
          Todavía nadie te ha escrito a este número. Cuando alguien te mande un WhatsApp, la
          conversación aparecerá aquí al instante.
        </div>
      ) : null}
    </div>
  );
}
