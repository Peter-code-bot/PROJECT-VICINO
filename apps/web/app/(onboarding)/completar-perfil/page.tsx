import { redirect } from "next/navigation";
import Link from "next/link";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { CompletarPerfil } from "./completar-perfil";
import type { PasoOnboarding } from "./actions";

const PASOS_VALIDOS: PasoOnboarding[] = ["perfil", "intereses", "ubicacion"];

function pasoSeguro(valor: string | null): PasoOnboarding {
  // Un valor raro no puede dejar la pantalla en blanco: se cae al primer paso.
  // La columna tiene un CHECK que ya lo impide, pero esto se lee del cliente y
  // el CHECK vive en la base — la pantalla no debe depender de eso para pintar.
  return PASOS_VALIDOS.includes(valor as PasoOnboarding)
    ? (valor as PasoOnboarding)
    : "perfil";
}

export default async function CompletarPerfilPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("nombre, bio, foto, intereses, onboarding_paso, has_seen_onboarding, seller_type")
    .eq("id", user.id)
    .single();

  // El error se MIRA, no se ignora: un fallo de consulta era indistinguible de
  // un perfil vacio, la pantalla rebobinaba al paso 1 en blanco y la persona
  // reescribia su nombre creyendo que se habia perdido.
  //
  // PERO AQUI NO SE REDIRIGE, Y ESO ES EL ARREGLO DE UN BUCLE QUE YO MISMO
  // INTRODUJE. La primera version mandaba a /bienvenida «por seguridad». Esas
  // dos pantallas leen CONJUNTOS DE COLUMNAS DISTINTOS —aqui nombre, bio, foto
  // e intereses; alli onboarding_camino y es_vendedor— asi que pueden discrepar:
  // basta con que falle una columna exclusiva de esta consulta (un 42501 el dia
  // que alguien anada una columna sin GRANT, que en este repo es LA causa
  // recurrente) para que aqui falle y alli no. Entonces /bienvenida lee bien, ve
  // onboarding_paso y devuelve aqui. Y vuelta a empezar: redireccion infinita.
  //
  // Es exactamente la saga original del onboarding — 42501 -> profile null ->
  // rebote perpetuo a /bienvenida— reconstruida por la puerta de atras.
  //
  // Un error honesto que no avanza es mejor que un bucle. La persona ve que algo
  // fallo, puede reintentar, y Sentry recibe el detalle de Postgres, que es
  // donde el motor nombra la columna o la policy que rechazo.
  if (error || !profile) {
    Sentry.captureException(error ?? new Error("perfil ausente en /completar-perfil"), {
      tags: { action: "completar_perfil_cargar" },
      contexts: { supabase: { code: error?.code, details: error?.details } },
    });

    return (
      <div className="w-full max-w-md px-6 py-10 space-y-4 text-center">
        <h1 className="font-heading text-2xl font-bold">No pudimos cargar tu perfil</h1>
        <p className="text-sm text-muted-foreground">
          Fue un problema nuestro, no tuyo. Tus datos están a salvo. Vuelve a
          intentarlo en un momento.
        </p>
        {/* prefetch={false} a proposito: esto es un reintento de una consulta
            que acaba de fallar, asi que precargarla de antemano solo serviria
            para volver a guardar el fallo en la cache del router. */}
        <Link
          href="/completar-perfil"
          prefetch={false}
          className="block w-full rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white"
        >
          Reintentar
        </Link>
      </div>
    );
  }

  // Quien ya termino no vuelve a pasar por aqui. El onboarding nuevo es solo
  // para registros nuevos: a los perfiles que ya existian no se les interrumpe.
  if (profile.has_seen_onboarding) redirect("/");

  const pasoBase = pasoSeguro(profile.onboarding_paso);
  // Si es negocio/tienda, los datos de perfil ya se recolectaron en el alta de vendedor,
  // por lo que se salta el paso 'perfil' y se inicia directamente en 'intereses'.
  const esNegocio = profile.seller_type === "business";
  const pasoInicial = esNegocio && pasoBase === "perfil" ? "intereses" : pasoBase;

  return (
    <CompletarPerfil
      pasoInicial={pasoInicial}
      sellerType={profile.seller_type ?? undefined}
      // El nombre YA viene del registro (signUp lo manda en full_name), asi que
      // este campo arranca lleno y no se le pide dos veces lo mismo.
      nombreInicial={profile.nombre ?? ""}
      bioInicial={profile.bio ?? ""}
      fotoInicial={profile.foto ?? ""}
      interesesIniciales={profile.intereses ?? []}
    />
  );
}
