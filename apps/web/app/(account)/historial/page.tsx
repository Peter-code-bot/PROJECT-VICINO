import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { HistorialTabs } from "./historial-tabs";
import { Home } from "lucide-react";
import { loadHistorial } from "@/lib/historial/data";
import { parseHistorialLocation, type HistorialParams } from "@/lib/historial/navigation";

export const metadata = {
  title: "Historial",
};

export default async function HistorialPage({ searchParams }: { searchParams: Promise<HistorialParams> }) {
  const location = parseHistorialLocation(await searchParams);
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/historial");

  const data = await loadHistorial(supabase, user.id, location);

  return (
    <div className="w-full min-w-0 max-w-2xl mx-auto px-4 py-6">
      <Link 
        href="/" 
        className="flex items-center gap-2 group p-2 -ml-2 mb-4 w-fit rounded-xl hover:bg-card/50 transition-colors shrink-0"
        title="Volver al Inicio"
      >
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-card border border-border/50 group-hover:border-border transition-colors">
          <Home className="w-5 h-5 text-fg" />
        </div>
      </Link>
      <h1 className="text-xl font-bold mb-4">Historial</h1>
      <HistorialTabs data={data} />
    </div>
  );
}
