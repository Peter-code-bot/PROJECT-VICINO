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
      />
    </div>
  );
}
