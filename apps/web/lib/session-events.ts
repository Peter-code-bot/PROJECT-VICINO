"use client";
/** Invalidation signal shared by mutations, Realtime and the session provider. */
export function invalidateSessionData(prefix?: string) {
  window.dispatchEvent(new CustomEvent("vicino:data-invalidated", { detail: prefix }));
}
