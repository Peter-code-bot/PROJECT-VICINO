import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

/** Serialize VICINO submissions across workers, before looking up Auth.
 * An uncertain transport result keeps the reservation until expiry: retrying
 * must not resend signup while the first request might still be in flight.
 * The Auth request is bounded to 20s; the reservation lasts five minutes.
 */
export async function reservarRegistro(correo: string) {
  if (!process.env.UPSTASH_REDIS_REST_URL || !process.env.UPSTASH_REDIS_REST_TOKEN) return null;
  const redis = Redis.fromEnv({ signal: () => AbortSignal.timeout(5_000), retry: false });
  const key = `vicino:registro:${createHash("sha256").update(correo).digest("hex")}`;
  const owner = randomUUID();
  const iniciado = Date.now();
  try {
    if (await redis.set(key, owner, { nx: true, ex: 300 }) !== "OK") return null;
    if (Date.now() - iniciado > 10_000) return null;
  } catch { return null; }
  return {
    vigente: () => Date.now() - iniciado < 60_000,
    async liberar() {
      try {
        await redis.eval("if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end", [key], [owner]);
      } catch { /* expiry recovers a failed release, without allowing a race */ }
    },
  };
}
