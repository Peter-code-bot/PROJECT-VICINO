"use client";

import { cn } from "@/lib/utils";
import { hapticSelection } from "@/lib/haptics";

export type SubTabComunidades = "muro" | "mias" | "descubrir";

interface SubTabsProps {
  active: SubTabComunidades;
  onChange: (tab: SubTabComunidades) => void;
  /** Cuantas solicitudes pendientes tengo, para el punto en "Mis comunidades". */
  pendientes?: number;
}

const TABS: Array<{ id: SubTabComunidades; label: string }> = [
  { id: "muro", label: "Muro" },
  { id: "mias", label: "Mis comunidades" },
  { id: "descubrir", label: "Descubrir" },
];

/**
 * Selector secundario del feed de comunidades (decision 9): un control
 * segmentado con pildora, a proposito distinto de los tabs del home, que son
 * texto extrabold de 19 px. Dos filas de tabs identicos se leerian como un
 * solo nivel.
 */
export function SubTabs({ active, onChange, pendientes = 0 }: SubTabsProps) {
  return (
    <div
      role="tablist"
      aria-label="Secciones de comunidades"
      className="mx-4 flex rounded-full bg-[color:var(--sidebar-bg)] p-1"
    >
      {TABS.map((tab) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => {
              if (selected) return;
              void hapticSelection();
              onChange(tab.id);
            }}
            className={cn(
              "relative flex-1 whitespace-nowrap rounded-full px-3 py-2 text-[13px] font-semibold transition-all",
              selected
                ? "bg-[color:var(--card)] text-[color:var(--fg)] shadow-[var(--shadow-sm)]"
                : "text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]",
            )}
          >
            {tab.label}
            {tab.id === "mias" && pendientes > 0 && (
              <span
                className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-[color:var(--brand)] px-1 text-[10px] font-bold text-white"
                aria-label={`${pendientes} solicitudes pendientes`}
              >
                {pendientes}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
