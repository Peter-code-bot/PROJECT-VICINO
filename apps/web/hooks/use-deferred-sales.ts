"use client";

import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react";
import type { SaleConfirmation } from "@/app/(marketplace)/chat/[id]/sale-confirmation-card";

export type SalesSeed = { ok: true; sales: SaleConfirmation[] } | { ok: false };

// A delayed RSC snapshot must never overwrite a newer Realtime event or a
// completed recovery. ChatWindow remains mounted while this seed resolves.
export function useDeferredSales(initial: SaleConfirmation[], seed?: Promise<SalesSeed>) {
  const [sales, setSales] = useState(initial);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(seed ? "loading" : "ready");
  const revision = useRef(0);
  useEffect(() => {
    if (!seed) return;
    let cancelled = false;
    void seed.then(result => {
      if (cancelled || revision.current !== 0) return;
      if (result.ok) { setSales(result.sales); setStatus("ready"); }
      else setStatus("error");
    }, () => { if (!cancelled && revision.current === 0) setStatus("error"); });
    return () => { cancelled = true; };
  }, [seed]);
  const updateLive = useCallback((update: SetStateAction<SaleConfirmation[]>) => {
    revision.current++;
    setSales(update);
  }, []);
  const applySnapshot = useCallback((update: SetStateAction<SaleConfirmation[]>) => {
    revision.current++;
    setSales(update);
    setStatus("ready");
  }, []);
  const failed = useCallback(() => setStatus(previous => previous === "ready" ? previous : "error"), []);
  return { sales, status, updateLive, applySnapshot, failed };
}
