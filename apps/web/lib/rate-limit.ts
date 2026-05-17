import { Ratelimit } from "@upstash/ratelimit";
import { Redis } from "@upstash/redis";

/**
 * Extract the client IP from request/headers. Prefers x-forwarded-for
 * (first entry), falls back to x-real-ip, then "unknown".
 * Shared across middleware and server actions so the limit identifier
 * stays consistent — without this, an action that only checks
 * x-forwarded-for collapses every request lacking that header into a
 * single global quota.
 */
export function getClientIp(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const real = h.get("x-real-ip");
  if (real) return real;
  return "unknown";
}

// Boot strategy: if Upstash creds are absent (local dev without the .env
// vars, preview deploys before secrets are wired), build instances as null
// and treat enforce()/check() as no-ops. Production with creds gets real
// throttling. Never fail-closed on a missing dependency — that breaks devs.
const hasUpstash = Boolean(
  process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN,
);

const redis = hasUpstash ? Redis.fromEnv() : null;

function makeLimiter(window: Parameters<typeof Ratelimit.slidingWindow>[1], count: number, prefix: string) {
  if (!redis) return null;
  return new Ratelimit({
    redis,
    limiter: Ratelimit.slidingWindow(count, window),
    prefix,
    analytics: true,
  });
}

// Auth pages (login, register, forgot-password) — slow credential stuffing.
// Per IP. Tight ceiling on purpose; legitimate users rarely retry > 5 times.
export const authRateLimit = makeLimiter("15 m", 5, "rl:auth");

// OAuth callback — Supabase occasionally retries the callback in OAuth flows,
// so this gets its own, more permissive tier to avoid breaking legitimate
// retries. Per IP.
export const oauthCallbackRateLimit = makeLimiter("1 m", 20, "rl:oauth-cb");

// Authenticated write actions (createProduct, sendMessage, toggleFavorite,
// admin actions, etc.). Per user. 30/min is well above human pace but blocks
// scripted abuse.
export const writeRateLimit = makeLimiter("1 m", 30, "rl:write");

// Heavy reads (search, nearby_products). Per IP. 60/min is above any
// reasonable UI cadence; below scraping speeds.
export const readHeavyRateLimit = makeLimiter("1 m", 60, "rl:read");

type EnforceResult = { ok: true } | { ok: false; error: string };

/**
 * Call as the first post-auth line of a sensitive server action.
 *   const { data: { user } } = await supabase.auth.getUser();
 *   if (!user) return { error: "..." };
 *   const rate = await enforce(writeRateLimit, `write:${user.id}`);
 *   if (!rate.ok) return { error: rate.error };
 *
 * Fails open on Upstash network errors — a transient blip should not lock
 * users out of the app. Genuine throttling returns ok: false.
 */
export async function enforce(
  limit: Ratelimit | null,
  identifier: string,
): Promise<EnforceResult> {
  if (!limit) return { ok: true };
  try {
    const { success } = await limit.limit(identifier);
    if (!success) {
      return { ok: false, error: "Demasiadas solicitudes. Espera un momento e intenta de nuevo." };
    }
    return { ok: true };
  } catch (err) {
    console.warn("[rate-limit] fail-open after error:", err);
    return { ok: true };
  }
}

/**
 * Middleware-friendly variant: returns success/fail without throwing.
 * Use from middleware.ts to short-circuit the request with 429.
 */
export async function check(
  limit: Ratelimit | null,
  identifier: string,
): Promise<{ success: boolean }> {
  if (!limit) return { success: true };
  try {
    return await limit.limit(identifier);
  } catch (err) {
    console.warn("[rate-limit] fail-open after error:", err);
    return { success: true };
  }
}
