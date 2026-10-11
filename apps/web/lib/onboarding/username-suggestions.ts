import { z } from "zod";

const MAX_USERNAME = 30;
const RELAY_DOMAINS = new Set([
  "privaterelay.appleid.com", "mozmail.com", "relay.firefox.com", "duck.com",
]);

/** Solo se usa para sugerir; nunca cambia el nombre público ni guarda el correo. */
export function usernameSuggestionBase(email: string | null | undefined, nombre?: string | null): string {
  const address = email ?? "";
  const separator = address.lastIndexOf("@");
  const domain = separator >= 0 ? address.slice(separator + 1).toLowerCase() : "";
  const local = separator >= 0 && !RELAY_DOMAINS.has(domain)
    ? address.slice(0, separator).split("+")[0]
    : nombre;
  const clean = (local ?? "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9_]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return clean || "vecino";
}

/** Un inicio aleatorio y sufijos consecutivos evitan duplicados dentro del lote. */
export function usernameSuggestionCandidates(base: string, start: number, count = 24): string[] {
  const first = ((Math.trunc(start) % 9000) + 9000) % 9000;
  return Array.from({ length: Math.min(Math.max(Math.trunc(count), 0), 30) }, (_, i) => {
    const suffix = `_${1000 + ((first + i) % 9000)}`;
    const stem = base.slice(0, MAX_USERNAME - suffix.length).replace(/_+$/g, "") || "vecino";
    return `${stem}${suffix}`;
  });
}

export const usernameLookupSchema = z.object({
  username: z.string(),
  status: z.enum(["empty", "invalid", "reserved", "taken", "available"]),
  message: z.string().nullable(),
  suggestions: z.array(z.string().regex(/^[A-Za-z0-9_]{3,30}$/)).max(3),
});

export type UsernameLookupResult = z.infer<typeof usernameLookupSchema>;
