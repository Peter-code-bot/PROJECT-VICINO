import { Suspense } from "react";
import { cookies } from "next/headers";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import {
  getHomeSession,
  homeSearchSchema,
  type HomeSearchInput,
  type HomeSessionValue,
} from "@/lib/home-session-data";
import { homeSessionKey, locationScopeFromPairs } from "@/lib/session-scope";
import type { SessionSeed } from "@/components/layout/session-data-provider";
import { HomeSession } from "../home-session";
import { RankingsHomeStripSection } from "@/components/rankings/rankings-home-strip";
import { RankingSkeleton } from "@/components/home/ranking-skeleton";

// El inicio depende de las cookies de sesion y de zona en cada peticion: no
// hay una version estatica que valga para nadie.
export const dynamic = "force-dynamic";

type HomeSearchParams = { feed?: string; cats?: string | string[]; tab?: string };

interface HomePageProps {
  searchParams: Promise<HomeSearchParams>;
}

/**
 * `cats` puede llegar repetido (?cats=a&cats=b) y Next lo entrega como
 * arreglo; el feed solo entiende una lista separada por comas, asi que se
 * toma el primero antes de validar. Un parametro que no pase el esquema no
 * tira la pagina: se pinta «Para ti», que es lo mismo que responde la API
 * ante la misma entrada.
 */
function leerParametros(raw: HomeSearchParams): HomeSearchInput {
  const parsed = homeSearchSchema.safeParse({
    ...raw,
    cats: Array.isArray(raw.cats) ? raw.cats[0] : raw.cats,
  });
  return parsed.success ? parsed.data : {};
}

export default async function HomePage({ searchParams }: HomePageProps) {
  const params = leerParametros(await searchParams);

  // Un solo cliente y un solo viaje a Auth para todo el render; el cargador
  // los recibe por ctx en vez de repetir lo que esta pagina acaba de hacer.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Un feed caido NO lanza: viaja dentro del valor como feedResultado.failure
  // y HomeSession pinta CatalogQueryState con la causa. Lo que si puede lanzar
  // es un error inesperado (una consulta nueva sin GRANT, por ejemplo): la
  // pagina no se cae, se pinta sin semilla y el cliente pide la API, pero el
  // error queda en Sentry, porque un catch mudo aqui lo escondería para
  // siempre.
  const inicio = await getHomeSession(params, { supabase, user }).catch((error: unknown) => {
    Sentry.captureException(error, { tags: { surface: "inicio", query: "home_seed" } });
    return null;
  });

  // La zona se lee con la MISMA funcion que el cliente aplica a
  // document.cookie: la semilla tiene que quedar bajo la clave que HomeSession
  // calcula tras hidratar, o el cliente volveria a pedir lo que el HTML trajo.
  const scope = locationScopeFromPairs((await cookies()).getAll());
  const seed: SessionSeed<HomeSessionValue> | undefined = inicio
    ? { value: inicio.value, renderId: crypto.randomUUID(), key: homeSessionKey(params.feed, scope) }
    : undefined;

  return (
    <HomeSession
      seed={seed}
      ranking={
        <Suspense fallback={<RankingSkeleton />}>
          <RankingsHomeStripSection />
        </Suspense>
      }
    />
  );
}
