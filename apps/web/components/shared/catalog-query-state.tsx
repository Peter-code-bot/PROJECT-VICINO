"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { CatalogFailure } from "@/lib/catalogo/estado-consulta";

export function CatalogQueryState({ failure, section }: { failure: CatalogFailure; section: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [retryAt] = useState(() => failure.retryAfter ? Date.now() + failure.retryAfter * 1000 : 0);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (retryAt <= now) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [retryAt, now]);

  const wait = retryAt > now ? Math.ceil((retryAt - now) / 1000) : 0;
  return <div role="alert">
    <p>{failure.kind === "rate_limited"
      ? `Hay demasiadas solicitudes de ${section}. Intenta de nuevo más tarde.`
      : `No pudimos cargar ${section}. Revisa tu conexión e intenta de nuevo.`}</p>
    <button type="button" disabled={pending || wait > 0} onClick={() => startTransition(() => router.refresh())}>
      {wait > 0 ? `Reintentar en ${wait} s` : pending ? "Reintentando…" : "Reintentar"}
    </button>
  </div>;
}
