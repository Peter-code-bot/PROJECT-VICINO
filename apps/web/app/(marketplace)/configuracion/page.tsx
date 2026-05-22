import { createClient } from "@/lib/supabase/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import { User, Shield } from "lucide-react";
import { LogoutSection } from "./logout-section";
import { DeleteAccountSection } from "./delete-account-section";

export default async function ConfiguracionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/configuracion");

  return (
    <div className="mx-auto max-w-lg space-y-6 px-4 py-8 animate-fade-in-up">
      <div>
        <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">
          Tu cuenta
        </div>
        <h1 className="font-heading text-2xl font-bold text-[color:var(--fg)]">
          Configuración
        </h1>
      </div>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--fg-dim)]">
          Cuenta
        </h2>
        <div className="overflow-hidden rounded-2xl bg-[color:var(--card)] shadow-[inset_0_0_0_1px_var(--border)]">
          <Link
            href="/perfil/editar"
            className="flex items-center gap-3 px-4 py-3 text-sm text-[color:var(--fg)] transition-colors shadow-[inset_0_-1px_0_0_var(--border)] hover:bg-[color:var(--bg-elev-2)]/60"
          >
            <User className="h-4 w-4 shrink-0 text-[color:var(--brand-hi)]" />
            <span className="flex-1">Editar perfil</span>
          </Link>
          <Link
            href="/privacidad"
            className="flex items-center gap-3 px-4 py-3 text-sm text-[color:var(--fg)] transition-colors hover:bg-[color:var(--bg-elev-2)]/60"
          >
            <Shield className="h-4 w-4 shrink-0 text-[color:var(--brand-hi)]" />
            <span className="flex-1">Política de privacidad</span>
          </Link>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--fg-dim)]">
          Sesión
        </h2>
        <LogoutSection />
      </section>

      <section className="space-y-2">
        <h2 className="px-1 text-xs font-semibold uppercase tracking-wider text-[color:var(--danger)]">
          Zona peligrosa
        </h2>
        <DeleteAccountSection />
      </section>
    </div>
  );
}
