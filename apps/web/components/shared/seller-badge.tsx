import { cn } from "@/lib/utils";
import type { TrustLevel } from "@vicino/shared";
import { Shield, Check, Star, Crown } from "lucide-react";
import { VerifiedBadgeIcon } from "@/components/profile/trust-levels-modal";

const BADGE_CONFIG: Record<
  TrustLevel,
  { label: string; classes: string; icon: React.ElementType | null }
> = {
  nuevo: {
    label: "NUEVO",
    classes: "bg-transparent shadow-[inset_0_0_0_1px_rgba(160,164,161,0.4)] text-[#A0A4A1]",
    icon: Shield,
  },
  verificado: {
    label: "VERIFICADO",
    classes: "bg-[#7A4FCC] text-white",
    icon: VerifiedBadgeIcon,
  },
  confiable: {
    label: "CONFIABLE",
    classes: "bg-[#2E8773] text-white",
    icon: Check,
  },
  estrella: {
    label: "ESTRELLA",
    classes: "bg-[#3D7FC9] text-white",
    icon: Star,
  },
  elite: {
    label: "ÉLITE",
    classes: "bg-gradient-to-br from-[#F5DCA0] to-[#C99A3C] text-[#3A2A06]",
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
  const iconSize = size === "md" ? "h-3 w-3" : "h-2.5 w-2.5";

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-heading font-bold text-[8px] tracking-[1.2px] uppercase",
        config.classes,
        className
      )}
    >
      {Icon && (
        <Icon
          className={cn(
            iconSize,
            "shrink-0",
            level === "estrella" || level === "elite" ? "fill-current" : ""
          )}
        />
      )}
      {showLabel && config.label}
    </span>
  );
}
