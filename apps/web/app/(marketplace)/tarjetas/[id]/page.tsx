import Image from "next/image";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import QRCode from "qrcode";
import { ChevronLeft } from "lucide-react";
import { formatDate } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { miTarjeta } from "@/lib/lealtad/datos";
import { disponibilidadWallet } from "@/lib/wallet/config";
import { TarjetaLealtad } from "@/components/lealtad/tarjeta-lealtad";
import { AccionesTarjeta } from "./acciones-tarjeta";

export const metadata = { title: "Mi tarjeta de lealtad — VICINO" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TITULOS: Record<string, string> = {
  earn: "Sello por compra",
  redeem: "Premio canjeado",
  reverse: "Reversa",
  adjust: "Ajuste",
};

export default async function TarjetaPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/tarjetas/${id}`)}`);

  let tarjeta;
  try {
    tarjeta = await miTarjeta(supabase, id);
  } catch (error) {
    Sentry.captureException(error, { tags: { surface: "tarjeta", query: "loyalty_mi_tarjeta" } });
    return (
      <div className="mx-auto w-full max-w-lg px-4 py-6">
        <p className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] px-4 py-6 text-center text-sm text-[color:var(--fg-muted)]">
          No pudimos cargar tu tarjeta. Revisa tu conexión e inténtalo de nuevo.
        </p>
      </div>
    );
  }
  if (!tarjeta) notFound();

  const { membership, program, negocio, cliente, canje_pendiente, eventos, pases, meta_canje } = tarjeta;
  const faltan = Math.max(0, meta_canje - membership.sellos_disponibles);
  const qr = await QRCode.toDataURL(membership.public_id, { margin: 1, width: 240, errorCorrectionLevel: "M" });
  const wallet = disponibilidadWallet();

  return (
    <div className="mx-auto w-full max-w-lg px-4 py-6 pb-24 md:pb-8 animate-fade-in-up">
      <Link
        href="/tarjetas"
        className="mb-4 inline-flex items-center gap-1 text-sm text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
      >
        <ChevronLeft className="h-4 w-4" />
        Mis tarjetas
      </Link>

      <TarjetaLealtad
        negocio={negocio.nombre}
        nombre={program.nombre}
        premio={program.premio}
        metaSellos={program.meta_sellos}
        sellos={membership.sellos_disponibles}
        color={program.color}
        plantilla={program.plantilla}
        titular={cliente.nombre}
      />

      <div className="mt-4 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4">
        <p className="font-heading text-lg font-bold text-[color:var(--fg)]">
          {membership.sellos_disponibles} de {program.meta_sellos} sellos
        </p>
        <p className="text-sm text-[color:var(--fg-muted)]">
          {membership.status !== "activa"
            ? "Esta tarjeta fue revocada por el negocio."
            : program.status === "pausado"
              ? "El programa está en pausa: se conservan tus sellos, pero no se suman nuevos."
              : faltan === 0
                ? `¡Lista! Canjea ${program.premio} con ${negocio.nombre}.`
                : `Te ${faltan === 1 ? "falta" : "faltan"} ${faltan} ${faltan === 1 ? "sello" : "sellos"} para ${program.premio}.`}
        </p>
        <p className="mt-2 text-xs text-[color:var(--fg-muted)]">
          Negocio:{" "}
          <Link href={`/vendedor/${negocio.id}`} className="font-semibold text-[color:var(--fg)] hover:underline">
            {negocio.nombre}
          </Link>
          {membership.premios_canjeados > 0 ? ` · ${membership.premios_canjeados} ${membership.premios_canjeados === 1 ? "premio canjeado" : "premios canjeados"}` : null}
        </p>
      </div>

      <AccionesTarjeta
        membershipId={membership.id}
        sellos={membership.sellos_disponibles}
        meta={meta_canje}
        premio={program.premio}
        activa={membership.status === "activa" && program.status === "activo"}
        canjePendiente={canje_pendiente}
        wallet={wallet}
        pases={pases}
      />

      <div className="mt-4 flex items-center gap-4 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4">
        <Image src={qr} alt="Código QR de tu tarjeta" width={112} height={112} unoptimized className="rounded-lg bg-white p-1" />
        <div className="min-w-0 text-xs text-[color:var(--fg-muted)]">
          <p className="font-semibold text-[color:var(--fg)]">Tu identificador</p>
          <p className="break-all font-mono">{membership.public_id}</p>
          <p className="mt-1">Solo identifica tu tarjeta. Mostrarlo no suma sellos ni canjea premios.</p>
        </div>
      </div>

      <section className="mt-4 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 text-sm">
        <h2 className="font-semibold text-[color:var(--fg)]">Condiciones</h2>
        <p className="mt-1 whitespace-pre-line text-[color:var(--fg-muted)]">
          {program.condiciones ?? "Sin condiciones adicionales."}
        </p>
        <p className="mt-2 text-xs text-[color:var(--fg-muted)]">
          Una compra confirmada en VICINO = un sello. El saldo oficial vive en VICINO; la tarjeta en tu cartera es
          una copia que se actualiza sola.
        </p>
      </section>

      <section className="mt-4">
        <h2 className="mb-2 font-heading text-base font-bold text-[color:var(--fg)]">Historial</h2>
        {eventos.length === 0 ? (
          <p className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] px-4 py-5 text-center text-sm text-[color:var(--fg-muted)]">
            Tu primer sello llegará con tu próxima compra confirmada.
          </p>
        ) : (
          <ul className="space-y-2">
            {eventos.map((e) => (
              <li key={e.id} className="flex items-center justify-between gap-3 rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] px-4 py-3 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold text-[color:var(--fg)]">{TITULOS[e.tipo] ?? e.tipo}</p>
                  <p className="truncate text-xs text-[color:var(--fg-muted)]">
                    {formatDate(e.created_at)}
                    {e.motivo ? ` · ${e.motivo}` : ""}
                  </p>
                </div>
                <span className={`shrink-0 font-heading text-base font-bold tabular-nums ${e.sellos > 0 ? "text-[color:var(--fg)]" : "text-[color:var(--fg-muted)]"}`}>
                  {e.sellos > 0 ? `+${e.sellos}` : e.sellos}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
