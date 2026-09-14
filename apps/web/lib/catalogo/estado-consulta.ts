export type CatalogFailure = {
  kind: "rate_limited" | "failure";
  retryAfter?: number;
};

/** Acepta el código estable cuando B1/B2 lo entreguen; no deduce esperas de texto. */
export function catalogFailure(error: unknown): CatalogFailure {
  if (typeof error !== "object" || error === null) return { kind: "failure" };
  const value = error as Record<string, unknown>;
  const rateLimited = value.status === 429 || value.code === "429" || value.code === "rate_limited";
  const retryAfter = typeof value.retryAfter === "number" && Number.isFinite(value.retryAfter) && value.retryAfter > 0
    ? value.retryAfter : undefined;
  return { kind: rateLimited ? "rate_limited" : "failure", ...(retryAfter ? { retryAfter } : {}) };
}
