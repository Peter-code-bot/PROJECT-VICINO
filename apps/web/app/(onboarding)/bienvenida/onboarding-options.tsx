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
    <div className="flex flex-col gap-3 w-full">
      <Button 
        onClick={handleSeller} 
        loading={isPending}
        variant="primary"
        size="lg"
        className="w-full py-4 text-lg h-auto font-medium rounded-xl !bg-[#121212] !text-white !shadow-none dark:!bg-[#F4F1EB] dark:!text-[#121212]"
      >
        Quiero vender
      </Button>
      
      <Button 
        onClick={handleBuyer} 
        loading={isPending}
        variant="primary"
        size="lg"
        className="w-full py-4 text-lg h-auto font-medium rounded-xl !bg-brand-hi !text-white !shadow-none"
      >
        Solo quiero explorar
      </Button>
    </div>
  );
}
