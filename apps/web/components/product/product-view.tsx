"use client";

import { useEffect, useRef } from "react";
import { createClient } from "@/lib/supabase/client";

/** Count a visible visit, not an RSC render, prefetch or repeated refresh. */
export function ProductView({ productId }: { productId: string }) {
  const counted = useRef<string | null>(null);
  useEffect(() => {
    const record = () => {
      if (document.visibilityState !== "visible" || counted.current === productId) return;
      counted.current = productId;
      void Promise.resolve(createClient().rpc("increment_product_view", { p_id: productId }))
        .then(({ error }) => {
          if (error) console.warn("[product-view] acknowledgement failed");
        }, () => { console.warn("[product-view] acknowledgement failed"); });
    };
    record();
    document.addEventListener("visibilitychange", record);
    return () => document.removeEventListener("visibilitychange", record);
  }, [productId]);
  return null;
}
