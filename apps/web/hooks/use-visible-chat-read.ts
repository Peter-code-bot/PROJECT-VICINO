"use client";

import { useEffect, useRef } from "react";

/** A mounted, visible conversation acknowledges in the background. Rendering
 * or prefetching its RSC payload cannot send a receipt. Requests are coalesced,
 * and failure waits for a new message/foreground event instead of retrying forever.
 */
export function useVisibleChatRead(chatId: string, userId: string, lastIncomingId: string) {
  const requestRef = useRef<() => void>(() => {});
  useEffect(() => {
    let disposed = false;
    let inFlight = false;
    let dirty = false;
    let controller: AbortController | undefined;
    const send = async () => {
      if (disposed || inFlight || !dirty || document.visibilityState !== "visible") return;
      dirty = false;
      inFlight = true;
      controller = new AbortController();
      // This specific mutation is idempotent. An interrupted acknowledgement
      // can be repeated safely; ordinary writes retain their existing policy.
      const timeout = setTimeout(() => controller?.abort(), 10_000);
      let ok = false;
      try {
        const response = await fetch("/api/chat/read", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chatId }), credentials: "same-origin",
          cache: "no-store", signal: controller.signal,
        });
        ok = response.ok;
      } catch { /* Retry on the next visible message or foreground event. */ }
      finally {
        clearTimeout(timeout);
        inFlight = false;
        if (!disposed && ok && dirty) void send();
      }
    };
    const request = () => { dirty = true; void send(); };
    requestRef.current = request;
    document.addEventListener("visibilitychange", request);
    window.addEventListener("focus", request);
    return () => {
      disposed = true;
      controller?.abort();
      requestRef.current = () => {};
      document.removeEventListener("visibilitychange", request);
      window.removeEventListener("focus", request);
    };
  }, [chatId, userId]);
  useEffect(() => { requestRef.current(); }, [chatId, userId, lastIncomingId]);
}
