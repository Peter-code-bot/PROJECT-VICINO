"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
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
  if (error) return { error: error.message };
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
  await supabase.auth.signOut();
  redirect("/login");
}
