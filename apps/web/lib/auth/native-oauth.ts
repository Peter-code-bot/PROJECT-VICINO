// MP#08 / SDD apk-google-oauth: branching helper para Google OAuth.
// En APK (Capacitor.isNativePlatform()) abrimos el flujo en un Chrome Custom Tab
// porque Google bloquea OAuth dentro de WebViews con Error 403
// disallowed_useragent. El retorno se hace por deep link vicino://auth/callback
// que captura OAuthUrlListener montado en el layout raiz.
// En web, el comportamiento es byte-identical al codigo previo de
// login-form.tsx y register-form.tsx (signInWithOAuth con redirectTo HTTPS).
//
// Ver openspec/changes/2026-06-01-apk-google-oauth-custom-tab/ para spec.

import { Capacitor } from "@capacitor/core";
import { Browser } from "@capacitor/browser";
import { createClient } from "@/lib/supabase/client";
import { OAUTH_DEEP_LINK_CALLBACK } from "@/lib/auth/deep-link-constants";

export async function signInWithGoogle(): Promise<{ error?: string }> {
  const supabase = createClient();

  if (Capacitor.isNativePlatform()) {
    // APK path: Supabase devuelve el URL sin redirigir (skipBrowserRedirect),
    // lo abrimos en Custom Tab. El retorno cae en OAuthUrlListener via
    // intent-filter vicino:// (AndroidManifest.xml:32-38).
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: OAUTH_DEEP_LINK_CALLBACK,
        skipBrowserRedirect: true,
      },
    });
    if (error) return { error: "Error al conectar con Google. Intenta de nuevo." };
    if (!data?.url) return { error: "No se pudo iniciar el flujo de Google." };
    try {
      await Browser.open({ url: data.url, presentationStyle: "popover" });
    } catch {
      // Edge: device sin Chrome / Custom Tabs (raro en Android moderno con
      // GMS). Mensaje user-friendly en lugar de excepcion no manejada.
      return { error: "No se pudo abrir el navegador para Google. Verifica que tengas Chrome o un navegador compatible." };
    }
    return {};
  }

  // Web path: signInWithOAuth con redirectTo al route.ts server-side handler.
  // Post fix(auth) 404 flash: route.ts vive ahora en /auth/callback-server (el
  // path /auth/callback es el page.tsx loader que sirve al deep link APK).
  const { error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${window.location.origin}/auth/callback-server`,
    },
  });
  if (error) return { error: "Error al conectar con Google. Intenta de nuevo." };
  return {};
}
