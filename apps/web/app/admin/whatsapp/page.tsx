import { notFound } from "next/navigation";
import { cleanDisplayName, formatDate, publicProfileName } from "@vicino/shared";

import { requireAdminPage } from "@/lib/auth/require-admin-page";
import { BANDEJA_WHATSAPP_ACTIVA } from "@/lib/whatsapp/bandera";
import { AccionesCanal, ConectarCanalForm } from "./conectar-form";

export const metadata = { title: "WhatsApp" };

export default async function AdminWhatsAppPage() {
  if (!BANDEJA_WHATSAPP_ACTIVA) notFound();
  const { supabase } = await requireAdminPage();

  // La RLS deja al admin ver los canales (no las conversaciones ni los mensajes).
  const { data: canales, error } = await supabase
    .from("canales_whatsapp")
    .select(
      "id, phone_number_id, waba_id, numero_mostrado, estado, created_at, negocio:profiles!canales_whatsapp_negocio_id_fkey(nombre, nombre_negocio, username, es_vendedor, seller_type)",
    )
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-4 flex flex-col flex-1 h-full">
      <h1 className="text-xl font-bold">WhatsApp</h1>
      <p className="text-sm text-[color:var(--fg-muted)]">
        Qué número de WhatsApp Business (Cloud API) está conectado a qué negocio. Los mensajes solo los
        ve el negocio dueño del número; aquí no se leen. Pausar impide responder (lo que llegue se sigue
        guardando); desconectar borra el número con sus conversaciones.
      </p>

      <ConectarCanalForm />

      {error ? <p className="text-sm text-[color:var(--danger)]">No se pudieron cargar los números.</p> : null}

      <div className="space-y-2">
        {canales?.map((c) => {
          const negocio = Array.isArray(c.negocio) ? c.negocio[0] : c.negocio;
          return (
            <div key={c.id} className="rounded-lg border p-4 flex items-center gap-4 w-full">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-medium text-sm truncate">{cleanDisplayName(publicProfileName(negocio, "Negocio"))}</span>
                  {negocio?.username ? <span className="text-xs text-[color:var(--fg-dim)]">@{negocio.username}</span> : null}
                  <span
                    className={
                      c.estado === "activo"
                        ? "text-xs bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full"
                        : "text-xs bg-amber-50 dark:bg-amber-950/50 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full"
                    }
                  >
                    {c.estado}
                  </span>
                </div>
                <p className="text-xs text-[color:var(--fg-muted)] truncate">
                  {c.numero_mostrado ? `${c.numero_mostrado} · ` : ""}Phone number ID {c.phone_number_id} · WABA {c.waba_id} · conectado el{" "}
                  {formatDate(c.created_at)}
                </p>
              </div>
              <AccionesCanal canalId={c.id} activo={c.estado === "activo"} etiqueta={c.numero_mostrado ?? `el número ${c.phone_number_id}`} />
            </div>
          );
        })}
        {canales && canales.length === 0 ? (
          <p className="text-sm text-[color:var(--fg-muted)]">Todavía no hay números conectados.</p>
        ) : null}
      </div>
    </div>
  );
}
