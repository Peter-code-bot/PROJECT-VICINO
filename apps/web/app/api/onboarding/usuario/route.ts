import { randomInt } from "node:crypto";
import { onboardingUsernameSchema } from "@vicino/shared";
import * as Sentry from "@sentry/nextjs";
import { createClient } from "@/lib/supabase/server";
import { enforce, readHeavyRateLimit } from "@/lib/rate-limit";
import {
  usernameLookupSchema,
  usernameSuggestionBase,
  usernameSuggestionCandidates,
} from "@/lib/onboarding/username-suggestions";

const NO_CACHE = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return Response.json({ error: "Necesitas iniciar sesión." }, { status: 401, headers: NO_CACHE });

  const rate = await enforce(readHeavyRateLimit, `onboarding-username:${user.id}`);
  if (!rate.ok) return Response.json({ error: rate.error }, { status: 429, headers: NO_CACHE });

  const username = new URL(request.url).searchParams.get("username") ?? "";
  // No mandar entradas ilimitadas a la base ni capturarlas en diagnósticos.
  if (username.length > 100) {
    return Response.json({ username: "", status: "invalid", message: "Máximo 30 caracteres.", suggestions: [] }, { headers: NO_CACHE });
  }
  const format = onboardingUsernameSchema.safeParse(username);
  if (username && !format.success) {
    return Response.json({ username, status: "invalid", message: format.error.errors[0]!.message, suggestions: [] }, { headers: NO_CACHE });
  }

  const { data: profile, error: profileError } = await supabase.from("profiles")
    .select("nombre").eq("id", user.id).single();
  if (profileError || !profile) {
    Sentry.captureException(profileError ?? new Error("Perfil ausente al sugerir usuario"), { tags: { action: "onboarding_username" } });
    return Response.json({ error: "No pudimos cargar tus opciones. Intenta de nuevo." }, { status: 503, headers: NO_CACHE });
  }
  const base = usernameSuggestionBase(user.email, profile.nombre);
  const seed = randomInt(9000);

  for (let attempt = 0; attempt < 2; attempt++) {
    const { data, error } = await supabase.rpc("consultar_usuarios_onboarding", {
      p_username: username,
      p_sugerencias: usernameSuggestionCandidates(base, seed + attempt * 24),
    });
    if (error) {
      Sentry.captureException(error, { tags: { action: "onboarding_username" } });
      break;
    }
    const parsed = usernameLookupSchema.safeParse(data);
    if (!parsed.success) {
      Sentry.captureException(new Error("Respuesta de opciones de usuario inválida"), { tags: { action: "onboarding_username" } });
      break;
    }
    if (parsed.data.suggestions.length === 3) return Response.json(parsed.data, { headers: NO_CACHE });
  }
  return Response.json({ error: "No pudimos comprobar la disponibilidad. Intenta de nuevo." }, { status: 503, headers: NO_CACHE });
}
