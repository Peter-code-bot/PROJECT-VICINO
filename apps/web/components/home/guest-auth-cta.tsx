"use client";

import AuthLink from "@/components/auth/auth-link";
import { useMuroSesion } from "@/components/auth/muro-sesion";
import { destinoAutenticadoSeguro } from "@/lib/auth/destino-seguro";

/** Visible from the server-rendered session state, without an account lookup.
 * The focus color overrides the unlayered global :focus-visible rule so the
 * foreground token remains readable in both themes.
 */
export function GuestAuthCta({ destino = "/" }: { destino?: string }) {
  const { haySesion } = useMuroSesion();
  if (haySesion) return null;

  const next = encodeURIComponent(destinoAutenticadoSeguro(destino));
  return (
    <section id="home-guest-auth" aria-label="Accede a VICINO" className="px-4 pb-4">
      <div className="mx-auto flex max-w-7xl flex-col gap-1 rounded-2xl bg-card p-3 shadow-[inset_0_0_0_1px_var(--border)] sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <AuthLink
          id="home-create-account"
          href={`/register?next=${next}`}
          prefetch={false}
          className="inline-flex min-h-12 items-center justify-center rounded-xl bg-brand px-6 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-colors hover:bg-brand-dark focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg!"
        >
          Únete a VICINO
        </AuthLink>
        <AuthLink
          id="home-sign-in"
          href={`/login?next=${next}`}
          prefetch={false}
          className="inline-flex min-h-11 items-center justify-center rounded-lg px-2 text-sm font-medium text-brand hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-fg! dark:text-fg"
        >
          Ya tengo cuenta · Iniciar sesión
        </AuthLink>
      </div>
    </section>
  );
}
