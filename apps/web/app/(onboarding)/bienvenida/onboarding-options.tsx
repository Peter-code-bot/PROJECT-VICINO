"use client";

import Image from "next/image";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, ShoppingBag } from "lucide-react";
import { OnboardingActions, OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { OnboardingSaveStatus } from "@/components/onboarding/onboarding-save-status";
import { OnboardingSessionProvider, useOnboardingSession } from "../completar-perfil/onboarding-session";
import type { OnboardingProfile } from "../completar-perfil/load-profile";
import { resolverCaminoOnboarding, rutaDePaso, type CaminoOnboarding } from "@/lib/onboarding/steps";

const OPCIONES = [
  { camino: "explorar", titulo: "Quiero comprar", texto: "Encuentra lo que ofrecen tus vecinos.", Icono: Search },
  { camino: "vender", titulo: "Quiero vender", texto: "Prepara tu perfil para publicar lo que ofreces.", Icono: ShoppingBag },
] as const;

export function OnboardingOptions({ profile }: { profile: OnboardingProfile }) {
  return <OnboardingSessionProvider profile={profile} selectingPath><PathChoice /></OnboardingSessionProvider>;
}

function PathChoice() {
  const router = useRouter();
  const session = useOnboardingSession();
  const [camino, setCamino] = useState<CaminoOnboarding | null>(null);
  const [error, setError] = useState<string>();
  const [isPending, startTransition] = useTransition();
  const running = useRef(false);
  const busy = isPending || session.busy || !session.ready;

  function run(operation: () => Promise<void>) {
    if (running.current || busy) return;
    running.current = true;
    setError(undefined);
    startTransition(async () => {
      try { await operation(); }
      catch (failure) { setError(failure instanceof Error ? failure.message : "No pudimos guardar tu elección. Intenta de nuevo."); }
      finally { running.current = false; }
    });
  }

  return (
    <OnboardingShell
      title="Bienvenido a VICINO"
      description="Compra y vende cerca de ti. Elige cómo quieres empezar."
      busy={busy}
      footer={
        <OnboardingActions
          onContinue={() => {
            if (session.finalPending) {
              router.push(rutaDePaso("listo", resolverCaminoOnboarding(null, session.profile.onboarding_camino)));
            } else if (camino) run(async () => router.push(await session.selectPath(camino)));
          }}
          continueLabel={session.finalPending ? "Recuperar mi entrada" : "Continuar"}
          disabled={session.blocked || (!camino && !session.finalPending)}
          busy={busy}
        />
      }
    >
      <OnboardingSaveStatus session={session} busy={busy} error={error} onRetry={() => run(async () => {
        const target = await session.retry();
        if (target) router.push(target);
      })} />
      <div className="mb-6 flex justify-center">
        <Image src="/vicino-logo-light-v2.png" alt="" width={88} height={88} className="object-contain show-in-light" priority />
        <Image src="/vicino-logo-dark.png" alt="" width={88} height={88} className="object-contain show-in-dark" priority />
      </div>
      <fieldset disabled={busy || session.finalPending} className="space-y-3">
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
