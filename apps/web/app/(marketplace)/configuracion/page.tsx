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
    <div className="max-w-lg mx-auto px-4 py-8 space-y-6 animate-fade-in-up">
      <h1 className="text-2xl font-bold font-heading">Configuración</h1>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
          Cuenta
        </h2>
        <div className="rounded-2xl border border-border/40 bg-card overflow-hidden divide-y divide-border/40">
          <Link
            href="/perfil/editar"
            className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-sm"
          >
            <User className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1">Editar perfil</span>
          </Link>
          <Link
            href="/privacidad"
            className="flex items-center gap-3 px-4 py-3 hover:bg-muted transition-colors text-sm"
          >
            <Shield className="h-4 w-4 text-muted-foreground shrink-0" />
            <span className="flex-1">Política de privacidad</span>
          </Link>
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
          Sesión
        </h2>
        <LogoutSection />
      </section>

      <section className="space-y-2">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1">
          Zona peligrosa
        </h2>
        <DeleteAccountSection />
      </section>
    </div>
  );
}
