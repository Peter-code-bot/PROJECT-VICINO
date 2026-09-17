"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TrustLevel } from "@vicino/shared";
import { Shield, Check, Star, Crown, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";

export function VerifiedBadgeIcon({ className = "w-6 h-6" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path
        d="M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Z"
        fill="#7A4FCC"
        stroke="#7A4FCC"
      />
      <path d="m9 12 2 2 4-4" stroke="#FFFFFF" strokeWidth="2.2" />
    </svg>
  );
}

interface TrustLevelInfo {
  key: TrustLevel;
  label: string;
  minPoints: number;
  description: string;
  renderIcon: () => React.ReactNode;
}

const TRUST_LEVELS_DETAILS: TrustLevelInfo[] = [
  {
    key: "nuevo",
    label: "Nuevo",
    minPoints: 0,
    description: "Perfil recién creado",
    renderIcon: () => (
      <div className="w-12 h-12 flex items-center justify-center shrink-0">
        <Shield className="w-7 h-7 text-neutral-500 dark:text-neutral-400 stroke-[1.8]" />
      </div>
    ),
  },
  {
    key: "verificado",
    label: "Verificado",
    minPoints: 50,
    description: "Identidad o datos confirmados",
    renderIcon: () => (
      <div className="w-12 h-12 rounded-full bg-[#7A4FCC]/25 dark:bg-[#7A4FCC]/35 flex items-center justify-center shrink-0">
        <VerifiedBadgeIcon className="w-7 h-7" />
      </div>
    ),
  },
  {
    key: "confiable",
    label: "Confiable",
    minPoints: 200,
    description: "Buena actividad y reseñas",
    renderIcon: () => (
      <div className="w-12 h-12 rounded-full bg-[#2E8773]/15 dark:bg-[#2E8773]/25 flex items-center justify-center shrink-0">
        <Check className="w-6 h-6 text-[#2E8773] stroke-[2.5]" />
      </div>
    ),
  },
  {
    key: "estrella",
    label: "Estrella",
    minPoints: 500,
    description: "Vendedor destacado en la comunidad",
    renderIcon: () => (
      <div className="w-12 h-12 rounded-full bg-[#3D7FC9]/15 dark:bg-[#3D7FC9]/25 flex items-center justify-center shrink-0">
        <Star className="w-6 h-6 text-[#3D7FC9] fill-current" />
      </div>
    ),
  },
  {
    key: "elite",
    label: "Élite",
    minPoints: 1000,
    description: "Mayor nivel de confianza",
    renderIcon: () => (
      <div className="w-12 h-12 rounded-full bg-gradient-to-br from-[#F5DCA0] to-[#C99A3C] flex items-center justify-center shrink-0">
        <Crown className="w-6 h-6 text-[#3A2A06] fill-current" />
      </div>
    ),
  },
];

interface TrustLevelsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  trustLevel?: TrustLevel | string | null;
  trustPoints?: number | null;
  displayName?: string | null;
  createdAt?: string | null;
}

export function TrustLevelsModal({
  open,
  onOpenChange,
  trustLevel,
  trustPoints,
  displayName,
  createdAt,
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
          <DialogTitle className="font-heading font-extrabold text-xl text-foreground leading-tight">
            Niveles de confianza
          </DialogTitle>
          {displayName && (
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              {displayName}
            </p>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-2.5 my-2">
          {TRUST_LEVELS_DETAILS.map((level) => {
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
                {level.renderIcon()}
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
        <div className="mt-1 pt-3.5 border-t border-border/70 space-y-2.5">
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

          {createdAt && (
            <div className="flex items-center justify-center gap-1.5 pt-1 text-xs text-muted-foreground">
              <Calendar className="w-3.5 h-3.5" />
              <span>
                Miembro desde {new Date(createdAt).toLocaleDateString("es-MX", { month: "long", year: "numeric" })}
              </span>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}