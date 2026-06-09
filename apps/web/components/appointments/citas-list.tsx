"use client";

import { useState, useMemo } from "react";
import { UserAvatar } from "@/components/ui/user-avatar";
import { CalendarOff, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";

interface Appointment {
  id: string;
  appointment_date: string;
  appointment_start: string;
  appointment_end: string;
  status: string;
  notes: string | null;
  buyer_id: string;
  seller_id: string;
  products_services: { id: string; titulo: string; imagen_principal: string | null; precio: number } | { id: string; titulo: string; imagen_principal: string | null; precio: number }[] | null;
  buyer: { id: string; nombre: string; foto: string | null } | { id: string; nombre: string; foto: string | null }[] | null;
  seller: { id: string; nombre: string; foto: string | null } | { id: string; nombre: string; foto: string | null }[] | null;
}

interface Props {
  appointments: Appointment[];
  currentUserId: string;
}

const TABS = [
  { key: "proximas", label: "Próximas" },
  { key: "pasadas", label: "Pasadas" },
  { key: "canceladas", label: "Canceladas" },
] as const;

function unwrap<T>(val: T | T[] | null): T | null {
  return Array.isArray(val) ? val[0] ?? null : val;
}

export function CitasList({ appointments, currentUserId }: Props) {
  const [tab, setTab] = useState<"proximas" | "pasadas" | "canceladas">("proximas");
  const today = new Date().toISOString().split("T")[0]!;

  const groups = useMemo(() => {
    const proximas: Appointment[] = [];
    const pasadas: Appointment[] = [];
    const canceladas: Appointment[] = [];

    for (const a of appointments) {
      if (a.status === "cancelled") {
        canceladas.push(a);
      } else if (a.appointment_date < today || (a.appointment_date === today && a.status === "completed")) {
        pasadas.push(a);
      } else {
        proximas.push(a);
      }
    }
    pasadas.reverse();
    canceladas.reverse();
    return { proximas, pasadas, canceladas };
  }, [appointments, today]);

  const current = groups[tab];

  return (
    <div>
      {/* Tabs */}
      <div className="flex gap-1 bg-[color:var(--sidebar-bg)] rounded-[var(--r-pill)] p-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={cn(
              "inline-flex items-center justify-center gap-2 px-4 py-2 text-sm font-medium transition-colors rounded-[var(--r-pill)]",
              tab === t.key
                ? "bg-[color:var(--fg)] text-[color:var(--bg)] font-semibold shadow-sm"
                : "text-[color:var(--fg)] hover:bg-black/5 dark:hover:bg-white/5"
            )}
          >
            {t.label}
            {groups[t.key].length > 0 && (
              <span className={cn(
                "text-[10px] rounded-[var(--r-pill)] px-1.5",
                tab === t.key
                  ? "bg-[color:var(--bg)] text-[color:var(--fg)] opacity-90"
                  : "bg-black/10 dark:bg-white/10 text-[color:var(--fg)] opacity-70"
              )}>
                {groups[t.key].length}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* List */}
      {current.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-14 h-14 rounded-full bg-[color:var(--bg-elev-2)] flex items-center justify-center mb-3">
            <CalendarOff className="w-6 h-6 text-[color:var(--fg-dim)]" />
          </div>
          <p className="font-semibold text-[color:var(--fg)] mb-1">
            {tab === "proximas" && "Sin citas próximas"}
            {tab === "pasadas" && "Sin citas pasadas"}
            {tab === "canceladas" && "Sin citas canceladas"}
          </p>
          <p className="text-sm text-[color:var(--fg-muted)] max-w-xs">
            {tab === "proximas" && "Cuando agendes o recibas citas, aparecerán aquí."}
            {tab === "pasadas" && "Tu historial de citas completadas aparecerá aquí."}
            {tab === "canceladas" && "Las citas canceladas aparecerán aquí."}
          </p>
        </div>
      ) : (
        <ul className="space-y-2">
          {current.map((a) => {
            const isBuyer = a.buyer_id === currentUserId;
            const other = unwrap(isBuyer ? a.seller : a.buyer);
            const product = unwrap(a.products_services);
            const d = new Date(a.appointment_date + "T12:00:00");
            const todayDate = new Date();
            const isToday = a.appointment_date === today;
            const tmrw = new Date(todayDate.getTime() + 86400000).toISOString().split("T")[0];
            const isTomorrow = a.appointment_date === tmrw;
            const dayLabel = isToday ? "Hoy" : isTomorrow ? "Mañana" : d.toLocaleDateString("es-MX", { weekday: "short", day: "numeric", month: "short" });
            const [h, m] = a.appointment_start.split(":");
            const hr = parseInt(h ?? "0");
            const ampm = hr >= 12 ? "PM" : "AM";
            const h12 = hr % 12 === 0 ? 12 : hr % 12;
            const timeLabel = `${h12}:${m} ${ampm}`;

            return (
              <li key={a.id}>
                <Link href={`/citas/${a.id}`} className={cn("block bg-[color:var(--sidebar-bg)] rounded-[var(--r-xl)] p-4 hover:opacity-90 transition-opacity", a.status === "cancelled" && "opacity-60")}>
                  <div className="flex items-start gap-3">
                    <UserAvatar src={other?.foto} name={other?.nombre ?? "?"} size="md" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-1.5 mb-0.5">
                        <span className="text-xs text-[color:var(--fg-muted)]">{isBuyer ? "Con" : "Para"}</span>
                        <span className="text-sm font-semibold text-[color:var(--fg)] truncate">{other?.nombre ?? "Usuario"}</span>
                      </div>
                      {product && <p className="text-sm text-[color:var(--fg)] truncate mb-1">{product.titulo}</p>}
                      <div className="flex items-center gap-1.5 text-xs">
                        <Clock className="w-3 h-3 text-[color:var(--fg-muted)] shrink-0" />
                        <span className="text-[color:var(--fg-muted)] tabular-nums">
                          {dayLabel} · {timeLabel}
                          {a.status === "cancelled" && " · Cancelada"}
                        </span>
                      </div>
                      {a.notes && tab === "proximas" && (
                        <p className="text-xs text-[color:var(--fg-muted)] opacity-80 mt-1 line-clamp-1 italic">&ldquo;{a.notes}&rdquo;</p>
                      )}
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
