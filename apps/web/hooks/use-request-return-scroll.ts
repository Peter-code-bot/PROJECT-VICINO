"use client";
import { useLayoutEffect, useRef } from "react";
import { useSessionUI } from "@/components/layout/session-data-provider";

/** Restore only a position explicitly saved before opening a request detail.
 * Scope includes account, zone and collection so another zone never inherits it. */
export function useRequestReturnScroll(scope: string, reset = false) {
  const [saved, save] = useSessionUI<number | null>(`request-return-scroll:${scope}`, null);
  const initial = useRef(reset ? 0 : saved);
  useLayoutEffect(() => {
    if (initial.current == null) return;
    let frame = 0;
    let stopped = false;
    const deadline = performance.now() + 1500;
    const stop = () => { stopped = true; cancelAnimationFrame(frame); };
    const restore = () => {
      if (stopped) return;
      window.scrollTo({ top: initial.current ?? 0, behavior: "instant" });
      if (performance.now() < deadline) frame = requestAnimationFrame(restore);
    };
    const events = ["pointerdown", "wheel", "touchstart", "keydown"];
    for (const event of events) window.addEventListener(event, stop, { passive: true, once: true });
    frame = requestAnimationFrame(restore);
    return () => { stop(); for (const event of events) window.removeEventListener(event, stop); };
  }, []);
  return () => save(window.scrollY);
}
