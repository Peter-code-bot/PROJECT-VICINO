import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "./product-form";
import { PlusCircle } from "lucide-react";

export const metadata = {
  title: "Publicar producto — VICINO",
};

export default async function VenderPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login?next=/vender");
  }

  // Check if user is a seller
  const { data: profile } = await supabase
    .from("profiles")
    .select("es_vendedor")
    .eq("id", user.id)
    .single();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 md:py-12 animate-fade-in-up">
      <div className="mb-8 flex items-center gap-3">
        <div className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]">
          <PlusCircle className="w-5 h-5" />
        </div>
        <div>
          <div className="text-[10.5px] font-bold uppercase tracking-[0.12em] text-[color:var(--brand-hi)]">
            Publicar gratis
          </div>
          <h1 className="font-heading text-2xl font-bold text-[color:var(--fg)]">
            Publicar producto
          </h1>
          <p className="text-sm text-[color:var(--fg-muted)]">
            Comparte lo que vendes con tu comunidad
          </p>
        </div>
      </div>

      {!profile?.es_vendedor && (
        <div className="mb-8 animate-scale-in rounded-2xl bg-[rgba(212,168,83,0.18)] p-5 text-sm text-[color:var(--fg)] shadow-[inset_0_0_0_1px_rgba(212,168,83,0.30)]">
          <p className="mb-1 font-semibold text-[color:var(--trust-gold)]">
            Tu perfil de vendedor está inactivo
          </p>
          <p className="text-[color:var(--fg-muted)]">
            Para publicar productos, necesitas activar el modo vendedor en{" "}
            <Link
              href="/perfil"
              className="font-semibold text-[color:var(--brand-hi)] underline transition-colors hover:text-[color:var(--brand)]"
            >
              tu perfil
            </Link>
            .
          </p>
        </div>
      )}
      <div className="rounded-3xl bg-[color:var(--card)] p-6 shadow-[inset_0_0_0_1px_var(--border)] md:p-8">
        <ProductForm />
      </div>
    </div>
  );
}
