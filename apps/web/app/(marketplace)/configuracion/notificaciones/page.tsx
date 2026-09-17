import { redirect } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { PreferenciasForm } from "./preferencias-form";
import { obtenerPreferenciasNotificaciones } from "./actions";

export const metadata = { title: "Notificaciones — VICINO" };

export default async function NotificacionesPreferenciasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/configuracion/notificaciones");

  const { preferencias, error } = await obtenerPreferenciasNotificaciones();

  // AQUI NO SE REDIRIGE, y no es descuido: el rebote "por seguridad" a otra
  // pantalla que lee OTRO conjunto de columnas es justo lo que produjo la
  // redireccion infinita del onboarding. Un error honesto que se queda quieto
  // se puede reintentar; un bucle no. El detalle tecnico ya viajo a Sentry
  // desde la accion.
  //
  // El caso mas probable de llegar aqui es que la migracion 20260916180000 no
  // este aplicada: sin su GRANT por columna, el SELECT de
  // notification_preferences devuelve 42501 y se lleva la consulta entera.
  if (error || !preferencias) {
    return (
      <div className="mx-auto max-w-lg space-y-4 px-4 py-10 text-center">
        <h1 className="font-heading text-2xl font-bold text-[color:var(--fg)]">
          No pudimos cargar tus preferencias
        </h1>
        <p className="text-sm text-[color:var(--fg-muted)]">
          Fue un problema nuestro, no tuyo. Nada de lo que tenías configurado se
          perdió. Vuelve a intentarlo en un momento.
        </p>
        {/* prefetch={false}: esto reintenta una consulta que acaba de fallar, y
            precargarla solo serviria para guardar el fallo en la cache del
            router. */}
        <Link
          href="/configuracion/notificaciones"
          prefetch={false}
          className="block w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white"
        >
          Reintentar
        </Link>
        <Link
          href="/configuracion"
          className="block text-sm text-[color:var(--fg-muted)] underline"
        >
          Volver a Configuración
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8 animate-fade-in-up">
      <div>
        <Link
          href="/configuracion"
          className="mb-3 inline-flex items-center gap-1 text-sm text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
        >
          <ChevronLeft className="h-4 w-4" />
          Configuración
        </Link>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--fg)]">
          Tu cuenta
        </div>
        <h1 className="font-heading text-2xl font-bold text-[color:var(--fg)]">
          Notificaciones
        </h1>
        <p className="mt-2 text-sm text-[color:var(--fg-muted)]">
          Elige de qué quieres que te avisemos al momento. Puedes cambiarlo
          cuando quieras.
        </p>
      </div>

      <PreferenciasForm preferenciasIniciales={preferencias} />
    </div>
  );
}
