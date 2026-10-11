import { Suspense, type ReactNode } from "react";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
import { CompletarPerfil } from "./completar-perfil";
import { loadOnboardingProfile, OnboardingLoadError } from "./load-profile";
import { OnboardingSessionProvider } from "./onboarding-session";

export default async function CompletarPerfilLayout({ children }: { children: ReactNode }) {
  const profile = await loadOnboardingProfile();
  if (!profile) return <OnboardingLoadError href="/completar-perfil" />;
  return <Suspense fallback={<OnboardingShell title="Preparando tu perfil"><p role="status">Recuperando tu avance…</p></OnboardingShell>}>
    <OnboardingSessionProvider key={profile.id} profile={profile}><CompletarPerfil />{children}</OnboardingSessionProvider>
  </Suspense>;
}
