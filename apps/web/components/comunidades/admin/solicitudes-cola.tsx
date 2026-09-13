"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Check, X, Loader2, Inbox } from "lucide-react";
import { formatRelativeTime } from "@vicino/shared";
import { useInfiniteCursor } from "@/hooks/use-infinite-cursor";
import { UserAvatar } from "@/components/ui/user-avatar";
import { cargarSolicitudes, resolverSolicitud } from "@/app/(marketplace)/comunidades/actions";
import type { SolicitudEnCola, CursorComunidad } from "@/lib/comunidades/tipos";

const PAGINA = 30;

interface Props {
  communityId: string;
  iniciales: SolicitudEnCola[];
  cursor: CursorComunidad | null;
  error?: string;
}

/**
 * Cola de solicitudes de una comunidad privada. La ven owner y moderadores
 * (decision 5). Aceptar o rechazar quita la fila al instante; si la base
 * dice que no (23514 porque quien pide ya esta en 20 comunidades, 42501
 * por bloqueo), la fila vuelve y el motivo sale en un toast.
 */
export function SolicitudesCola({ communityId, iniciales, cursor, error: errorInicial }: Props) {
  const [enCurso, setEnCurso] = useState<string | null>(null);
  const { items, isLoading, hasMore, error, loadMore, removeItem, setItems } = useInfiniteCursor<
    SolicitudEnCola,
    CursorComunidad
  >({
    action: ({ cursor: c, limit }) => cargarSolicitudes({ community_id: communityId, cursor: c, limit }),
    initialItems: iniciales,
    initialCursor: cursor,
    limit: PAGINA,
  });

  async function resolver(s: SolicitudEnCola, aceptar: boolean) {
    if (enCurso) return;
    setEnCurso(s.id);
    const indice = items.findIndex((x) => x.id === s.id);
    removeItem((x) => x.id === s.id);
    const r = await resolverSolicitud({ request_id: s.id, aceptar, community_id: communityId });
    setEnCurso(null);
    if ("error" in r) {
      // Vuelve a su sitio: el orden de la cola es por fecha y se respeta.
      setItems((prev) => {
        const copia = [...prev];
        copia.splice(Math.min(indice, copia.length), 0, s);
        return copia;
      });
      toast.error(r.error);
      return;
    }
    toast.success(aceptar ? `${s.user_nombre} ya es parte de la comunidad` : "Solicitud rechazada");
  }

  if (errorInicial) {
    return <p className="py-6 text-center text-sm text-[color:var(--fg-muted)]">{errorInicial}</p>;
  }

  return (
    <div className="space-y-2">
      {items.length === 0 && !isLoading && (
        <div className="py-8 text-center">
          <div className="mx-auto mb-2 inline-flex h-12 w-12 items-center justify-center rounded-2xl bg-[color:var(--card-2)]">
            <Inbox className="h-6 w-6 text-[color:var(--fg-muted)]" />
          </div>
          <p className="text-sm text-[color:var(--fg-muted)]">No hay solicitudes pendientes.</p>
        </div>
      )}
      <ul className="divide-y divide-[color:var(--border)]/15 overflow-hidden rounded-2xl bg-[color:var(--sidebar-bg)]">
        {items.map((s) => (
          <li key={s.id} className="flex items-start gap-3 p-4">
            <Link href={`/vendedor/${s.user_id}`} className="shrink-0">
              <UserAvatar src={s.user_foto} name={s.user_nombre} size="md" />
            </Link>
            <div className="min-w-0 flex-1">
              <Link href={`/vendedor/${s.user_id}`} className="block truncate text-sm font-semibold text-[color:var(--fg)]">
                {s.user_nombre}
              </Link>
              <p className="text-[11px] text-[color:var(--fg-dim)]">{formatRelativeTime(s.created_at)}</p>
              {s.mensaje && (
                <p className="mt-1 whitespace-pre-wrap break-words text-[13px] leading-relaxed text-[color:var(--fg-muted)]">
                  {s.mensaje}
                </p>
              )}
            </div>
            <div className="flex shrink-0 gap-1.5">
              <button
                type="button"
                onClick={() => void resolver(s, false)}
                disabled={enCurso !== null}
                aria-label={`Rechazar a ${s.user_nombre}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--card)] text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:text-[color:var(--danger)] disabled:opacity-50"
              >
                {enCurso === s.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
              </button>
              <button
                type="button"
                onClick={() => void resolver(s, true)}
                disabled={enCurso !== null}
                aria-label={`Aceptar a ${s.user_nombre}`}
                className="flex h-9 w-9 items-center justify-center rounded-full bg-[color:var(--brand)] text-white transition-colors hover:bg-[color:var(--brand-dark)] disabled:opacity-50"
              >
                <Check className="h-4 w-4" />
              </button>
            </div>
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          type="button"
          onClick={() => void loadMore()}
          disabled={isLoading}
          className="mx-auto flex h-9 items-center gap-2 rounded-full bg-[color:var(--card-2)] px-4 text-[13px] font-semibold text-[color:var(--fg)] shadow-[inset_0_0_0_1px_var(--border)] disabled:opacity-60"
        >
          {isLoading && <Loader2 className="h-4 w-4 animate-spin" />}
          Cargar más
        </button>
      )}
      {error && <p className="text-center text-xs text-[color:var(--fg-muted)]">{error}</p>}
    </div>
  );
}
