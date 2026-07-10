import Image from "next/image";
import { OnboardingOptions } from "./onboarding-options";

export default function BienvenidaPage() {
  return (
    <div className="flex flex-col items-center justify-center w-full px-4 py-8">
      <div className="mb-8 flex items-center justify-center">
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
      
      <h1 className="text-3xl md:text-4xl font-outfit text-center mb-12 font-semibold">
        ¡Bienvenido a VICINO!
      </h1>
      
      <div className="w-full max-w-3xl">
        <OnboardingOptions />
      </div>
    </div>
  );
}
