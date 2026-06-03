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
//   Por que NO hacemos forward al callback-server en APK: el flujo OAuth nativo
//   llega aqui SOLO como race fallback (el listener ya consumio el code), asi
//   que el code ya esta usado y un segundo exchange fallaria con "code already
//   used". Mantener el comportamiento de pre-fix (10s safety-net) es correcto.
// - Web: el flujo web NUEVO (post commit 5c7b5e9 de esta rama) va directo a
//   /auth/callback-server. Pero los recovery emails ENVIADOS antes del fix
//   apuntan al path viejo /auth/callback y siguen vivos en bandejas de entrada
//   (Supabase no los invalida hasta que se clickeen). Para esos legacy emails:
//   si la URL trae ?code=..., reenviamos al server handler preservando el
//   search completo (incluido el ?next=... si lo trae). Sin ?code= caemos al
//   redirect-to-home de siempre (bookmarks/URLs sin contexto auth).

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
    // Web branch.
    //
    // MED-1 fix (CODEX follow-up de esta rama): legacy recovery emails
    // enviados antes del fix del commit 1 apuntan a /auth/callback?code=...
    // y siguen vivos en bandejas de entrada. Sin este forward esos emails
    // silenciosamente caen al router.replace("/") y el code se descarta sin
    // exchange. Si la URL trae ?code= reenviamos al server handler que
    // sabe procesarlo (preservando todo el search, incluido el ?next=).
    // Limitado al branch web por diseno: el flujo OAuth nativo del APK NO
    // toca este path HTTPS (usa el deep link vicino://auth/callback que el
    // OAuthUrlListener procesa via appUrlOpen).
    const search = window.location.search;
    if (search.includes("code=")) {
      router.replace(`/auth/callback-server${search}`);
      return;
    }
    // Sin code= -- bookmark / URL compartida legacy sin contexto auth.
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
