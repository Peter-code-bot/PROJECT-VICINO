import { redirect } from "next/navigation";
import * as Sentry from "@sentry/nextjs";
import { publicProfileName } from "@vicino/shared";
import { createClient } from "@/lib/supabase/server";
import { resumenNegocio } from "@/lib/lealtad/datos";
import { SellerBackButton } from "@/components/layout/seller-back-button";
import { ProgramaForm } from "./programa-form";

export const metadata = { title: "Configurar tarjeta de lealtad — VICINO" };

export default async function EditarLealtadPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/seller/lealtad/editar");

  const { data: perfil } = await supabase
    .from("profiles")
    .select("nombre, nombre_negocio, es_vendedor, seller_type")
    .eq("id", user.id)
    .maybeSingle();
  const negocio = publicProfileName(perfil, "Mi negocio");

  let programa = null;
  try {
    programa = (await resumenNegocio(supabase)).program;
  } catch (error) {
    Sentry.captureException(error, { tags: { surface: "seller_lealtad_editar", query: "loyalty_resumen_negocio" } });
  }

  return (
    <div className="max-w-3xl space-y-4">
      <div>
        <SellerBackButton fallback="/seller/lealtad" />
        <h1 className="text-xl font-bold">{programa ? "Editar programa" : "Crear programa de lealtad"}</h1>
        <p className="text-sm text-[color:var(--fg-muted)]">
          Un programa por negocio, una recompensa y sellos por compra confirmada. Si cambias las reglas de un
          programa ya publicado, nace una versión nueva y nadie pierde lo acumulado.
        </p>
      </div>
      <ProgramaForm negocio={negocio} inicial={programa} />
    </div>
  );
}
