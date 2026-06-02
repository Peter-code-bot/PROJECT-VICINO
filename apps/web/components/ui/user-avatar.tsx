"use client";

import { useState } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

interface UserAvatarProps {
  src?: string | null;
  name: string;
  size?: "xs" | "sm" | "md" | "lg" | "xl";
  className?: string;
}

const SIZES = {
  xs: "w-6 h-6 text-[10px]",
  sm: "w-8 h-8 text-xs",
  md: "w-10 h-10 text-sm",
  lg: "w-14 h-14 text-base",
  xl: "w-20 h-20 sm:w-24 sm:h-24 text-2xl",
};

const PX = { xs: 24, sm: 32, md: 40, lg: 56, xl: 96 };

// A3 CODEX fix: el size "xl" renderiza 80px en mobile (w-20) y 96px en sm+ (sm:w-24).
// Sin sizes responsive, Next/Image elige una variante mas grande de la srcset que
// la necesaria en mobile DPR 2x (sobre-fetcheo de 60% sobre el podio LCP en /rankings).
// Para los demas sizes, sizes={px}px alinea la srcset con la dimension real.
const SIZES_HINT = {
  xs: "24px",
  sm: "32px",
  md: "40px",
  lg: "56px",
  xl: "(max-width: 639px) 80px, 96px",
};

export function UserAvatar({ src, name, size = "md", className }: UserAvatarProps) {
  const [errored, setErrored] = useState(false);
  const initial = (name?.trim()[0] ?? "?").toUpperCase();
  const show = src && !errored;

  return (
    <div
      className={cn(
        "rounded-full overflow-hidden bg-muted shrink-0 flex items-center justify-center font-semibold text-foreground",
        SIZES[size],
        className
      )}
    >
      {show ? (
        <Image
          src={src}
          alt={name}
          width={PX[size]}
          height={PX[size]}
          sizes={SIZES_HINT[size]}
          onError={() => setErrored(true)}
          className="w-full h-full object-cover"
        />
      ) : (
        <span>{initial}</span>
      )}
    </div>
  );
}
