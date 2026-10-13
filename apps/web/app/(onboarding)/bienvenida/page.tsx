import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { OnboardingOptions } from "./onboarding-options";
import { OnboardingLoadError } from "../completar-perfil/load-profile";

interface BienvenidaPageProps {
  searchParams: Promise<{ elegir?: string }>;
}

export default async function BienvenidaPage({ searchParams }: BienvenidaPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // The selector needs the same canonical frontier as the questions before writing a choice.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("id, username, nombre, bio, foto, intereses, onboarding_camino, onboarding_paso, has_seen_onboarding, es_vendedor, seller_type, categoria_negocio, nombre_negocio, descripcion_negocio, metodos_pago_aceptados, onboarding_revision")
    .eq("id", user.id)
    .single();

  // Report a failed read and retry on this URL. A selector without a canonical
  // profile could overwrite the frontier; redirecting would create a guard loop.
  if (error) {
    Sentry.captureException(error, {
      tags: { action: "bienvenida_cargar_perfil" },
      contexts: { supabase: { code: error.code, details: error.details } },
    });
  }

  if (error || !profile) return <OnboardingLoadError href="/bienvenida?elegir=1" />;

  if (profile?.has_seen_onboarding) redirect("/");

  // Resume by default. A deliberate back action may reopen the path selector
  // without trapping someone who changed their mind about becoming a seller.
  const elegirDeNuevo = (await searchParams).elegir === "1";
  if (!elegirDeNuevo && profile?.onboarding_paso) redirect("/completar-perfil");

  // Ya es vendedor pero sin paso marcado. Es la ventana entre
  // activar_modo_vendedor y guardar_paso_onboarding: si la segunda falla,
  // es_vendedor queda en true y onboarding_paso en null. Sin esta rama esa
  // persona volveria a los dos botones y al tocar «Quiero vender» aterrizaria
  // otra vez en un alta que ya completo.
  //
  // Se mira es_vendedor y NO onboarding_camino. Reenviar por el camino elegido
  // era justo lo que encerraba a quien tocaba «Quiero vender» y se arrepentia:
  // /bienvenida lo devolvia al alta en cada visita y no habia forma de salir.
  // Un camino elegido es una intencion; ser vendedor es un hecho, y solo un
  // hecho deberia poder redirigir en bucle.
  if (!elegirDeNuevo && profile?.es_vendedor) redirect("/completar-perfil");

  return <OnboardingOptions profile={profile} />;
}
