import Image from "next/image";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { OnboardingOptions } from "./onboarding-options";

export default async function BienvenidaPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  // Already-onboarded users have nothing to do here. A missing profile row
  // still renders the page: completeOnboarding surfaces it as a visible error.
  const { data: profile } = await supabase
    .from("profiles")
    .select("has_seen_onboarding")
    .eq("id", user.id)
    .single();

  if (profile?.has_seen_onboarding) redirect("/");

  return (
    <div className="flex flex-col items-center justify-center w-full px-4 py-8">
      <div className="mb-6 flex items-center justify-center">
        <Image 
          src="/vicino-logo-light-v2.png" 
          alt="VICINO Logo" 
          width={120} 
          height={120} 
          className="object-contain show-in-light"
          priority
        />
        <Image 
          src="/vicino-logo-dark.png" 
          alt="VICINO Logo" 
          width={120} 
          height={120} 
          className="object-contain show-in-dark"
          priority
        />
      </div>
      
      <h1 className="text-3xl md:text-4xl font-outfit text-center font-semibold">
        ¡Bienvenido a VICINO!
      </h1>
      <p className="text-base text-muted-foreground text-center mt-3 mb-10">
        Compra y vende cerca de ti
      </p>
      
      <div className="w-full max-w-sm">
        <OnboardingOptions />
      </div>
    </div>
  );
}
