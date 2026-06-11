"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { X, ChevronLeft, ChevronRight, Check, User } from "lucide-react";
import { cn } from "@/lib/utils";

interface AppointmentSchedulerProps {
  product: {
    id: string;
    titulo: string;
    creador_id: string;
    appointment_start_time: string;
    appointment_end_time: string;
    appointment_duration_minutes: number;
  };
  open: boolean;
  onClose: () => void;
}

function fmt12(h: number, m: number) {
  const p = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${p}`;
}

export function AppointmentScheduler({ product, open, onClose }: AppointmentSchedulerProps) {
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [selectedSlot, setSelectedSlot] = useState<string | null>(null);
  const [bookedSlots, setBookedSlots] = useState<string[]>([]);
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);
  const [month, setMonth] = useState(new Date());
  const supabase = createClient();

  // Generate slots with labels
  function getSlots() {
    const result: { start: string; label: string }[] = [];
    const [sh, sm] = (product.appointment_start_time ?? "09:00").split(":").map(Number);
    const [eh, em] = (product.appointment_end_time ?? "18:00").split(":").map(Number);
    const dur = product.appointment_duration_minutes ?? 60;
    let cur = (sh ?? 9) * 60 + (sm ?? 0);
    const end = (eh ?? 18) * 60 + (em ?? 0);
    while (cur + dur <= end) {
      const h = Math.floor(cur / 60);
      const m = cur % 60;
      const endMin = cur + dur;
      const eH = Math.floor(endMin / 60);
      const eM = endMin % 60;
      result.push({
        start: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`,
        label: `${fmt12(h, m)} - ${fmt12(eH, eM)}`,
      });
      cur += dur;
    }
    return result;
  }

  useEffect(() => {
    if (!selectedDate) return;
    // appointments SELECT is now participants-only (#8). Booked slots come from a
    // SECURITY DEFINER RPC that returns ONLY the confirmed start-times (no buyer
    // identity / notes) for this product + date.
    supabase
      .rpc("get_booked_slots", { p_product_id: product.id, p_date: selectedDate })
      .then(({ data }) => {
        setBookedSlots(
          (data ?? []).map((a: { appointment_start: string }) =>
            a.appointment_start.slice(0, 5),
          ),
        );
      });
  }, [selectedDate, product.id]);

  async function handleConfirm() {
    if (!selectedDate || !selectedSlot) return;
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;
    setLoading(true);
    const [h, m] = selectedSlot.split(":").map(Number);
    const endMin = (h ?? 0) * 60 + (m ?? 0) + (product.appointment_duration_minutes ?? 60);
    const endTime = `${String(Math.floor(endMin / 60)).padStart(2, "0")}:${String(endMin % 60).padStart(2, "0")}`;
    const { data: newAppt, error } = await supabase
      .from("appointments")
      .insert({
        product_id: product.id,
        buyer_id: user.id,
        seller_id: product.creador_id,
        appointment_date: selectedDate,
        appointment_start: selectedSlot,
        appointment_end: endTime,
        notes: notes.trim() || null,
      })
      .select("id")
      .single();
    setLoading(false);
    if (error) return;

    // Notify both buyer and seller
    const dateLabel = new Date(selectedDate + "T12:00:00").toLocaleDateString("es-MX", { day: "numeric", month: "short" });
    const slotH = parseInt(selectedSlot.split(":")[0] ?? "0");
    const slotM = selectedSlot.split(":")[1] ?? "00";
    const ampm = slotH >= 12 ? "PM" : "AM";
    const h12 = slotH % 12 === 0 ? 12 : slotH % 12;
    const timeLabel = `${h12}:${slotM} ${ampm}`;

    await supabase.from("notifications").insert([
      {
        user_id: user.id,
        tipo: "cita_agendada",
        titulo: "Cita agendada",
        mensaje: `${product.titulo} el ${dateLabel} | ${timeLabel}`,
        data: { appointment_id: newAppt?.id, appointment_date: selectedDate, appointment_start: selectedSlot },
      },
      {
        user_id: product.creador_id,
        tipo: "cita_agendada",
        titulo: "Nueva cita agendada",
        mensaje: `Alguien agendó "${product.titulo}" el ${dateLabel} | ${timeLabel}`,
        data: { appointment_id: newAppt?.id, appointment_date: selectedDate, appointment_start: selectedSlot },
      },
    ]);

    setSuccess(true);
    setTimeout(onClose, 2000);
  }

  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const firstDayOfWeek = new Date(month.getFullYear(), month.getMonth(), 1).getDay();
  // Adjust so Monday=0
  const startPad = firstDayOfWeek === 0 ? 6 : firstDayOfWeek - 1;
  const today = new Date().toISOString().split("T")[0];
  const slots = getSlots();

  // Selected day label
  const selectedDayLabel = selectedDate
    ? new Date(selectedDate + "T12:00:00").toLocaleDateString("es-MX", { weekday: "long", day: "numeric" })
    : "";

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-end justify-center" onClick={onClose}>
      <div
        className="bg-card w-full sm:max-w-lg rounded-t-3xl max-h-[90vh] overflow-y-auto animate-slide-up"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Handle bar */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="px-5 pb-3 flex items-center justify-between">
          <h2 className="font-heading font-bold text-xl text-foreground truncate pr-4">
            Agendar {product.titulo}
          </h2>
          <button onClick={onClose} className="w-8 h-8 rounded-full bg-muted flex items-center justify-center shrink-0">
            <X className="w-4 h-4 text-muted-foreground" />
          </button>
        </div>

        {success ? (
          <div className="p-8 text-center space-y-3">
            <span className="text-4xl">✅</span>
            <h3 className="font-heading font-bold text-lg">¡Cita agendada!</h3>
            <p className="text-sm text-muted-foreground">{selectedDayLabel} a las {selectedSlot}</p>
          </div>
        ) : (
          <>
            {/* Calendar */}
            <div className="px-5 pb-4">
              <div className="flex items-center justify-between mb-3">
                <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1))}
                  className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <span className="text-sm font-semibold capitalize">
                  {month.toLocaleDateString("es-MX", { month: "long", year: "numeric" })}
                </span>
                <button onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1))}
                  className="w-8 h-8 rounded-full hover:bg-muted flex items-center justify-center">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
              <div className="grid grid-cols-7 gap-1 mb-2">
                {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => (
                  <span key={d} className="text-xs text-muted-foreground font-medium text-center">{d}</span>
                ))}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: startPad }).map((_, i) => <div key={`p${i}`} />)}
                {Array.from({ length: daysInMonth }).map((_, i) => {
                  const day = i + 1;
                  const dateStr = `${month.getFullYear()}-${String(month.getMonth() + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
                  const isPast = dateStr < (today ?? "");
                  const isSelected = dateStr === selectedDate;
                  const isToday = dateStr === today;
                  return (
                    <button key={day} disabled={isPast}
                      onClick={() => { setSelectedDate(dateStr); setSelectedSlot(null); }}
                      className={cn(
                        "w-full aspect-square rounded-xl text-sm font-medium transition-all",
                        isPast && "text-muted-foreground/30 cursor-not-allowed",
                        isSelected && "bg-primary text-primary-foreground shadow-lg shadow-primary/30",
                        isToday && !isSelected && "ring-1 ring-primary/40",
                        !isPast && !isSelected && "hover:bg-muted active:scale-95"
                      )}>
                      {day}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Time slots */}
            {selectedDate && (
              <>
                <div className="border-t border-border mx-5 my-1" />
                <div className="px-5 py-4">
                  <h3 className="font-bold text-foreground mb-1">Franjas horarias disponibles</h3>
                  <p className="text-xs text-muted-foreground mb-4 capitalize">({selectedDayLabel})</p>
                  <div className="grid grid-cols-2 gap-2.5">
                    {slots.map((slot) => {
                      const isBooked = bookedSlots.includes(slot.start);
                      const isSelected = slot.start === selectedSlot;
                      return (
                        <button key={slot.start} disabled={isBooked}
                          onClick={() => setSelectedSlot(slot.start)}
                          className={cn(
                            "rounded-full py-3 px-4 text-sm font-medium text-center border transition-all",
                            isBooked && "border-border bg-muted/60 text-muted-foreground cursor-not-allowed",
                            isSelected && "border-transparent bg-primary text-primary-foreground font-semibold",
                            !isBooked && !isSelected && "border-border text-foreground hover:bg-muted"
                          )}>
                          {isBooked ? "Ocupado" : slot.label}
                        </button>
                      );
                    })}
                  </div>
                  {/* Legend */}
                  <div className="flex items-center gap-4 mt-4">
                    <span className="flex items-center gap-1.5 text-xs text-foreground">
                      <Check className="w-3.5 h-3.5" /> Tu selección
                    </span>
                    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                      <User className="w-3.5 h-3.5" /> Ocupado
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Notes */}
            {selectedSlot && (
              <div className="px-5 pb-4">
                <textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Notas para el prestador del servicio..."
                  rows={3}
                  className="w-full bg-muted rounded-2xl p-4 text-sm text-foreground placeholder:text-muted-foreground/60 border-0 outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                />
              </div>
            )}

            {/* Confirm button — sticky */}
            <div className="sticky bottom-0 bg-card pt-2 pb-5 px-5 border-t border-border/40">
              <button onClick={handleConfirm}
                disabled={!selectedDate || !selectedSlot || loading}
                className="w-full rounded-full py-4 bg-primary text-primary-foreground font-semibold text-base disabled:opacity-50 disabled:cursor-not-allowed hover:bg-primary/90 transition-colors">
                {loading ? "Agendando..." : "Confirmar y Agendar"}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
