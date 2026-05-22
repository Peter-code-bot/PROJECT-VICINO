import { cn } from "@/lib/utils";
import type { TrustLevel } from "@vicino/shared";
import { Shield, ShieldCheck, Star, Crown } from "lucide-react";

const BADGE_CONFIG: Record<
  TrustLevel,
  { label: string; classes: string; icon: typeof Shield }
> = {
  nuevo: {
    label: "Nuevo",
    classes:
      "bg-[color:var(--bg-elev-2)] text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)]",
    icon: Shield,
  },
  verificado: {
    label: "Verificado",
    classes:
      "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]",
    icon: ShieldCheck,
  },
  confiable: {
    label: "Confiable",
    classes:
      "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]",
    icon: ShieldCheck,
  },
  estrella: {
    label: "Estrella",
    classes:
      "bg-[rgba(212,168,83,0.18)] text-gold shadow-[inset_0_0_0_1px_rgba(212,168,83,0.30)]",
    icon: Star,
  },
  elite: {
    label: "Élite",
    classes:
      "bg-[rgba(212,168,83,0.22)] text-gold shadow-[inset_0_0_0_1px_rgba(212,168,83,0.36)]",
    icon: Crown,
  },
};

interface SellerBadgeProps {
  level: TrustLevel;
  showLabel?: boolean;
  size?: "sm" | "md";
  className?: string;
}

export function SellerBadge({
  level,
  showLabel = true,
  size = "sm",
  className,
}: SellerBadgeProps) {
  const config = BADGE_CONFIG[level];
  const Icon = config.icon;
  const iconSize = size === "sm" ? "h-3 w-3" : "h-4 w-4";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium transition-colors",
        config.classes,
        className
      )}
    >
      <Icon className={iconSize} />
      {showLabel && config.label}
    </span>
  );
}
