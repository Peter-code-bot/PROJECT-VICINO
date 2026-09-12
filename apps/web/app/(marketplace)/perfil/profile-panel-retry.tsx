"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";

export function ProfilePanelRetry({ label, compact = false }: { label: string; compact?: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const button = <button type="button" disabled={pending}
    aria-label={`Reintentar ${label}`} onClick={() => startTransition(() => router.refresh())}
    className="min-h-11 text-sm font-semibold text-brand disabled:opacity-60">
    {pending ? "Reintentando…" : "Reintentar"}
  </button>;
  if (compact) return button;
  return <div className="min-h-32 py-6 text-sm text-fg-muted">
    <p>No se pudieron cargar {label}.</p>{button}
  </div>;
}
