"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/app/(marketplace)/perfil/actions";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function OnboardingOptions() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  const handleSeller = () => {
    startTransition(async () => {
      const result = await completeOnboarding();
      if (result.error) {
        toast.error("Error al guardar: " + result.error);
        return;
      }
      router.push("/perfil/editar?prompt=seller-mode");
    });
  };

  const handleBuyer = () => {
    startTransition(async () => {
      const result = await completeOnboarding();
      if (result.error) {
        toast.error("Error al guardar: " + result.error);
        return;
      }
      router.push("/");
    });
  };

  return (
    <div className="flex flex-col md:flex-row gap-4 w-full">
      <Button 
        onClick={handleSeller} 
        loading={isPending}
        variant="primary"
        size="lg"
        className="flex-1 py-12 text-xl md:text-2xl h-auto font-medium"
      >
        Quiero vender
      </Button>
      
      <Button 
        onClick={handleBuyer} 
        loading={isPending}
        variant="secondary"
        size="lg"
        className="flex-1 py-12 text-xl md:text-2xl h-auto font-medium"
      >
        Solo quiero explorar
      </Button>
    </div>
  );
}
