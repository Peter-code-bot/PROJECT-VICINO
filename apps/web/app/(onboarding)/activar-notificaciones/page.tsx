import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PedirPermiso } from "./pedir-permiso";

/**
 * ESTA CARPETA NO SE LLAMA "notificaciones", Y NO ES UN DESCUIDO.
 *
 * Los grupos entre parentesis no entran en la URL, asi que
 * (onboarding)/notificaciones y (marketplace)/notificaciones —que ya existe y
 * es la campana de la app— serian las dos la ruta /notificaciones, y Next
 * rechaza el build entero con "two parallel pages that resolve to the same
 * path". Es la misma trampa que ya obligo a que el paso de perfil del
 * onboarding viva dentro de /completar-perfil en vez de en (onboarding)/perfil.
 *
 * ---------------------------------------------------------------------------
 * AQUI NO HAY GUARD DE has_seen_onboarding, tambien a proposito.
 *
 * Esta pantalla no escribe una sola fila: pide un permiso del sistema y navega.
 * Un guard que redirija leyendo profiles es el ingrediente exacto del bucle que
 * ya se documento en /completar-perfil — dos pantallas que leen conjuntos de
 * columnas distintos pueden discrepar, y entonces cada una manda a la otra. Con
 * cero lecturas de perfil, ese fallo no existe. Quien ya termino el alta y
 * aterrice aqui ve una pantalla inofensiva y sigue a donde iba.
 */
interface Props {
  searchParams: Promise<{ siguiente?: string }>;
}

/**
 * A donde se va tras decidir. Lista cerrada, NO el valor del parametro.
 *
 * `router.push(searchParams.siguiente)` a pelo acepta "//otro-dominio.com" y
 * convierte un paso del alta en un redirector abierto: basta un enlace a
 * /activar-notificaciones?siguiente=... para sacar a alguien de VICINO con la
 * apariencia de haberse quedado dentro.
 */
const DESTINOS = ["/completar-perfil", "/empezar-a-vender"] as const;

function destinoSeguro(valor: string | undefined): string {
  return valor !== undefined && (DESTINOS as readonly string[]).includes(valor)
    ? valor
    : "/completar-perfil";
}

export default async function ActivarNotificacionesPage({ searchParams }: Props) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const params = await searchParams;

  return <PedirPermiso siguiente={destinoSeguro(params.siguiente)} />;
}
