import { redirect } from "next/navigation";
import { esPasoOnboarding, pasosDelCamino, rutaDePaso, type CaminoOnboarding } from "@/lib/onboarding/steps";
import { CompletarPerfil } from "../completar-perfil";
import { loadOnboardingProfile, OnboardingLoadError } from "../load-profile";

export default async function PasoOnboardingPage({ params, searchParams }: {
  params: Promise<{ paso: string }>;
  searchParams: Promise<{ camino?: string }>;
}) {
  const { paso } = await params;
  if (!esPasoOnboarding(paso)) redirect("/completar-perfil");
  const profile = await loadOnboardingProfile();
  const query = await searchParams;
  const camino: CaminoOnboarding = query.camino === "vender" || profile?.onboarding_camino === "vender"
    ? "vender" : "explorar";
  if (!profile) return <OnboardingLoadError href={rutaDePaso(paso, camino)} />;
  if (!pasosDelCamino({ camino, tipo: profile.seller_type === "business" ? "business" : "casual" }).includes(paso)) {
    redirect("/completar-perfil");
  }
  return <CompletarPerfil key={`${profile.id}:${paso}`} profile={profile} paso={paso} camino={camino} />;
}
