import { NextResponse } from "next/server";
import { z } from "zod";
import { getChatList } from "@/lib/chat-list-data";
import { getHomeSession } from "@/lib/home-session-data";
import { getProfileSession } from "@/lib/profile-session-data";

export const dynamic = "force-dynamic";
const homeSchema = z.object({
  feed: z.enum(["parati", "following", "solicitudes", "comunidades"]).optional(),
  tab: z.enum(["muro", "mias", "descubrir"]).optional(),
  cats: z.string().max(1000).optional(),
});
export async function GET(request: Request, { params }: { params: Promise<{ resource: string }> }) {
  const { resource } = await params;
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const headers = { "Cache-Control": "private, no-store" };
  try {
    let result;
    if (resource === "chats") result = await getChatList();
    else if (resource === "home") {
      const input = homeSchema.safeParse(query);
      if (!input.success) return new Response(null, { status: 400, headers });
      result = await getHomeSession(input.data);
    } else if (resource === "profile") {
      const part = z.enum(["core", "products", "reviews", "counts"]).safeParse(query.part);
      if (!part.success) return new Response(null, { status: 400, headers });
      result = await getProfileSession(part.data);
    } else return new Response(null, { status: 404, headers });
    if (!result) return new Response(null, { status: 401, headers });
    return NextResponse.json(result, { headers });
  } catch {
    return NextResponse.json({ error: "No se pudieron cargar los datos." }, { status: 503, headers });
  }
}
