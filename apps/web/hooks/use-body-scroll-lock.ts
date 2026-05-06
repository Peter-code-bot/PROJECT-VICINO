"use client";

import { useEffect } from "react";

/**
 * Locks body scroll while `active` is true. Restores prior overflow on cleanup.
 * Used by full-screen drawers/overlays to prevent rubber-banding behind them.
 */
export function useBodyScrollLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [active]);
}
