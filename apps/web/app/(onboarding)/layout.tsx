import { OnboardingViewport } from "@/components/onboarding/onboarding-shell";

export default function OnboardingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <OnboardingViewport>{children}</OnboardingViewport>;
}
