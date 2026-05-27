"use client";

import { useEffect, useState } from "react";
import { Calendar, Clock, ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import Link from "next/link";

interface Appointment {
  id: string;
  appointment_date: string;
  appointment_start: string;
  otherName: string;
  productTitle: string;
  isPast: boolean;
}

const DIAS = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export function WeeklyAppointmentsWidget() {
  const [appointments, setAppointments] = useState<Appointment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setLoading(false); return; }

      const now = new Date();
      const todayStr = now.toISOString().split("T")[0];
      const weekLater = new Date(now.getTime() + 7 * 86400000).toISOString().split("T")[0];

      const { data } = await supabase
        .from("appointments")
        .select("id, appointment_date, appointment_start, buyer_id, seller_id, products_services(titulo), buyer:profiles!buyer_id(nombre), seller:profiles!seller_id(nombre)")
        .or(`buyer_id.eq.${user.id},seller_id.eq.${user.id}`)
        .gte("appointment_date", todayStr)
        .lte("appointment_date", weekLater)
        .eq("status", "confirmed")
        .order("appointment_date", { ascending: true })
        .order("appointment_start", { ascending: true })
        .limit(8);

      if (data) {
        setAppointments(data.map((a: Record<string, unknown>) => {
          const prod = Array.isArray(a.products_services) ? a.products_services[0] : a.products_services;
          const isBuyer = a.buyer_id === user.id;
          const other = isBuyer
            ? (Array.isArray(a.seller) ? a.seller[0] : a.seller)
            : (Array.isArray(a.buyer) ? a.buyer[0] : a.buyer);
          const dateTime = new Date(`${a.appointment_date}T${a.appointment_start}`);
          return {
            id: a.id as string,
            appointment_date: a.appointment_date as string,
            appointment_start: a.appointment_start as string,
            otherName: (other as { nombre?: string })?.nombre ?? "Usuario",
            productTitle: (prod as { titulo?: string })?.titulo ?? "Servicio",
            isPast: dateTime.getTime() < now.getTime(),
          };
        }));
      }
      setLoading(false);
    })();
  }, []);

  if (loading || appointments.length === 0) return null;

  return (
    <aside className="hidden xl:block w-72 sticky top-20 self-start">
      <div className="bg-card rounded-2xl border border-border p-4">
        <div className="flex items-center gap-2 mb-3">
          <Calendar className="w-4 h-4 text-muted-foreground" />
          <h3 className="text-sm font-semibold text-foreground">Citas esta semana</h3>
        </div>
        {appointments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No tienes citas esta semana.</p>
        ) : (
          <ul className="space-y-2">
            {appointments.map((a) => {
              const d = new Date(`${a.appointment_date}T12:00:00`);
              const dia = DIAS[d.getDay()] ?? "";
              const dayNum = d.getDate();
              const [h, m] = a.appointment_start.split(":");
              const hr = parseInt(h ?? "0");
              const ampm = hr >= 12 ? "PM" : "AM";
              const h12 = hr % 12 === 0 ? 12 : hr % 12;
              return (
                <li key={a.id} className="rounded-xl p-2 -mx-1 hover:bg-muted transition-colors">
                  <p className="text-xs font-medium text-foreground">
                    {dia} {dayNum} | {h12}:{m} {ampm}
                    {a.isPast && <span className="text-danger ml-1">(Vencida)</span>}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">
                    {a.otherName} · {a.productTitle}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
        <Link
          href="/citas"
          className="flex items-center justify-center gap-1 mt-3 pt-3 border-t border-border text-xs font-medium text-primary hover:text-primary/80 transition-colors"
        >
          Ver todas mis citas
          <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </aside>
  );
}
