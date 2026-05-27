import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  Calendar,
  Clock,
  MapPin,
  ArrowLeft,
  CheckCircle2,
  XCircle,
  AlertCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { UserAvatar } from "@/components/ui/user-avatar";
import { CancelAppointmentButton } from "@/components/appointments/cancel-appointment-button";

interface PageProps {
  params: Promise<{ id: string }>;
}

const DIAS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

function fmt12(timeStr: string): string {
  const [hStr, mStr] = timeStr.split(":");
  const h = parseInt(hStr ?? "0", 10);
  const m = mStr ?? "00";
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${m} ${ampm}`;
}

export async function generateMetadata() {
  return { title: "Detalle de cita — VICINO" };
}

export default async function CitaDetailPage({ params }: PageProps) {
  const { id } = await params;
  const supabase = await createClient();

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=/citas/${id}`);

  const { data: cita } = await supabase
    .from("appointments")
    .select(`
      id, appointment_date, appointment_start, appointment_end,
      status, notes, buyer_id, seller_id, created_at,
      products_services(id, titulo, imagen_principal, precio, categoria, slug, ubicacion),
      buyer:profiles!buyer_id(id, nombre, foto),
      seller:profiles!seller_id(id, nombre, foto)
    `)
    .eq("id", id)
    .single();

  if (!cita) notFound();
  if (cita.buyer_id !== user.id && cita.seller_id !== user.id) notFound();

  const isBuyer = cita.buyer_id === user.id;

  function unwrap<T>(val: T | T[] | null): T | null {
    return Array.isArray(val) ? (val[0] ?? null) : val;
  }

  const otherUser = unwrap(isBuyer ? cita.seller : cita.buyer);
  const product = unwrap(cita.products_services);

  const d = new Date(cita.appointment_date + "T12:00:00");
  const fechaCompleta = `${DIAS[d.getDay()]}, ${d.getDate()} de ${MESES[d.getMonth()]} de ${d.getFullYear()}`;
  const horaInicio = fmt12(cita.appointment_start);
  const horaFin = fmt12(cita.appointment_end);

  const [sh, sm] = cita.appointment_start.split(":").map(Number);
  const [eh, em] = cita.appointment_end.split(":").map(Number);
  const durationMin = ((eh ?? 0) * 60 + (em ?? 0)) - ((sh ?? 0) * 60 + (sm ?? 0));

  const today = new Date().toISOString().split("T")[0]!;
  const nowTime = new Date().toTimeString().slice(0, 5);
  const isPast =
    cita.appointment_date < today ||
    (cita.appointment_date === today && cita.appointment_end < nowTime);
  const isUpcoming = cita.status === "confirmed" && !isPast;
  const isCompleted = cita.status === "completed";

  return (
    <div className="max-w-2xl mx-auto px-4 py-6">
      <Link
        href="/citas"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground mb-5 transition-colors"
      >
        <ArrowLeft size={16} />
        Volver a mis citas
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-heading font-bold text-foreground mb-2">
          Detalle de cita
        </h1>
        <StatusBadge status={cita.status} isPast={isPast} />
      </div>

      <div className="bg-card border border-border rounded-2xl overflow-hidden mb-4">
        {/* Producto — clickeable a su detalle */}
        {product ? (
          <Link
            href={`/${product.categoria}/${product.slug}`}
            className="flex items-center gap-3 p-4 hover:bg-muted/40 transition-colors border-b border-border"
          >
            <div className="w-14 h-14 rounded-xl bg-muted overflow-hidden shrink-0 flex items-center justify-center">
              {product.imagen_principal ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={product.imagen_principal}
                  alt={product.titulo}
                  className="w-full h-full object-cover"
                />
              ) : (
                <Calendar size={20} className="text-muted-foreground" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-foreground truncate">{product.titulo}</p>
              {product.precio !== null && (
                <p className="text-sm text-muted-foreground">
                  ${Number(product.precio).toLocaleString("es-MX")} MXN
                </p>
              )}
              <p className="text-xs text-primary mt-0.5">Ver publicación →</p>
            </div>
          </Link>
        ) : (
          <div className="flex items-center gap-3 p-4 border-b border-border opacity-60">
            <div className="w-14 h-14 rounded-xl bg-muted flex items-center justify-center shrink-0">
              <Calendar size={20} className="text-muted-foreground" />
            </div>
            <p className="text-sm text-muted-foreground">Publicación eliminada</p>
          </div>
        )}

        {/* Fecha y hora */}
        <div className="p-4 border-b border-border space-y-3">
          <div className="flex items-start gap-3">
            <Calendar size={18} className="text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Fecha</p>
              <p className="text-foreground font-medium">{fechaCompleta}</p>
            </div>
          </div>

          <div className="flex items-start gap-3">
            <Clock size={18} className="text-muted-foreground shrink-0 mt-0.5" />
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Horario</p>
              <p className="text-foreground font-medium">
                {horaInicio} – {horaFin}
                {durationMin > 0 && (
                  <span className="text-xs text-muted-foreground ml-2">
                    ({durationMin} min)
                  </span>
                )}
              </p>
            </div>
          </div>

          {product?.ubicacion && (
            <div className="flex items-start gap-3">
              <MapPin size={18} className="text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="text-xs text-muted-foreground mb-0.5">Ubicación</p>
                <p className="text-foreground font-medium">{product.ubicacion}</p>
              </div>
            </div>
          )}
        </div>

        {/* Contraparte */}
        {otherUser && (
          <div className="p-4 border-b border-border">
            <p className="text-xs text-muted-foreground mb-2">
              {isBuyer ? "Con" : "Para"}
            </p>
            <Link
              href={`/vendedor/${otherUser.id}`}
              className="flex items-center gap-3 hover:bg-muted/40 -mx-2 px-2 py-1.5 rounded-xl transition-colors"
            >
              <UserAvatar src={otherUser.foto} name={otherUser.nombre} size="sm" />
              <span className="font-semibold text-foreground">{otherUser.nombre}</span>
            </Link>
          </div>
        )}

        {/* Notas */}
        {cita.notes && (
          <div className="p-4">
            <p className="text-xs text-muted-foreground mb-1">Notas</p>
            <p className="text-sm text-foreground italic">&ldquo;{cita.notes}&rdquo;</p>
          </div>
        )}
      </div>

      {/* Acciones */}
      <div className="space-y-3">
        {isUpcoming && <CancelAppointmentButton appointmentId={cita.id} />}

        {isCompleted && product && (
          <Link
            href={`/resenar/${product.id}?cita=${cita.id}`}
            className="w-full inline-flex items-center justify-center gap-2 rounded-full py-3 bg-primary text-primary-foreground font-semibold hover:bg-primary/90 transition-colors"
          >
            Dejar reseña
          </Link>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status, isPast }: { status: string; isPast: boolean }) {
  if (status === "completed") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-trust/15 text-emerald-trust text-xs font-semibold">
        <CheckCircle2 size={12} />
        Completada
      </span>
    );
  }
  if (status === "cancelled") {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted text-muted-foreground text-xs font-semibold">
        <XCircle size={12} />
        Cancelada
      </span>
    );
  }
  if (isPast) {
    return (
      <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-destructive/15 text-destructive text-xs font-semibold">
        <AlertCircle size={12} />
        Vencida
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-primary/15 text-primary text-xs font-semibold">
      <Calendar size={12} />
      Próxima
    </span>
  );
}
