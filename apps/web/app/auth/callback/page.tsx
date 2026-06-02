"use client";

// MP#08 / SDD apk-google-oauth: loader page para evitar el flash 404 que aparecia
// cuando Capacitor inicializa el WebView en /auth/callback. Sin page.tsx, Next
// disparaba not-found.tsx mientras el listener procesaba el code.
//
// Branching por plataforma:
// - APK (Capacitor.isNativePlatform()): solo muestra loader. El OAuthUrlListener
//   (apps/web/components/auth/oauth-url-listener.tsx) procesa el code via
//   appUrlOpen y redirige a /. Este page NO procesa el code en APK para evitar
//   doble exchangeCodeForSession (no es idempotente: el segundo call falla con
//   "code already used"). Safety net: redirige a / despues de 10 seg si el
//   listener no nos saco (ya estariamos logueados por el exchange server-side).
// - Web: el flujo web NO llega aqui en el camino feliz post-fix (web va directo
//   a /auth/callback-server donde vive el route.ts handler server-side). Si
//   alguien aterriza aqui por algun motivo (URL legacy compartida, bookmark
//   antiguo), redirigimos al home inmediatamente como fallback safe.

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Capacitor } from "@capacitor/core";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    if (Capacitor.isNativePlatform()) {
      // Safety net APK: si el listener no nos saca en 10 seg, ir al home.
      // El exchange normalmente termina en <500ms, asi que 10s es margen amplio.
      const t = setTimeout(() => router.replace("/"), 10000);
      return () => clearTimeout(t);
    }
    // Web fallback: ruta legacy, redirigir al home.
    router.replace("/");
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="text-center space-y-4">
        <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        <p className="text-sm text-muted-foreground">Completando inicio de sesión...</p>
      </div>
    </div>
  );
}
