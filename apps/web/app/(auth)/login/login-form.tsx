"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { ArrowRight, Loader2 } from "lucide-react";

export function LoginForm() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const supabase = createClient();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      const msg = error.message.toLowerCase();
      if (msg.includes("invalid login credentials")) {
        setError("Email o contraseña incorrectos");
      } else if (msg.includes("email not confirmed")) {
        setError("Debes confirmar tu email antes de iniciar sesión. Revisa tu bandeja de entrada.");
      } else if (msg.includes("too many requests")) {
        setError("Demasiados intentos. Espera un momento e intenta de nuevo.");
      } else {
        setError("Error al iniciar sesión. Intenta de nuevo.");
      }
      setLoading(false);
      return;
    }

    router.push("/");
    router.refresh();
  }

  async function handleGoogleLogin() {
    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
      },
    });
    if (error) setError("Error al conectar con Google. Intenta de nuevo.");
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {error && (
        <div className="rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-950/20 p-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-2">
        <label htmlFor="email" className="text-sm font-medium text-foreground/80">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="tu@email.com"
          className="w-full rounded-xl border border-border/50 bg-white/50 dark:bg-neutral-900/50 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20"
        />
      </div>

      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label htmlFor="password" className="text-sm font-medium text-foreground/80">
            Contraseña
          </label>
          <Link
            href="/forgot-password"
            className="text-xs font-medium text-terracotta hover:text-terracotta-dark transition-colors"
          >
            ¿Olvidaste?
          </Link>
        </div>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          placeholder="••••••••"
          className="w-full rounded-xl border border-border/50 bg-white/50 dark:bg-neutral-900/50 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
        className="group relative flex w-full items-center justify-center gap-2 rounded-xl bg-bone px-4 py-3 text-sm font-semibold text-bone-contrast shadow-sm transition-all duration-200 hover:bg-bone-dark hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none mt-2"
      >
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <>
            Iniciar sesión
            <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-1" />
          </>
        )}
      </button>

      <div className="relative py-2">
        <div className="absolute inset-0 flex items-center">
          <span className="w-full border-t border-border/50" />
        </div>
        <div className="relative flex justify-center text-xs uppercase">
          <span className="bg-card px-3 text-muted-foreground/60 font-medium tracking-wider">o continuar con</span>
        </div>
      </div>

      <button
        type="button"
        onClick={handleGoogleLogin}
        className="flex w-full items-center justify-center gap-3 rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm font-medium transition-colors hover:bg-neutral-50 dark:hover:bg-neutral-800"
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" aria-hidden="true">
          <path d="M12.0003 4.75C13.7703 4.75 15.3553 5.36002 16.6053 6.54998L20.0303 3.125C17.9502 1.19 15.2353 0 12.0003 0C7.31028 0 3.25527 2.69 1.28027 6.60998L5.27028 9.70498C6.21525 6.86002 8.87028 4.75 12.0003 4.75Z" fill="#EA4335" />
          <path d="M23.49 12.275C23.49 11.49 23.415 10.73 23.3 10H12V14.51H18.47C18.18 15.99 17.34 17.25 16.08 18.1L19.945 21.1C22.2 19.01 23.49 15.92 23.49 12.275Z" fill="#4285F4" />
          <path d="M5.26498 14.2949C5.02498 13.5699 4.88501 12.7999 4.88501 11.9999C4.88501 11.1999 5.01998 10.4299 5.26498 9.7049L1.275 6.60986C0.46 8.22986 0 10.0599 0 11.9999C0 13.9399 0.46 15.7699 1.28 17.3899L5.26498 14.2949Z" fill="#FBBC05" />
          <path d="M12.0004 24.0001C15.2404 24.0001 17.9654 22.935 19.9454 21.095L16.0804 18.095C15.0054 18.82 13.6204 19.245 12.0004 19.245C8.8704 19.245 6.21537 17.135 5.26538 14.29L1.27539 17.385C3.25539 21.31 7.3104 24.0001 12.0004 24.0001Z" fill="#34A853" />
        </svg>
        Google
      </button>

      <p className="text-center text-sm text-muted-foreground pt-2">
        ¿No tienes cuenta?{" "}
        <Link href="/register" className="font-semibold text-terracotta hover:underline">
          Regístrate gratis
        </Link>
      </p>
    </form>
  );
}
