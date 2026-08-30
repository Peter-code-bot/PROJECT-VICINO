import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "./product-form";

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
    <div className="mx-auto max-w-2xl px-4 py-6 md:py-10 animate-fade-in-up">
      <ProductForm userId={user.id} sellerInactive={!profile?.es_vendedor} />
    </div>
  );
}
