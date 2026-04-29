/**
 * In-memory rate limiter for Vercel Edge Middleware.
 *
 * Caveats:
 * - Each Edge isolate has its own Map, so under load the effective limit may
 *   be N × max where N = number of warm isolates serving traffic. Good enough
 *   to deter casual abuse; insufficient for sophisticated distributed attacks.
 * - Cleanup is lazy (every Nth check) instead of using setInterval, which is
 *   not reliable in Edge runtime.
 *
 * If VICINO scales beyond a single edge node's traffic for sensitive paths,
 * migrate to Vercel KV or Upstash Redis.
 */

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
let opsSinceCleanup = 0;
const CLEANUP_EVERY_N_OPS = 500;

function maybeCleanup(now: number): void {
  opsSinceCleanup += 1;
  if (opsSinceCleanup < CLEANUP_EVERY_N_OPS) return;
  opsSinceCleanup = 0;
  for (const [key, bucket] of buckets.entries()) {
    if (bucket.resetAt < now) buckets.delete(key);
  }
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
}

export function checkRateLimit(
  key: string,
  max: number,
  windowMs: number
): RateLimitResult {
  const now = Date.now();
  maybeCleanup(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt < now) {
    const resetAt = now + windowMs;
    buckets.set(key, { count: 1, resetAt });
    return { allowed: true, remaining: max - 1, resetAt };
  }

  if (bucket.count >= max) {
    return { allowed: false, remaining: 0, resetAt: bucket.resetAt };
  }

  bucket.count += 1;
  return { allowed: true, remaining: max - bucket.count, resetAt: bucket.resetAt };
}

export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get("x-forwarded-for");
  if (forwardedFor) {
    // Take only first IP and strip whitespace; sanitize to printable ASCII
    const first = forwardedFor.split(",")[0]?.trim() ?? "";
    if (/^[\x21-\x7E]{1,64}$/.test(first)) return first;
  }
  const realIp = request.headers.get("x-real-ip");
  if (realIp && /^[\x21-\x7E]{1,64}$/.test(realIp)) return realIp;
  return "unknown";
}

export interface RateLimitRule {
  max: number;
  windowMs: number;
}

/**
 * Add entries here when API routes are introduced. Empty until the codebase
 * actually has /api/* routes that warrant per-IP throttling.
 *
 * Auth flows (login, register, password reset, OTP) are handled by Supabase
 * Auth's built-in rate limits configured in the Supabase dashboard — not here.
 */
export const RATE_LIMITS: Record<string, RateLimitRule> = {
  // Example (uncomment when route exists):
  // "/api/verification": { max: 5, windowMs: 60 * 60 * 1000 },
  // "/api/reports":      { max: 10, windowMs: 60 * 60 * 1000 },
  // "/api/contact":      { max: 3, windowMs: 60 * 60 * 1000 },
};
