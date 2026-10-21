import Link from "next/link";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { publicProfileName } from "@vicino/shared";
import { Pencil, Stamp } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { resumenNegocio } from "@/lib/lealtad/datos";
import type { ResumenNegocio } from "@/lib/lealtad/esquemas";
import { TarjetaLealtad } from "@/components/lealtad/tarjeta-lealtad";
import { EstadoPrograma } from "./estado-programa";
import { ConfirmarCanjeForm } from "./confirmar-canje-form";
import { ActividadLista } from "./actividad-lista";
import { VentasSinSello } from "./ventas-sin-sello";
import { etiquetaCanje } from "@/lib/lealtad/etiquetas";

export const metadata = { title: "Tarjeta de lealtad — VICINO" };

const ESTADOS: Record<string, string> = {
  borrador: "Borrador",
  activo: "Activa",
  pausado: "En pausa",
  archivado: "Archivada",
};

export default async function LealtadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/seller/lealtad");

  const { data: perfil } = await supabase
    .from("profiles")
    .select("nombre, nombre_negocio, es_vendedor, seller_type")
    .eq("id", user.id)
    .maybeSingle();
  const negocio = publicProfileName(perfil, "Mi negocio");

  let resumen: ResumenNegocio;
  try {
    resumen = await resumenNegocio(supabase);
  } catch (error) {
    Sentry.captureException(error, { tags: { surface: "seller_lealtad", query: "loyalty_resumen_negocio" } });
    return (
      <div className="space-y-3">
        <h1 className="text-xl font-bold">Tarjeta de lealtad</h1>
        <p className="text-sm text-[color:var(--fg-muted)]">
          No pudimos cargar tu programa. Revisa tu conexión e inténtalo de nuevo.
        </p>
      </div>
    );
  }

  if (!resumen.program) return <SinPrograma />;

  const { program, metricas, eventos = [], canjes_recientes = [], ventas_sin_sello = [] } = resumen;
  const metricasLista = [
    { titulo: "Miembros", valor: metricas?.miembros ?? 0 },
    { titulo: "Sellos emitidos", valor: metricas?.sellos_emitidos ?? 0 },
    { titulo: "Premios canjeados", valor: metricas?.canjes ?? 0 },
    { titulo: "Canjes en curso", valor: metricas?.canjes_pendientes ?? 0 },
  ];

  return (
    <div className="space-y-6 animate-fade-in-up min-w-0">
      <div className="flex items-start justify-between gap-3 min-w-0">
        <div className="min-w-0">
          <h1 className="text-xl font-bold truncate">Tarjeta de lealtad</h1>
          <p className="text-sm text-[color:var(--fg-muted)]">
            Estado: <span className="font-semibold text-[color:var(--fg)]">{ESTADOS[program.status] ?? program.status}</span>
            {program.status !== "borrador" ? ` · versión ${program.version_actual}` : null}
          </p>
        </div>
        <Link
          href="/seller/lealtad/editar"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--r-pill)] border border-[color:var(--border)] px-3 py-2 text-xs font-semibold text-[color:var(--fg)] hover:bg-[color:var(--bg-elev-2)]"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-[minmax(0,320px)_1fr] md:items-start">
        <TarjetaLealtad
          negocio={negocio}
          nombre={program.nombre}
          premio={program.premio}
          metaSellos={program.meta_sellos}
          sellos={Math.min(3, program.meta_sellos - 1)}
          color={program.color}
          plantilla={program.plantilla}
          titular="Tu cliente"
          className="w-full max-w-[320px]"
        />
        <div className="space-y-3">
          <EstadoPrograma status={program.status} />
          <p className="text-xs text-[color:var(--fg-muted)]">
            {program.status === "borrador"
              ? "Nadie ve el programa hasta que lo publiques. Revisa el premio y las condiciones antes."
              : program.status === "pausado"
                ? "En pausa no entran clientes nuevos ni se acumulan sellos; los saldos y canjes en curso se conservan."
                : "Tu programa aparece en tu perfil público. Cada compra confirmada en VICINO suma un sello."}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 min-w-0">
        {metricasLista.map((m) => (
          <div
            key={m.titulo}
            className="flex min-h-[110px] flex-col justify-center gap-1 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 sm:p-5"
          >
            <h3 className="text-sm font-bold text-[color:var(--fg)]">{m.titulo}</h3>
            <p className="font-heading text-3xl font-extrabold tabular-nums text-[color:var(--fg)]">{m.valor}</p>
          </div>
        ))}
      </div>

      <section className="space-y-3 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 sm:p-5">
        <div>
          <h2 className="font-heading text-base font-bold text-[color:var(--fg)] sm:text-lg">Confirmar un canje</h2>
          <p className="text-xs text-[color:var(--fg-muted)]">
            El cliente abre su tarjeta en VICINO y te muestra un código de 6 dígitos. Tecléalo aquí: los sellos se
            descuentan al confirmar. El código vive 15 minutos.
          </p>
        </div>
        <ConfirmarCanjeForm deshabilitado={program.status === "borrador"} />
      </section>

      {ventas_sin_sello.length > 0 ? <VentasSinSello ventas={ventas_sin_sello} /> : null}

      <section className="space-y-3">
        <h2 className="font-heading text-base font-bold text-[color:var(--fg)] sm:text-lg">Actividad reciente</h2>
        <ActividadLista eventos={eventos} />
      </section>

      {canjes_recientes.length > 0 ? (
        <section className="space-y-3">
          <h2 className="font-heading text-base font-bold text-[color:var(--fg)] sm:text-lg">Canjes</h2>
          <ul className="space-y-2">
            {canjes_recientes.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[color:var(--fg)]">{c.cliente}</p>
                  <p className="truncate text-xs text-[color:var(--fg-muted)]">{c.premio} · {c.costo_sellos} sellos</p>
                </div>
                <span className="shrink-0 rounded-[var(--r-pill)] border border-[color:var(--border)] px-2.5 py-0.5 text-xs font-medium text-[color:var(--fg)]">
                  {etiquetaCanje(c.status, c.expires_at)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}

function SinPrograma() {
  return (
    <div className="space-y-6 animate-fade-in-up">
      <div>
        <h1 className="text-xl font-bold">Tarjeta de lealtad</h1>
        <p className="text-sm text-[color:var(--fg-muted)]">
          Premia a quienes te compran seguido: cada compra confirmada en VICINO suma un sello y, al completar la meta,
          el cliente canjea el premio contigo. La tarjeta se guarda en Apple Wallet o Google Wallet.
        </p>
      </div>
      <div className="space-y-4 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-5">
        <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[color:var(--bg-elev-2)]">
          <Stamp className="h-5 w-5 text-[color:var(--fg)]" />
        </div>
        <ul className="space-y-1.5 text-sm text-[color:var(--fg)]">
          <li>1. Defines el premio, la meta de sellos y las condiciones.</li>
          <li>2. Publicas el programa y aparece en tu perfil.</li>
          <li>3. Tus clientes se unen y acumulan sellos con cada compra confirmada.</li>
          <li>4. Para entregar el premio, tecleas el código que te muestran.</li>
        </ul>
        <Link
          href="/seller/lealtad/editar"
          className="inline-flex rounded-[var(--r-pill)] bg-[color:var(--fg)] px-4 py-2.5 text-sm font-semibold text-[color:var(--bg)] hover:opacity-90"
        >
          Crear mi programa
        </Link>
      </div>
    </div>
  );
}
