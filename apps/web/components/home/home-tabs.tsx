import Link from "next/link";
import { Sparkles, Store } from "lucide-react";
import { cn } from "@/lib/utils";

export interface HomeTabsProps {
  active: "parati" | "following";
}

export function HomeTabs({ active }: HomeTabsProps) {
  return (
    <div className="sticky top-[80px] z-[9] bg-[var(--bg)]/95 backdrop-blur-xl pt-3 pb-4 px-4 border-b border-[var(--border)]/50">
      <div className="flex items-center p-1 bg-[var(--card-2)] border border-[var(--border)] rounded-full w-full max-w-sm mx-auto shadow-sm">
        <Link
          href="/"
          className={cn(
            "flex-1 flex items-center justify-center h-9 text-sm font-medium rounded-full transition-all duration-200",
            active === "parati"
              ? "bg-[var(--brand)] text-white shadow-[0_6px_16px_rgba(31,90,78,0.38)]"
              : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
          )}
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Para ti
        </Link>
        <Link
          href="/?feed=following"
          className={cn(
            "flex-1 flex items-center justify-center h-9 text-sm font-medium rounded-full transition-all duration-200",
            active === "following"
              ? "bg-[var(--brand)] text-white shadow-[0_6px_16px_rgba(31,90,78,0.38)]"
              : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
          )}
        >
          <Store className="w-4 h-4 mr-2" />
          Siguiendo
        </Link>
      </div>
    </div>
  );
}
