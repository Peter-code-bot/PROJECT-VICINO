import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AltaVendedor } from "./alta-vendedor";

export const metadata = { title: "Empieza a vender — VICINO" };

/**
 * Ruta dedicada del alta de vendedor.
 *
 * Antes, las tres entradas que decían «quiero vender» desembocaban en
 * /perfil/editar, la pantalla genérica de editar perfil, donde la casilla que
 * había que marcar estaba por debajo de seis campos. Ese era el item 7 del
 * backlog: una pantalla muda.
 *
 * Quien YA es vendedor no tiene nada que hacer aquí: se le manda a publicar,
 * que es lo que venía a hacer.
 */
export default async function AltaVendedorPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/empezar-a-vender");

  const { data: perfil } = await supabase
    .from("profiles")
    .select("nombre, es_vendedor")
    .eq("id", user.id)
    .single();

  if (perfil?.es_vendedor) redirect("/vender");

  return <AltaVendedor nombre={perfil?.nombre ?? null} />;
}
