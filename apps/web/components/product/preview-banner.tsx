"use client";

import { Eye, X } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

interface PreviewBannerProps {
  isOwner: boolean;
}

export function PreviewBanner({ isOwner }: PreviewBannerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isVisitorPreview = searchParams.get("preview") === "visitor";

  if (!isOwner || !isVisitorPreview) return null;

  function handleExit() {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("preview");
    const qs = params.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div
      role="status"
      className="flex items-center justify-between gap-3 border-b border-[color:var(--brand-tint)] bg-[color:var(--brand-tint-strong)] px-4 py-2.5 text-xs text-[color:var(--brand-hi)] backdrop-blur"
    >
      <span className="inline-flex items-center gap-1.5 font-semibold">
        <Eye className="h-4 w-4 shrink-0" aria-hidden />
        Estás viendo como visitante
      </span>
      <button
        type="button"
        onClick={handleExit}
        aria-label="Salir de vista de visitante"
        className="inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-1 text-[11px] font-semibold transition-colors hover:bg-[color:var(--brand-tint)]"
      >
        Volver a vista de propietario
        <X className="h-3 w-3" aria-hidden />
      </button>
    </div>
  );
}
