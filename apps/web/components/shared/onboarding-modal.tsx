"use client";

import { useState, useTransition, useEffect } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { completeOnboarding } from "@/app/(marketplace)/perfil/actions";
import { useRouter } from "next/navigation";
import { Store, ShoppingBag, Loader2 } from "lucide-react";

import { createClient } from "@/lib/supabase/client";

export function OnboardingModal() {
  const [show, setShow] = useState(false);
  const [closed, setClosed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  useEffect(() => {
    async function checkOnboarding() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from("profiles")
        .select("has_seen_onboarding")
        .eq("id", user.id)
        .single();
      
      if (!error && data && data.has_seen_onboarding === false) {
        setShow(true);
      }
    }
    
    checkOnboarding();
  }, []);

  if (!show || closed) return null;

  const handleSeller = () => {
    startTransition(async () => {
      await completeOnboarding();
      setClosed(true);
      router.push("/perfil/editar?prompt=seller-mode");
    });
  };

  const handleBuyer = () => {
    startTransition(async () => {
      await completeOnboarding();
      setClosed(true);
    });
  };

  return (
    <Dialog open={true} onOpenChange={(val) => {
      // Evitar que lo cierren clickeando afuera si queremos forzar la decisión, 
      // pero por amigabilidad permitimos que se cierre y cuenta como "omitido por ahora".
      // Para respetar el onboarding strict, no los dejamos cerrar sin elegir.
    }}>
      <DialogContent className="sm:max-w-md [&>button]:hidden">
        <DialogHeader>
          <DialogTitle className="text-2xl text-center font-outfit">
            ¡Bienvenido a VICINO!
          </DialogTitle>
          <DialogDescription className="text-center pt-2 text-base">
            ¿Quieres empezar a vender y ganar dinero ofreciendo tus servicios a la vuelta de la esquina, o prefieres solo explorar y comprar por ahora?
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3 mt-4">
          <Button 
            onClick={handleSeller} 
            disabled={isPending}
            variant="primary"
            size="lg"
            className="w-full"
          >
            {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <Store className="w-5 h-5" />}
            ¡Quiero Vender!
          </Button>
          
          <Button 
            onClick={handleBuyer} 
            disabled={isPending}
            variant="secondary"
            size="lg"
            className="w-full"
          >
            {isPending ? <Loader2 className="w-5 h-5 animate-spin" /> : <ShoppingBag className="w-5 h-5" />}
            Solo quiero comprar por ahora
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
