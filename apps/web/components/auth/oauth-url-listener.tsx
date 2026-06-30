"use client";

// MP#08 / SDD apk-google-oauth: deep link listener para el flujo de Google OAuth
// del APK. Captura vicino://auth/callback?code=... (delivered by Android al
// intent-filter en AndroidManifest.xml:32-38), intercambia el code por session
// Supabase y cierra el Custom Tab. En web es no-op (early return en useEffect).
//
// Ver openspec/changes/2026-06-01-apk-google-oauth-custom-tab/ para spec.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";
import { OAUTH_DEEP_LINK_CALLBACK } from "@/lib/auth/deep-link-constants";
import { Loader2 } from "lucide-react";

export function OAuthUrlListener() {
  const router = useRouter();
  const [isProcessing, setIsProcessing] = useState(false);
  // CODEX C1: guard contra doble-procesamiento del mismo URL (cold-launch
  // de getLaunchUrl + remount del effect bajo router dep). exchangeCodeFor-
  // Session no es idempotente: segunda llamada con el mismo code falla y
  // descarrila el redirect a home.
  const processedUrlsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;

    let unmounted = false;
    const supabase = createClient();
    const processedUrls = processedUrlsRef.current;

    async function handleUrl(url: string) {
      if (unmounted) return;
      
      // Intercept both custom scheme OAuth callbacks and Universal Link email callbacks.
      // By exchanging the code client-side in the WebView, we guarantee access to the
      // PKCE cookie and avoid fragile server-side GET requests that email scanners break.
      const isCustomScheme = url.startsWith(OAUTH_DEEP_LINK_CALLBACK);
      const isUniversalLink = url.startsWith("https://vicinomarket.com/auth/callback");
      
      if (!isCustomScheme && !isUniversalLink) return;
      
      if (processedUrls.has(url)) return; // CODEX C1: ya procesado.
      processedUrls.add(url);

      let code: string | null = null;
      let errorParam: string | null = null;
      try {
        const parsed = new URL(url);
        code = parsed.searchParams.get("code");
        errorParam = parsed.searchParams.get("error");
      } catch {
        // URL malformada -> ignorar; no es un retorno OAuth valido.
        return;
      }

      // CODEX I2: Supabase puede redirigir con ?error=... (user denego scope,
      // cancelo en la pantalla Google, etc.). Sin manejarlo el user queda
      // visualmente esperando a algo que nunca llega.
      if (errorParam) {
        await Browser.close().catch(() => {});
        if (unmounted) return;
        router.push(`/login?error=${encodeURIComponent(errorParam)}`);
        return;
      }
      if (!code) return;

      setIsProcessing(true);

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      // Cerrar el Custom Tab regardless of success -- user ya esta de vuelta
      // en la app via el deep link.
      await Browser.close().catch(() => {});
      
      if (unmounted) return;
      
      if (error) {
        setIsProcessing(false);
        router.push("/login?error=auth_callback_failed");
        return;
      }

      // Bugfix: En iOS WKWebView, document.cookie (usado por @supabase/ssr) 
      // tarda unos milisegundos en sincronizarse con el proceso de red nativo.
      // Si usamos window.location.replace("/"), la petición de recarga completa (GET HTML)
      // la hace la capa nativa y puede irse SIN la cookie, renderizando la sesión como Guest.
      // Solución: Usar navegación del cliente de Next.js. El router usa fetch() internamente
      // para obtener el layout RSC, el cual lee el document.cookie de forma síncrona en JS.
      router.refresh();
      setTimeout(() => {
        if (!unmounted) {
          router.replace("/");
        }
      }, 50);
    }

    // Cold-launch: app fue iniciada POR el deep link.
    App.getLaunchUrl().then((res) => {
      if (res?.url) void handleUrl(res.url);
    });

    // Hot-launch: app ya estaba corriendo cuando el deep link llego.
    const subPromise = App.addListener("appUrlOpen", (event: URLOpenListenerEvent) => {
      void handleUrl(event.url);
    });

    return () => {
      unmounted = true;
      void subPromise.then((s) => s.remove());
    };
  }, [router]);

  if (!isProcessing) return null;

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm">
      <Loader2 className="mb-4 h-10 w-10 animate-spin text-primary" />
      <p className="text-lg font-medium text-foreground">Completando inicio de sesión...</p>
    </div>
  );
}
