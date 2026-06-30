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
    let unmounted = false;
    const supabase = createClient();

    async function fetchProfileWithRetry(session: any, attempt = 1) {
      if (unmounted) return;
      
      try {
        const cacheBusterEmail = `dummy_${Date.now()}@example.com`;
        
        // Usamos fetch nativo para garantizar que el token se envía en el header
        // y evitar problemas de desincronización de sesión interna del cliente Supabase
        const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/profiles?select=has_seen_onboarding&id=eq.${session.user.id}&email=neq.${encodeURIComponent(cacheBusterEmail)}`;
        
        const response = await fetch(url, {
          headers: {
            apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${session.access_token}`,
            Accept: 'application/json',
            Prefer: 'return=representation'
          }
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        // PostgREST devuelve array, single() devuelve el primer elemento
        if (data && data.length > 0) {
          const profile = data[0];
          console.log(`[OnboardingModal] Perfil encontrado (intento ${attempt}):`, profile);
          if (!profile.has_seen_onboarding) {
            setShow(true);
          }
          return;
        } else {
          throw new Error("Perfil no encontrado (array vacío)");
        }
      } catch (err: any) {
        console.error(`[OnboardingModal] Error obteniendo perfil (intento ${attempt}):`, err);
        if (attempt < 5) {
          console.log(`[OnboardingModal] Reintentando en 500ms... (Intento ${attempt + 1}/5)`);
          setTimeout(() => fetchProfileWithRetry(session, attempt + 1), 500);
        } else {
          console.error(`[OnboardingModal] Falló tras 5 intentos. No se pudo cargar el perfil.`);
        }
      }
    }

    // Suscribirnos a los cambios de sesión para no sufrir el "Auth Race Condition"
    const { data: authListener } = supabase.auth.onAuthStateChange(
      (event, session) => {
        if (session?.user && (event === "SIGNED_IN" || event === "INITIAL_SESSION")) {
          fetchProfileWithRetry(session);
        }
      }
    );

    return () => {
      unmounted = true;
      authListener.subscription.unsubscribe();
    };
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
