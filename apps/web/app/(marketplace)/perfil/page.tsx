import * as Sentry from "@sentry/nextjs";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getProfileSession,
  type ProfileSessionContext,
  type ProfileSessionPart,
  type ProfileSessionResult,
} from "@/lib/profile-session-data";
import type { SessionSeed } from "@/components/layout/session-data-provider";
import { ProfileSession, type ProfileSessionSeeds } from "./profile-session";

export const metadata = { title: "Mi perfil — VICINO" };

export default async function PerfilPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/perfil");

  // El HTML lleva SOLO lo que se ve al abrir: la cabecera y la rejilla de
  // publicaciones, que es la pestaña por defecto. Las reseñas y los contadores
  // de seguidores los pide el cliente, igual que master los diferia con
  // Suspense: si el HTML esperase a las cuatro, la parte mas lenta retrasaria
  // la cabecera entera.
  //
  // Se reutilizan el cliente y el usuario que acaban de decidir el redirect,
  // para no ir a Auth tres veces por navegacion. allSettled y no all: una
  // parte caida se queda sin semilla y la memoria de sesion la pide y ofrece
  // el reintento en linea, en vez de tirar la pagina entera.
  const ctx: ProfileSessionContext = { supabase, user };
  const [core, products] = await Promise.allSettled([
    getProfileSession("core", ctx),
    getProfileSession("products", ctx),
  ]);

  // Un id por render, y cada parte lleva el suyo colgando de el:
  // SessionCache.seed deduplica por renderId de forma GLOBAL (no por clave),
  // asi que si las dos compartieran el id solo se sembraria la primera y la
  // otra se descartaria como copia del router.
  const renderId = crypto.randomUUID();
  const seeds: ProfileSessionSeeds = {
    core: semilla("core", core, renderId),
    products: semilla("products", products, renderId),
  };
  return <ProfileSession seeds={seeds} />;
}

// Una parte rechazada no se pierde en silencio: se reporta con la parte en la
// etiqueta y se deja sin semilla, que es exactamente el estado en que el
// cliente sabe pedirla y reintentarla. `null` (sin usuario) no puede darse
// aqui porque el redirect de arriba ya lo descarto, pero el tipo lo admite.
function semilla<P extends ProfileSessionPart>(
  part: P,
  resultado: PromiseSettledResult<ProfileSessionResult<P> | null>,
  renderId: string,
): SessionSeed<ProfileSessionResult<P>["value"]> | undefined {
  if (resultado.status === "rejected") {
    Sentry.captureException(resultado.reason, { tags: { surface: "perfil", query: `profile_seed_${part}` } });
    return undefined;
  }
  if (!resultado.value) return undefined;
  return { value: resultado.value.value, renderId: `${renderId}:${part}` };
}
