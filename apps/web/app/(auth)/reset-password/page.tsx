import { createClient } from "@/lib/supabase/server";
import { usuarioOInvitado } from "@/lib/session-auth";
import { ResetPasswordForm } from "./reset-password-form";
import { destinoAutenticadoSeguro } from "@/lib/auth/destino-seguro";
import Link from "next/link";

export default async function ResetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = destinoAutenticadoSeguro((await searchParams).next);
  const user = await usuarioOInvitado(await createClient());
  return <div className="flex min-h-screen items-center justify-center bg-auth-page-bg px-4 py-12">
    <div className="w-full max-w-sm space-y-5 rounded-3xl border border-border bg-auth-card p-6">
      <h1 className="font-heading text-2xl font-bold">Cambia tu contraseña</h1>
      {user ? <ResetPasswordForm destino={next} /> : <><p>El enlace venció o no está disponible. Solicita uno nuevo.</p><Link href={`/forgot-password?next=${encodeURIComponent(next)}`} className="text-primary">Recuperar contraseña</Link></>}
    </div>
  </div>;
}
