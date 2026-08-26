"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { avisarCitaEnChat } from "@/app/(marketplace)/chat/actions";
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [month, setMonth] = useState(new Date());
  const supabase = createClient();

  // Genera los horarios disponibles a partir de la ventana del vendedor.
  //
  // Dos trampas que este bucle tenia:
  //
  //   1. Duracion 0 congelaba la pestaña. `?? 60` solo cubre null y undefined,
  //      no el cero, y la columna es un integer sin CHECK. Con dur = 0, `cur`
  //      nunca avanza, la condicion sigue siendo cierta, y el while empuja al
  //      array hasta agotar la memoria. La migracion 20260826210000 lo prohibe
  //      en la base; esta guarda cubre los datos que ya existieran.
  //
  //   2. Una ventana que cruza medianoche daba CERO horarios. 20:00 -> 02:00
  //      calcula end = 120 y cur = 1200, asi que el bucle no entra nunca. Es el
  //      caso natural de un antro, y estaba en la lista de pendientes.
  //
  // El tercer caso es ambiguo y se trata aparte: inicio == fin. Puede querer
  // decir "24 horas" o "sin configurar", y hoy en produccion hay un servicio
  // ("Reservaciones para Dorothy") con 00:00 -> 00:00, que casi seguro es un
  // formulario enviado vacio. Generar 48 huecos ahi seria inventar
  // disponibilidad que el vendedor nunca ofrecio, asi que se devuelve vacio y la
  // interfaz lo dice.
  function getSlots() {
    const result: { start: string; label: string }[] = [];
    const [sh, sm] = (product.appointment_start_time ?? "09:00").split(":").map(Number);
    const [eh, em] = (product.appointment_end_time ?? "18:00").split(":").map(Number);

    const rawDur = product.appointment_duration_minutes;
    const dur = Number.isFinite(rawDur) && (rawDur ?? 0) > 0 ? (rawDur as number) : 60;

    const start = (sh ?? 9) * 60 + (sm ?? 0);
    const rawEnd = (eh ?? 18) * 60 + (em ?? 0);

    if (rawEnd === start) return result;

    let cur = start;
    const end = rawEnd < start ? rawEnd + 24 * 60 : rawEnd;

    while (cur + dur <= end) {
      // El %24 es lo que hace utilizable el cruce de medianoche: pasada la
      // medianoche `cur` supera los 1440 minutos, y sin normalizar saldria una
      // hora "25:00" —invalida para la columna `time` de appointment_start— y
      // fmt12 la etiquetaria como PM cuando es la 1 de la mañana.
      const h = Math.floor(cur / 60) % 24;
      const m = cur % 60;
      const endMin = cur + dur;
      const eH = Math.floor(endMin / 60) % 24;
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
    supabase
      .from("appointments")
      .select("appointment_start")
      .eq("product_id", product.id)
      .eq("appointment_date", selectedDate)
      // Antes filtraba por status = 'confirmed', pero el indice unico bloquea
      // todo lo que no este cancelado: un hueco 'completed' se ofrecia libre y
      // el INSERT moria con 23505. Ahora el selector y el indice dicen lo mismo.
      .neq("status", "cancelled")
      .then(({ data, error }) => {
        if (error) {
          // Sin este catch, un fallo dejaba bookedSlots vacio y se ofrecian como
          // libres TODOS los horarios, incluidos los ya ocupados.
          console.error("[citas] no se pudieron leer los horarios ocupados:", error);
          setErrorMsg("No pudimos revisar los horarios ocupados. Recarga la página.");
          return;
        }
        setErrorMsg(null);
        setBookedSlots(data?.map((a) => a.appointment_start.slice(0, 5)) ?? []);
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

    // Antes era `if (error) return;`: el spinner se apagaba y no pasaba nada
    // mas. La persona pulsaba Confirmar, no veia ni exito ni fallo, y se
    // quedaba sin saber si tenia cita.
    if (error) {
      console.error("[citas] no se pudo agendar:", error);
      setErrorMsg(
        error.code === "23505"
          ? "Ese horario acaba de ocuparse. Elige otro."
          : "No se pudo agendar la cita. Intenta de nuevo."
      );
      return;
    }

    // El aviso a comprador y vendedor lo crea ahora el trigger
    // on_appointment_created_notify (migracion 20260826140000). El INSERT que
    // habia aqui escribia en `notifications` desde el navegador, y esa tabla no
    // tiene policy de INSERT: moria con 42501 en cada agendamiento, descartado
    // por un `await` sin comprobar. Nadie se entero nunca de una cita.
    void newAppt;

    // Item 99: dejar constancia en el chat. Va DESPUES y aparte a proposito.
    // La cita ya esta guardada y el trigger ya mando los avisos, asi que si
    // esto falla la persona no pierde nada: solo se queda sin el mensaje. Por
    // eso no se toca setSuccess ni setErrorMsg segun su resultado.
    //
    // No se hace en el trigger de la base aunque parezca el sitio natural: su
    // `SET search_path TO ''` lo heredan los triggers anidados y el INSERT en
    // messages fallaria siempre. La razon larga esta en avisarCitaEnChat.
    try {
      const aviso = await avisarCitaEnChat({
        sellerId: product.creador_id,
        productId: product.id,
        tituloProducto: product.titulo,
        fecha: selectedDate,
        hora: selectedSlot,
      });
      if (aviso?.error) {
        console.warn("[citas] no se pudo avisar en el chat:", aviso.error);
      }
    } catch (e) {
      console.warn("[citas] no se pudo avisar en el chat:", e);
    }

    setErrorMsg(null);
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
                  {slots.length === 0 && (
                    // Antes esto era un hueco mudo: la rejilla quedaba vacia sin
                    // explicar nada. Pasa cuando el vendedor no dejo configurado
                    // su horario (inicio == fin), que hoy le ocurre a un servicio
                    // real en produccion.
                    <p className="text-sm text-muted-foreground">
                      Este servicio todavía no tiene horarios configurados. Escríbele al
                      vendedor para acordar una hora.
                    </p>
                  )}
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
              {errorMsg && (
                <p role="alert" className="mb-3 text-sm text-destructive">
                  {errorMsg}
                </p>
              )}
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
