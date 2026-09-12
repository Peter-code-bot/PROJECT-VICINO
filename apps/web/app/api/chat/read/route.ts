import { markAsRead } from "@/app/(marketplace)/chat/actions";

// Separate POST transport keeps an acknowledgement out of the client Server
// Action queue: a slow receipt must not delay the next sendMessage action.
export async function POST(request: Request): Promise<Response> {
  const headers = { "Cache-Control": "no-store" };
  if (request.headers.get("origin") !== new URL(request.url).origin) {
    return Response.json({ ok: false }, { status: 403, headers });
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false }, { status: 400, headers });
  }
  try {
    if (!body || typeof body !== "object" || !("chatId" in body) || typeof body.chatId !== "string") {
      return Response.json({ ok: false }, { status: 400, headers });
    }
    const result = await markAsRead(body.chatId);
    return Response.json({ ok: result.ok }, { status: result.status, headers });
  } catch {
    return Response.json({ ok: false }, { status: 503, headers });
  }
}
