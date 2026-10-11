import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { OnboardingOptions } from "./onboarding-options";

interface BienvenidaPageProps {
  searchParams: Promise<{ elegir?: string }>;
}

export default async function BienvenidaPage({ searchParams }: BienvenidaPageProps) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Already-onboarded users have nothing to do here. A missing profile row
  // still renders the page: completeOnboarding surfaces it as a visible error.
  const { data: profile, error } = await supabase
    .from("profiles")
    .select("has_seen_onboarding, onboarding_camino, onboarding_paso, es_vendedor")
    .eq("id", user.id)
    .single();

  // Se reporta el error pero NO se redirige a ningun sitio: las ramas de abajo
  // usan `profile?.` y con perfil nulo caen solas a los dos botones, que es la
  // salida segura. Redirigir desde aqui es justo lo que crea bucles — esta
  // pantalla es el destino al que apuntan los otros guards.
  //
  // Sin este reporte, un 42501 por una columna sin GRANT se veia igual que un
  // usuario nuevo: los dos botones. Silencioso y con la app entera detras.
  if (error) {
    Sentry.captureException(error, {
      tags: { action: "bienvenida_cargar_perfil" },
      contexts: { supabase: { code: error.code, details: error.details } },
    });
  }

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

  return <OnboardingOptions />;
}
