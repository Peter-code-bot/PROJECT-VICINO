import { NextResponse } from "next/server";
import { z } from "zod";
import * as Sentry from "@sentry/nextjs";
import { getChatList } from "@/lib/chat-list-data";
import { getHomeSession, homeSearchSchema } from "@/lib/home-session-data";
import { getProfileSession } from "@/lib/profile-session-data";
import { esAuthNoDisponible } from "@/lib/session-auth";
import { enforce, getClientIp, readHeavyRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const partSchema = z.enum(["core", "products", "reviews", "counts"]);

/**
 * Lecturas en segundo plano de la memoria de sesion (SessionCache.load).
 *
 * Contrato con el cliente: 200 con { userId, value }; 401 SOLO cuando no hay
 * sesion (el cliente vacia la memoria y manda a /login); 503 cuando algo fallo
 * (el cliente conserva lo que tenia y ofrece reintentar); 429 cuando la IP
 * supero el freno (se trata como 503 en el cliente).
 */
export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  // Freno por IP ANTES de cualquier trabajo. El matcher de proxy.ts excluye
  // /api, asi que el freno `pagina:` que 269b926 puso delante del home y de
  // /buscar NO cubre estas lecturas -- y son las MISMAS consultas pesadas
  // (la RPC de 150 filas del inicio, la lista de chats, el perfil con sus
  // productos y opiniones). Sin esto, un bucle de curl contra
  // /api/session/home paga el render caro sin pasar por el middleware que lo
  // frena.
  //
  // Identificador propio (`sesion:`) y no `pagina:` ni `read:`: cubos
  // distintos a proposito, con el mismo criterio que documenta
  // (marketplace)/actions.ts -- raspar esta ruta no debe dejar sin home a
  // quien comparte NAT. Sin credenciales de Upstash enforce() es un no-op y
  // deja pasar; el codigo queda listo para el dia que existan.
  const rate = await enforce(readHeavyRateLimit, `sesion:${getClientIp(request.headers)}`);
  if (!rate.ok) {
    return NextResponse.json({ error: rate.error }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
  }
  const { resource } = await params;
  const query = Object.fromEntries(new URL(request.url).searchParams);
  try {
    if (resource === "chats") {
      const result = await getChatList();
      if (!result) return new Response(null, { status: 401, headers });
      return NextResponse.json(result, { headers });
    }
    if (resource === "home") {
      const input = homeSearchSchema.safeParse(query);
      if (!input.success) return new Response(null, { status: 400, headers });
      const result = await getHomeSession(input.data);
      // El feed «Para ti» caido no es un exito vacio: en una revalidacion en
      // segundo plano el cliente debe conservar lo que tenia, no sustituirlo
      // por una portada sin productos. La primera visita, en cambio, recibe
      // el mismo valor por la semilla de page.tsx y pinta la causa.
      if (result.value.feed === "parati" && result.value.feedResultado.failure) {
        return NextResponse.json({ error: "No se pudieron cargar los productos." }, { status: 503, headers });
      }
      return NextResponse.json(result, { headers });
    }
    if (resource === "profile") {
      const part = partSchema.safeParse(query.part);
      if (!part.success) return new Response(null, { status: 400, headers });
      const result = await getProfileSession(part.data);
      if (!result) return new Response(null, { status: 401, headers });
      return NextResponse.json(result, { headers });
    }
    return new Response(null, { status: 404, headers });
  } catch (error) {
    // Un 503 mudo era el peor modo de fallo: una columna nueva sin GRANT
    // (42501, la causa raiz de la saga del onboarding) dejaba /perfil en
    // "No se pudo actualizar" para todos y en Sentry no aparecia nada. Auth
    // caido se etiqueta aparte para no confundirlo con un error nuestro.
    Sentry.captureException(error, {
      tags: { route: "api/session", resource, causa: esAuthNoDisponible(error) ? "auth_no_disponible" : "consulta" },
    });
    return NextResponse.json({ error: "No se pudieron cargar los datos." }, { status: 503, headers });
  }
}
