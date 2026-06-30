import Image from "next/image";
import { OnboardingOptions } from "./onboarding-options";

export default function BienvenidaPage() {
  return (
    <div className="flex flex-col items-center justify-center w-full px-4 py-8">
      <div className="mb-8">
        <Image 
          src="/vicino-logo-transparent.png" 
          alt="VICINO Logo" 
          width={150} 
          height={50} 
          className="object-contain dark:invert"
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
