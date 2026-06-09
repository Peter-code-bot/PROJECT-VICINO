import { cn } from "@/lib/utils";
import type { TrustLevel } from "@vicino/shared";
import { Check, Star, Crown } from "lucide-react";

const BADGE_CONFIG: Record<
  TrustLevel,
  { label: string; classes: string; icon: React.ElementType | null }
> = {
  nuevo: {
    label: "NUEVO",
    classes: "bg-transparent shadow-[inset_0_0_0_1px_rgba(160,164,161,0.4)] text-[#A0A4A1]",
    icon: null,
  },
  verificado: {
    label: "VERIFICADO",
    classes: "bg-[#7A4FCC] text-white",
    icon: null,
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
  size = "sm", // Ignored for now based on spec
  className,
}: SellerBadgeProps) {
  const config = BADGE_CONFIG[level];
  const Icon = config.icon;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded font-heading font-bold text-[8px] tracking-[1.2px] uppercase",
        config.classes,
        className
      )}
    >
      {Icon && <Icon className="h-2 w-2 fill-current" />}
      {showLabel && config.label}
    </span>
  );
}
