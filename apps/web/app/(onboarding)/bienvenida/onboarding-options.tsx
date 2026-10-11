"use client";

import Image from "next/image";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, ShoppingBag } from "lucide-react";
import * as Sentry from "@sentry/nextjs";
import { guardarPasoOnboarding, type CaminoOnboarding } from "@/app/(onboarding)/completar-perfil/actions";
import { OnboardingActions, OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { conTope, esTope } from "@/lib/auth/con-tope";

const OPCIONES = [
  { camino: "explorar", titulo: "Quiero comprar", texto: "Encuentra lo que ofrecen tus vecinos.", Icono: Search },
  { camino: "vender", titulo: "Quiero vender", texto: "Prepara tu perfil para publicar lo que ofreces.", Icono: ShoppingBag },
] as const;

export function OnboardingOptions() {
  const router = useRouter();
  const [camino, setCamino] = useState<CaminoOnboarding | null>(null);
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();

  function elegir(destino: CaminoOnboarding) {
    if (isPending) return;
    setError(undefined);
    startTransition(async () => {
      const paso = destino === "vender" ? "categoria" : "usuario";
      try {
        const result = await conTope(guardarPasoOnboarding({ camino: destino, paso }));
        if (result.error) {
          setError(result.error);
          return;
        }
        router.push(`/completar-perfil/${paso}`);
      } catch (err) {
        if (!esTope(err)) {
          Sentry.captureException(err, { tags: { action: "bienvenida_elegir_camino" } });
        }
        setError("No pudimos guardar tu elección. Revisa tu conexión e inténtalo de nuevo.");
      }
    });
  }

  return (
    <OnboardingShell
      title="Bienvenido a VICINO"
      description="Compra y vende cerca de ti. Elige cómo quieres empezar."
      error={error}
      busy={isPending}
      footer={
        <OnboardingActions
          onContinue={() => { if (camino) elegir(camino); }}
          disabled={!camino}
          busy={isPending}
        />
      }
    >
      <div className="mb-6 flex justify-center">
        <Image src="/vicino-logo-light-v2.png" alt="" width={88} height={88} className="object-contain show-in-light" priority />
        <Image src="/vicino-logo-dark.png" alt="" width={88} height={88} className="object-contain show-in-dark" priority />
      </div>
      <fieldset disabled={isPending} className="space-y-3">
        <legend className="sr-only">Elige tu recorrido</legend>
        {OPCIONES.map(({ camino: opcion, titulo, texto, Icono }) => (
          <label key={opcion} className="block cursor-pointer">
            <input
              type="radio"
              name="camino"
              value={opcion}
              checked={camino === opcion}
              onChange={() => setCamino(opcion)}
              className="peer sr-only"
            />
            <span className={`flex min-h-20 items-start gap-4 rounded-xl border p-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-brand-hi ${camino === opcion ? "border-brand bg-brand-tint dark:border-brand-hi" : "border-fg-muted bg-card-2"}`}>
              <Icono className="mt-1 h-6 w-6 shrink-0 text-brand dark:text-brand-hi" aria-hidden="true" />
              <span>
                <span className="block font-semibold text-fg">{titulo}</span>
                <span className="mt-1 block text-sm leading-relaxed text-fg-muted">{texto}</span>
              </span>
            </span>
          </label>
        ))}
      </fieldset>
    </OnboardingShell>
  );
}
