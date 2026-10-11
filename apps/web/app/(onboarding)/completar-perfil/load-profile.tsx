import Link from "next/link";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import type { Database } from "@/types/database.types";

export type OnboardingProfile = Pick<Database["public"]["Tables"]["profiles"]["Row"],
  "id" | "username" | "nombre" | "bio" | "foto" | "intereses" | "onboarding_camino" |
  "onboarding_paso" | "has_seen_onboarding" | "es_vendedor" | "seller_type" |
  "categoria_negocio" | "nombre_negocio" | "descripcion_negocio" | "metodos_pago_aceptados"
>;

export async function loadOnboardingProfile(): Promise<OnboardingProfile | null> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data, error } = await supabase.from("profiles")
    .select("id, username, nombre, bio, foto, intereses, onboarding_camino, onboarding_paso, has_seen_onboarding, es_vendedor, seller_type, categoria_negocio, nombre_negocio, descripcion_negocio, metodos_pago_aceptados")
    .eq("id", user.id).single();
  if (error || !data) {
    Sentry.captureException(error ?? new Error("Perfil ausente en onboarding"), {
      tags: { action: "completar_perfil_cargar" },
      contexts: { supabase: { code: error?.code } },
    });
    return null;
  }
  if (data.has_seen_onboarding) redirect("/");
  return data;
}

/** Failed reads stay on the current URL; welcome must never create a retry loop. */
export function OnboardingLoadError({ href }: { href: string }) {
  return (
    <OnboardingShell title="No pudimos cargar tu perfil" description="Intenta de nuevo en un momento para continuar desde donde te quedaste."
      footer={<Link href={href} prefetch={false} className="flex min-h-12 items-center justify-center rounded-xl bg-brand px-4 py-3 font-semibold text-primary-foreground">Reintentar</Link>}>
      <p className="text-sm text-fg-muted">No avanzaremos hasta poder recuperar tus datos.</p>
    </OnboardingShell>
  );
}
