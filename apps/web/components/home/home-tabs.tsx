import { Sparkles, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { HapticLink } from "@/components/shared/haptic-link";

export interface HomeTabsProps {
  active: "parati" | "following";
}

export function HomeTabs({ active }: HomeTabsProps) {
  // L3: selection haptic on segmented-control tab switch. HomeTabs is a
  // Server Component, so we use HapticLink (which already crosses the
  // client boundary) with haptic="selection" -- the canonical haptic for
  // tab/segment switches per capacitor-native-ux R1. No other handler
  // fires haptic on this surface; no double-fire risk.
  return (
    <div className="pt-4 pb-2 px-4">
      <div className="flex items-center p-1 bg-[var(--card-2)] border border-[var(--border)] rounded-full w-full max-w-sm mx-auto shadow-sm">
        <HapticLink
          href="/"
          haptic="selection"
          className={cn(
            "flex-1 flex items-center justify-center h-9 text-sm font-medium rounded-full transition-all duration-200",
            active === "parati"
              ? "bg-[var(--brand)] text-white shadow-[0_6px_16px_rgba(31,90,78,0.38)]"
              : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
          )}
        >
          <Sparkles className="w-4 h-4 mr-2" />
          Para ti
        </HapticLink>
        <HapticLink
          href="/?feed=following"
          haptic="selection"
          className={cn(
            "flex-1 flex items-center justify-center h-9 text-sm font-medium rounded-full transition-all duration-200",
            active === "following"
              ? "bg-[var(--brand)] text-white shadow-[0_6px_16px_rgba(31,90,78,0.38)]"
              : "text-[var(--fg-muted)] hover:text-[var(--fg)]"
          )}
        >
          <Store className="w-4 h-4 mr-2" />
          Siguiendo
        </HapticLink>
      </div>
    </div>
  );
}
