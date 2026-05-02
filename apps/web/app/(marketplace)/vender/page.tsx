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
    <div className="max-w-2xl mx-auto px-4 py-8 md:py-12 animate-fade-in-up">
      <div className="flex items-center gap-3 mb-8">
        <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-primary shrink-0">
          <PlusCircle className="w-5 h-5" />
        </div>
        <div>
          <h1 className="text-2xl font-heading font-bold">Publicar producto</h1>
          <p className="text-sm text-muted-foreground">Comparte lo que vendes con tu comunidad</p>
        </div>
      </div>
      
      {!profile?.es_vendedor && (
        <div className="mb-8 rounded-2xl bg-amber-50 dark:bg-amber-950/30 p-5 text-sm text-amber-800 dark:text-amber-200 border border-amber-200/50 shadow-sm animate-scale-in">
          <p className="font-semibold mb-1">Tu perfil de vendedor está inactivo</p>
          <p className="opacity-90">
            Para publicar productos, necesitas activar el modo vendedor en{" "}
            <Link href="/perfil" className="underline font-semibold hover:text-amber-900 transition-colors">
              tu perfil
            </Link>
            .
          </p>
        </div>
      )}
      <div className="p-6 md:p-8 rounded-3xl bg-card border border-border/40 shadow-sm">
        <ProductForm />
      </div>
    </div>
  );
}
