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
import { guardarDestinoPendiente } from "@/lib/auth/destino-pendiente";

/**
 * A donde volver despues de identificarse.
 *
 * Hasta ahora NINGUNO de los dos caminos de OAuth llevaba destino: el
 * redirectTo era el callback pelado, asi que quien pulsaba "Quiero comprarlo"
 * sin sesion, entraba con Google y aterrizaba en la portada, sin el producto.
 * Es el mismo agujero que ya se cerro para el login por email.
 *
 * Los dos caminos NO pueden resolverlo igual:
 *   - Web: el destino viaja en la query del redirectTo. Es el patron que este
 *     repo YA usa en forgot-password, asi que se sabe que la lista de
 *     direcciones permitidas de Supabase lo acepta.
 *   - Nativo: NO puede. El retorno es el deep link vicino://auth/callback, y
 *     esa direccion tiene que coincidir EXACTAMENTE con la registrada en
 *     Supabase y en el intent-filter del AndroidManifest; anadirle una query
 *     la rompe. Por eso ahi el destino se esconde antes de salir y
 *     OAuthUrlListener lo recoge al volver.
 */
function destinoWeb(destino?: string): string {
  const base = `${window.location.origin}/auth/callback-server`;
  return destino && destino !== "/"
    ? `${base}?next=${encodeURIComponent(destino)}`
    : base;
}

export async function signInWithGoogle(destino?: string): Promise<{ error?: string }> {
  const supabase = createClient();

  if (Capacitor.isNativePlatform()) {
    if (destino) guardarDestinoPendiente(destino);
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
      redirectTo: destinoWeb(destino),
    },
  });
  if (error) return { error: "Error al conectar con Google. Intenta de nuevo." };
  return {};
}

// signInWithApple: mismo patrón que signInWithGoogle. Apple devuelve el code via
// el mismo OAUTH_DEEP_LINK_CALLBACK; el OAuthUrlListener lo procesa indistintamente
// del provider (exchangeCodeForSession es PKCE-genérico). Email relay
// `@privaterelay.appleid.com` se trata como email válido (no rechazarlo).
export async function signInWithApple(destino?: string): Promise<{ error?: string }> {
  const supabase = createClient();

  if (Capacitor.isNativePlatform()) {
    if (destino) guardarDestinoPendiente(destino);
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "apple",
      options: {
        redirectTo: OAUTH_DEEP_LINK_CALLBACK,
        skipBrowserRedirect: true,
      },
    });
    if (error) return { error: "Error al conectar con Apple. Intenta de nuevo." };
    if (!data?.url) return { error: "No se pudo iniciar el flujo de Apple." };
    try {
      await Browser.open({ url: data.url, presentationStyle: "popover" });
    } catch {
      return { error: "No se pudo abrir el navegador para Apple. Verifica que tengas un navegador compatible." };
    }
    return {};
  }

  const { error } = await supabase.auth.signInWithOAuth({
    provider: "apple",
    options: {
      redirectTo: destinoWeb(destino),
    },
  });
  if (error) return { error: "Error al conectar con Apple. Intenta de nuevo." };
  return {};
}
