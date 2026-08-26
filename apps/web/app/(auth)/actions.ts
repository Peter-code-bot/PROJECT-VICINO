"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { authRateLimit, enforce, getClientIp } from "@/lib/rate-limit";

// Auth-page forms (login, register, forgot-password) submit through these
// server actions instead of calling supabase.auth.* directly from the
// browser. The earlier middleware-only tier was bypassable: the supabase
// client opens a direct connection to *.supabase.co/auth/v1/* and never
// hits Next.js, so a rate limit on /login page loads protects nothing.
// Routing the credential submission through a server action puts our
// throttle in front of every actual attempt.

async function throttleAuth() {
  const ip = getClientIp(await headers());
  return enforce(authRateLimit, `auth:${ip}`);
}

export async function signInWithPassword(email: string, password: string) {
  const rate = await throttleAuth();
  if (!rate.ok) return { error: rate.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) return { error: error.message };
  return { success: true };
}

export async function signUp(email: string, password: string, fullName: string) {
  const rate = await throttleAuth();
  if (!rate.ok) return { error: rate.error };

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  });
  if (error) {
    // GoTrue failures (SMTP rate limit, auth.users trigger errors) reach the
    // user as a generic message; keep the literal cause in the server logs.
    console.error("[signUp] GoTrue error:", error.status, error.message);
    return { error: error.message };
  }
  return { hasSession: Boolean(data.session) };
}

export async function requestPasswordReset(email: string, redirectTo: string) {
  const rate = await throttleAuth();
  if (!rate.ok) return { error: rate.error };

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(email, { redirectTo });
  if (error) return { error: error.message };
  return { success: true };
}

export async function signOut() {
  const supabase = await createClient();

  // Mismo motivo que en useLogout: el token de push es por dispositivo, asi que
  // si no se suelta al salir, las notificaciones de quien se va aterrizan en la
  // pantalla de quien entre despues en ese telefono. Va ANTES del signOut, que
  // es cuando todavia hay permiso para escribir en el perfil, y es best-effort:
  // que falle no puede impedir cerrar sesion.
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { error: tokenError } = await supabase
      .from("profiles")
      .update({ fcm_token: null })
      .eq("id", user.id);
    if (tokenError) {
      Sentry.captureException(tokenError, {
        tags: { action: "signOut", step: "clear_fcm_token" },
        level: "warning",
      });
    }
  }

  const { error } = await supabase.auth.signOut();
  // auth-js sale de _signOut() ANTES de _removeSession() cuando el fallo no es
  // 401/403/404, asi que la cookie de sesion sobrevive. Redirigir igual mandaria
  // a /login a alguien que sigue autenticado, creyendo que cerro sesion.
  if (error) {
    Sentry.captureException(error, {
      tags: { action: "signOut" },
      contexts: { auth: { name: error.name, status: error.status ?? null } },
    });
    return { error: "No se pudo cerrar tu sesión. Revisa tu conexión e inténtalo de nuevo." };
  }
  redirect("/login");
}
