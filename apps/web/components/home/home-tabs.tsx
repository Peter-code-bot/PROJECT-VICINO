import { cn } from "@/lib/utils";
import { HapticLink } from "@/components/shared/haptic-link";

export type HomeFeed = "parati" | "following" | "solicitudes" | "comunidades";

export interface HomeTabsProps {
  active: HomeFeed;
}

const TABS: Array<{ id: HomeFeed; href: string; label: string; brand?: boolean }> = [
  { id: "parati", href: "/", label: "Para ti" },
  { id: "following", href: "/?feed=following", label: "Siguiendo" },
  { id: "solicitudes", href: "/?feed=solicitudes", label: "Solicitudes", brand: true },
  { id: "comunidades", href: "/?feed=comunidades", label: "Comunidades" },
];

export function HomeTabs({ active }: HomeTabsProps) {
  return (
    // overflow-x-auto obligatorio (decision 2): a 19 px extrabold con gap-4
    // los cuatro tabs miden ~460 px, mas que los 375 de un telefono. El
    // scroll horizontal es de ESTA fila, nunca del body.
    <div className="-mx-0 overflow-x-auto scrollbar-hide px-4 pt-3 pb-1">
      <div className="flex w-max items-baseline gap-4 pr-4">
        {TABS.map((tab) => {
          const isActive = active === tab.id;
          return (
            <HapticLink
              key={tab.id}
              href={tab.href}
              haptic="selection"
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "shrink-0 whitespace-nowrap font-heading text-[19px] font-extrabold tracking-tight transition-colors",
                tab.brand
                  ? isActive
                    ? "text-[color:var(--brand)]"
                    : "text-[color:var(--brand)]/40 hover:text-[color:var(--brand)]/80"
                  : isActive
                    ? "text-[color:var(--fg)]"
                    : "text-[color:var(--fg)]/30 hover:text-[color:var(--fg)]/60",
              )}
            >
              {tab.label}
            </HapticLink>
          );
        })}
      </div>
    </div>
  );
}
