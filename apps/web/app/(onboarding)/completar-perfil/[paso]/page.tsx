import { redirect } from "next/navigation";
import { esPasoOnboarding, rutaDePaso } from "@/lib/onboarding/steps";

export default async function PasoOnboardingPage({ params, searchParams }: {
  params: Promise<{ paso: string }>;
  searchParams: Promise<{ camino?: string }>;
}) {
  const { paso } = await params;
  if (paso === "activar") {
    const query = await searchParams;
    redirect(rutaDePaso("listo", query.camino === "vender" ? "vender" : undefined));
  }
  if (!esPasoOnboarding(paso)) redirect("/completar-perfil");
  // Persistent layout owns authentication, profile loading and the client form.
  return null;
}
