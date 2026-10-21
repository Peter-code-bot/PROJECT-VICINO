import Link from "next/link";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { Stamp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { misTarjetas } from "@/lib/lealtad/datos";
import type { TarjetaResumen } from "@/lib/lealtad/esquemas";
import { TarjetaLealtad } from "@/components/lealtad/tarjeta-lealtad";

export const metadata = { title: "Mis tarjetas de lealtad — VICINO" };

export default async function TarjetasPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/tarjetas");

  let tarjetas: TarjetaResumen[] = [];
  let fallo = false;
  try {
    tarjetas = await misTarjetas(supabase);
  } catch (error) {
    fallo = true;
    Sentry.captureException(error, { tags: { surface: "tarjetas", query: "loyalty_mis_tarjetas" } });
  }

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 pb-24 md:pb-8 animate-fade-in-up">
      <div className="mb-6">
        <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--fg)]">Lealtad</div>
        <h1 className="font-heading text-2xl font-bold text-[color:var(--fg)]">Mis tarjetas</h1>
      </div>

      {fallo ? (
        <p className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] px-4 py-6 text-center text-sm text-[color:var(--fg-muted)]">
          No pudimos cargar tus tarjetas. Revisa tu conexión e inténtalo de nuevo.
        </p>
      ) : tarjetas.length === 0 ? (
        <div className="space-y-3 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] px-4 py-10 text-center">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-[color:var(--bg-elev-2)]">
            <Stamp className="h-6 w-6 text-[color:var(--fg)]" />
          </div>
          <p className="font-medium text-[color:var(--fg)]">Todavía no tienes tarjetas</p>
          <p className="text-sm text-[color:var(--fg-muted)]">
            Cuando un negocio tenga programa de lealtad, únete desde su perfil. Cada compra confirmada suma un sello.
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2">
          {tarjetas.map((t) => (
            <li key={t.id}>
              <Link href={`/tarjetas/${t.id}`} className="block transition-transform hover:-translate-y-0.5">
                <TarjetaLealtad
                  negocio={t.negocio.nombre}
                  nombre={t.program.nombre}
                  premio={t.program.premio}
                  metaSellos={t.program.meta_sellos}
                  sellos={t.sellos_disponibles}
                  color={t.program.color}
                  plantilla={t.program.plantilla}
                />
                {t.program.status === "pausado" ? (
                  <p className="mt-1 text-xs text-[color:var(--fg-muted)]">Programa en pausa</p>
                ) : null}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
