"use client";

// MP#08 / SDD apk-google-oauth: deep link listener para el flujo de Google OAuth
// del APK. Captura vicino://auth/callback?code=... (delivered by Android al
// intent-filter en AndroidManifest.xml:32-38), intercambia el code por session
// Supabase y cierra el Custom Tab. En web es no-op (early return en useEffect).
//
// Ver openspec/changes/2026-06-01-apk-google-oauth-custom-tab/ para spec.

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { App, type URLOpenListenerEvent } from "@capacitor/app";
import { Browser } from "@capacitor/browser";
import { Capacitor } from "@capacitor/core";
import { createClient } from "@/lib/supabase/client";

const DEEP_LINK_PREFIX = "vicino://auth/callback";

export function OAuthUrlListener() {
  const router = useRouter();
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
      if (!url.startsWith(DEEP_LINK_PREFIX)) return;
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

      const { error } = await supabase.auth.exchangeCodeForSession(code);
      // Cerrar el Custom Tab regardless of success -- user ya esta de vuelta
      // en la app via el deep link.
      await Browser.close().catch(() => {});
      if (unmounted) return;
      if (error) {
        router.push("/login?error=auth_callback_failed");
        return;
      }
      // F2 (optimize-auth-session-hydration): hard navigation to eliminate the
      // guest-state flash. router.push + router.refresh creates a window where
      // the cached unauthenticated layout paints before the server revalidation
      // completes. window.location.replace sends the new session cookie in the
      // GET / request and the server returns the authenticated layout on first
      // paint. Destination is hardcoded ("/") — no open redirect risk.
      //
      // NOTE: useRouter / router is retained for the error paths above
      // (lines ~57 and ~68: router.push to /login?error=...). Do NOT remove the
      // useRouter import if you only see this success branch.
      window.location.replace("/");
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

  return null;
}
