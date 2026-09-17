"use client";

import { useState } from "react";
import { Shield, Check, Star, Crown } from "lucide-react";
import { TRUST_LEVELS, type TrustLevel } from "@vicino/shared";
import { TrustLevelsModal, VerifiedBadgeIcon } from "@/components/profile/trust-levels-modal";
import { cn } from "@/lib/utils";

interface TrustProgressBadgeProps {
  profile: {
    trust_level: string | null;
    trust_points: number | null;
    is_verified?: boolean | null;
  } | null;
  displayName?: string | null;
  createdAt?: string | null;
  className?: string;
}

function renderBadgeCenterIcon(level: string) {
  switch (level) {
    case "verificado":
      return <VerifiedBadgeIcon className="w-5 h-5" />;
    case "confiable":
      return <Check className="w-4 h-4 text-[#2E8773] stroke-[3]" />;
    case "estrella":
      return <Star className="w-4 h-4 text-[#3D7FC9] fill-[#3D7FC9]" />;
    case "elite":
      return <Crown className="w-4 h-4 text-[#C99A3C] fill-[#C99A3C]" />;
    case "nuevo":
    default:
      return <Shield className="w-5 h-5 text-neutral-900 dark:text-neutral-100 stroke-[1.75]" />;
  }
}

export function TrustProgressBadge({
  profile,
  displayName,
  createdAt,
  className,
}: TrustProgressBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);

  const points = profile?.trust_points ?? 0;
  const sorted = Object.entries(TRUST_LEVELS).sort((a, b) => a[1].minPoints - b[1].minPoints);
  const next = sorted.find(([, v]) => v.minPoints > points);
  const current = sorted.filter(([, v]) => v.minPoints <= points).pop();
  const currentMin = current ? current[1].minPoints : 0;
  const nextMin = next ? next[1].minPoints : points;
  const progress = next
    ? Math.min(100, Math.max(0, ((points - currentMin) / (nextMin - currentMin)) * 100))
    : 100;

  // Active level calculation
  const currentLevelKey = (profile?.trust_level as TrustLevel) ?? (current?.[0] as TrustLevel) ?? "nuevo";

  // SVG circular geometry
  const size = 44;
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2 - 2;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (circumference * progress) / 100;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          "relative flex items-center justify-center w-11 h-11 rounded-full bg-white dark:bg-card border border-black/10 dark:border-white/10 shadow-xs transition-transform duration-150 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--brand)] shrink-0",
          className
        )}
        title="Ver niveles de confianza"
        aria-label="Ver niveles de confianza"
      >
        <svg
          className="w-11 h-11 -rotate-90 transform"
          viewBox={`0 0 ${size} ${size}`}
        >
          {/* Track */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="currentColor"
            strokeWidth={strokeWidth}
            fill="none"
            className="text-black/10 dark:text-white/10"
          />
          {/* Progress Arc */}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="#2E8773"
            strokeWidth={strokeWidth}
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            fill="none"
            className="transition-all duration-500 ease-out"
          />
        </svg>

        {/* Center Dynamic Icon based on User Level */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          {renderBadgeCenterIcon(currentLevelKey)}
        </div>
      </button>

      <TrustLevelsModal
        open={isOpen}
        onOpenChange={setIsOpen}
        trustLevel={profile?.trust_level}
        trustPoints={profile?.trust_points}
        displayName={displayName}
        createdAt={createdAt}
      />
    </>
  );
}