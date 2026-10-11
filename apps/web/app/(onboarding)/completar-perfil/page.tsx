import { redirect } from "next/navigation";
import { pasoParaReanudar, rutaDePaso, type CaminoOnboarding } from "@/lib/onboarding/steps";
import { loadOnboardingProfile, OnboardingLoadError } from "./load-profile";

export default async function CompletarPerfilPage({ searchParams }: {
  searchParams: Promise<{ camino?: string }>;
}) {
  const profile = await loadOnboardingProfile();
  if (!profile) return <OnboardingLoadError href="/completar-perfil" />;
  const query = await searchParams;
  const camino: CaminoOnboarding = query.camino === "vender" || profile.onboarding_camino === "vender"
    ? "vender" : "explorar";
  const step = pasoParaReanudar(profile.onboarding_paso, {
    camino, tipo: profile.seller_type === "business" ? "business" : "casual",
  });
  redirect(rutaDePaso(step, camino));
}
