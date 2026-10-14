"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";

export function CommunityPhoto({ nombre, url, className }: { nombre: string; url?: string | null; className?: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  return (
    <div className={cn("relative flex aspect-square items-center justify-center overflow-hidden bg-brand-tint text-brand-hi", className)}>
      {url && url !== failedUrl ? (
        // Signed private-storage URLs are already compressed; no public image proxy.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt={`Foto de ${nombre}`} className="h-full w-full object-cover" onError={() => setFailedUrl(url)} />
      ) : <span aria-hidden="true" className="font-heading text-5xl font-bold">{Array.from(nombre.trim())[0]?.toLocaleUpperCase("es-MX") ?? "C"}</span>}
    </div>
  );
}
