import { cn } from "@/lib/utils";
import { HapticLink } from "@/components/shared/haptic-link";

export interface HomeTabsProps {
  active: "parati" | "following" | "solicitudes";
}

export function HomeTabs({ active }: HomeTabsProps) {
  return (
    <div className="px-4 pt-3 pb-1">
      <div className="flex items-baseline gap-4">
        <HapticLink
          href="/"
          haptic="selection"
          className={cn(
            "font-heading text-[19px] font-extrabold tracking-tight transition-colors",
            active === "parati"
              ? "text-[color:var(--fg)]"
              : "text-[color:var(--fg)]/30 hover:text-[color:var(--fg)]/60"
          )}
        >
          Para ti
        </HapticLink>
        <HapticLink
          href="/?feed=following"
          haptic="selection"
          className={cn(
            "font-heading text-[19px] font-extrabold tracking-tight transition-colors",
            active === "following"
              ? "text-[color:var(--fg)]"
              : "text-[color:var(--fg)]/30 hover:text-[color:var(--fg)]/60"
          )}
        >
          Siguiendo
        </HapticLink>
        <HapticLink
          href="/?feed=solicitudes"
          haptic="selection"
          className={cn(
            "font-heading text-[19px] font-extrabold tracking-tight transition-colors",
            active === "solicitudes"
              ? "text-emerald-600 dark:text-emerald-400"
              : "text-emerald-600/30 dark:text-emerald-400/30 hover:text-emerald-600/60 dark:hover:text-emerald-400/60"
          )}
        >
          Solicitudes
        </HapticLink>
      </div>
    </div>
  );
}
