import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { VerificationUpload } from "./verification-upload";
import { SellerBackButton } from "@/components/layout/seller-back-button";

export const metadata = { title: "Verificación" };

export default async function VerificacionPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: verification } = await supabase
    .from("trust_level_verification")
    .select("*")
    .eq("user_id", user.id)
    .maybeSingle();

  const { data: sellerVerification } = await supabase
    .from("seller_verification")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Consentimiento expreso para datos biometricos (LFPDPPP art. 8). Si ya
  // consintio en una sesion anterior no se le vuelve a pedir: el consentimiento
  // no caduca por cerrar la pestana.
  const { data: yaConsintio } = await supabase.rpc(
    "tiene_consentimiento_biometrico",
    { p_user_id: user.id },
  );

  return (
    <div className="space-y-6 min-w-0">
      <div className="min-w-0">
        <SellerBackButton />
        <h1 className="text-xl font-bold truncate">Verificación</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Sube tus documentos para verificar tu identidad y subir de nivel de
        confianza. Los documentos serán revisados por un administrador.
      </p>

      <VerificationUpload
        userId={user.id}
        verification={verification}
        sellerVerification={sellerVerification}
        yaConsintio={yaConsintio}
      />
    </div>
  );
}
