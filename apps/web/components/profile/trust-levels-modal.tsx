"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TrustLevel } from "@vicino/shared";
import { Shield, BadgeCheck, Check, Star, Crown } from "lucide-react";
import { cn } from "@/lib/utils";

interface TrustLevelInfo {
  key: TrustLevel;
  label: string;
  minPoints: number;
  description: string;
  icon: React.ElementType;
  iconContainerClass: string;
  iconClass: string;
}

const TRUST_LEVELS_DETAILS: TrustLevelInfo[] = [
  {
    key: "nuevo",
    label: "Nuevo",
    minPoints: 0,
    description: "Perfil recién creado",
    icon: Shield,
    iconContainerClass: "bg-neutral-100 dark:bg-white/10 ring-1 ring-black/5 dark:ring-white/10",
    iconClass: "text-neutral-500 dark:text-neutral-400",
  },
  {
    key: "verificado",
    label: "Verificado",
    minPoints: 50,
    description: "Identidad o datos confirmados",
    icon: BadgeCheck,
    iconContainerClass: "bg-[#7A4FCC]/15 dark:bg-[#7A4FCC]/25",
    iconClass: "text-[#7A4FCC]",
  },
  {
    key: "confiable",
    label: "Confiable",
    minPoints: 200,
    description: "Buena actividad y reseñas",
    icon: Check,
    iconContainerClass: "bg-[#2E8773]/15 dark:bg-[#2E8773]/25",
    iconClass: "text-[#2E8773] stroke-[2.5]",
  },
  {
    key: "estrella",
    label: "Estrella",
    minPoints: 500,
    description: "Vendedor destacado en la comunidad",
    icon: Star,
    iconContainerClass: "bg-[#3D7FC9]/15 dark:bg-[#3D7FC9]/25",
    iconClass: "text-[#3D7FC9] fill-current",
  },
  {
    key: "elite",
    label: "Élite",
    minPoints: 1000,
    description: "Mayor nivel de confianza",
    icon: Crown,
    iconContainerClass: "bg-gradient-to-br from-[#F5DCA0] to-[#C99A3C]",
    iconClass: "text-[#3A2A06] fill-current",
  },
];

interface TrustLevelsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trustLevel?: TrustLevel | string | null;
  trustPoints?: number | null;
}

export function TrustLevelsModal({
  open,
  onOpenChange,
  trustLevel,
  trustPoints,
}: TrustLevelsModalProps) {
  const points = trustPoints ?? 0;

  // Find current level based on trustLevel prop or points
  const currentLevelKey = (trustLevel as TrustLevel) ?? "nuevo";
  const fallbackLevel = TRUST_LEVELS_DETAILS[0] as TrustLevelInfo;
  const currentLevelObj: TrustLevelInfo =
    TRUST_LEVELS_DETAILS.find((l) => l.key === currentLevelKey) ??
    [...TRUST_LEVELS_DETAILS].reverse().find((l) => l.minPoints <= points) ??
    fallbackLevel;

  const nextLevelObj = TRUST_LEVELS_DETAILS.find((l) => l.minPoints > points);
  const currentMin = currentLevelObj.minPoints;
  const nextMin = nextLevelObj ? nextLevelObj.minPoints : points;
  const progressPercent = nextLevelObj
    ? Math.min(100, Math.max(0, ((points - currentMin) / (nextMin - currentMin)) * 100))
    : 100;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] rounded-[28px] p-6 shadow-2xl border border-border">
        <DialogHeader className="pb-1">
          <DialogTitle className="font-heading font-extrabold text-xl text-foreground">
            Niveles de confianza
          </DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-2.5 my-2">
          {TRUST_LEVELS_DETAILS.map((level) => {
            const Icon = level.icon;
            const isCurrent = level.key === currentLevelObj.key;

            return (
              <div
                key={level.key}
                className={cn(
                  "flex items-center gap-3.5 p-3 rounded-2xl transition-colors",
                  isCurrent
                    ? "bg-black/[0.03] dark:bg-white/[0.05] ring-1 ring-[color:var(--brand)]/30 shadow-sm"
                    : "opacity-85 hover:opacity-100"
                )}
              >
                <div
                  className={cn(
                    "w-12 h-12 rounded-full flex items-center justify-center shrink-0",
                    level.iconContainerClass
                  )}
                >
                  <Icon className={cn("w-6 h-6", level.iconClass)} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <h3 className="font-heading font-bold text-base text-foreground leading-tight">
                      {level.label}
                    </h3>
                    {isCurrent && (
                      <span className="text-[10px] font-bold uppercase tracking-wider bg-[color:var(--brand)]/15 text-[color:var(--brand)] px-2 py-0.5 rounded-full">
                        Nivel actual
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {level.description}
                  </p>
                </div>
              </div>
            );
          })}
        </div>

        {/* User Progress Footer */}
        <div className="mt-1 pt-3.5 border-t border-border/70 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <span className="font-semibold text-foreground">
              {points} pts acumulados
            </span>
            {nextLevelObj ? (
              <span className="text-muted-foreground text-[11px]">
                Faltan{" "}
                <span className="font-semibold text-foreground">
                  {nextLevelObj.minPoints - points} pts
                </span>{" "}
                para {nextLevelObj.label}
              </span>
            ) : (
              <span className="font-medium text-[#C99A3C] text-[11px]">
                Nivel máximo alcanzado
              </span>
            )}
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-black/5 dark:bg-white/10">
            <div
              className="h-full rounded-full bg-[color:var(--trust-emerald)] transition-all duration-500"
              style={{ width: `${Math.max(5, progressPercent)}%` }}
            />
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
