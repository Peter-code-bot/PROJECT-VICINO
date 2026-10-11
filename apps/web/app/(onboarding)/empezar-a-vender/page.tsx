import { redirect } from "next/navigation";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { OnboardingShell } from "@/components/onboarding/onboarding-shell";
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

  const { data: perfil, error } = await supabase
    .from("profiles")
    .select("nombre, foto, es_vendedor, alta_vendedor_paso, has_seen_onboarding, seller_type, categoria_negocio, nombre_negocio, descripcion_negocio, metodos_pago_aceptados")
    .eq("id", user.id)
    .single();

  // A read error must not look like an empty new account or restart the flow.
  if (error || !perfil) {
    Sentry.captureException(error ?? new Error("Perfil ausente en el alta de vendedor"), {
      tags: { action: "alta_vendedor_cargar_perfil" },
      contexts: { supabase: { code: error?.code } },
    });
    return (
      <OnboardingShell
        title="No pudimos cargar tu perfil"
        description="Tus datos se conservaron. Intenta de nuevo para continuar."
        backHref="/"
        footer={<Link href="/empezar-a-vender" prefetch={false} className="flex min-h-12 items-center justify-center rounded-xl bg-primary px-4 py-3 font-medium text-primary-foreground">Reintentar</Link>}
      >
        <p className="text-sm text-muted-foreground">No necesitas volver a completar tus datos.</p>
      </OnboardingShell>
    );
  }

  // Activation for a new account belongs after the shared profile steps.
  if (!perfil.has_seen_onboarding) {
    redirect("/completar-perfil/categoria?camino=vender");
  }

  // alta_vendedor_paso vale 'publicacion' justo después de activar y se limpia
  // al publicar el primer producto, así que distingue al recién activado
  // —que tiene que ver su bienvenida— del vendedor asentado.
  if (perfil.es_vendedor && !perfil.alta_vendedor_paso) {
    redirect("/vender");
  }

  // Quien YA termino el onboarding no vuelve a pasar por los pasos
  // compartidos: /completar-perfil lo devolveria al home, y la pantalla final
  // del alta acabaria rebotandolo ahi sin el empujon a publicar que le acababa
  // de prometer. Con esto ese caso termina en /vender, como antes.
  return (
    <AltaVendedor
      nombre={perfil.nombre ?? null}
      categoriaInicial={perfil.categoria_negocio ?? null}
      tipoInicial={perfil.seller_type === "business" ? "business" : "casual"}
      nombreNegocioInicial={perfil.nombre_negocio ?? ""}
      descripcionNegocioInicial={perfil.descripcion_negocio ?? ""}
      metodosPagoIniciales={(perfil.metodos_pago_aceptados ?? "").split(",").map((metodo) => metodo.trim()).filter(Boolean)}
      fotoInicial={perfil.foto ?? ""}
      yaEsVendedor={perfil.es_vendedor ?? false}
    />
  );
}
