import Image from "next/image";
import { HapticLink } from "@/components/shared/haptic-link";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/ui/user-avatar";

import type { RankedSeller } from "@/lib/rankings/types";

interface PodioRankingProps {
  top3: RankedSeller[];
}

export function PodioRanking({ top3 }: PodioRankingProps) {
  if (top3.length === 0) return null;

  const first = top3[0] ?? null;
  const second = top3[1] ?? null;
  const third = top3[2] ?? null;

  return (
    <div className="grid grid-cols-3 items-end gap-3 px-4 pt-12">
      <div className="flex justify-center">
        {second ? <PodioSlot seller={second} position={2} /> : <div />}
      </div>
      <div className="flex justify-center">
        {first ? <PodioSlot seller={first} position={1} /> : <div />}
      </div>
      <div className="flex justify-center">
        {third ? <PodioSlot seller={third} position={3} /> : <div />}
      </div>
    </div>
  );
}

interface PodioSlotProps {
  seller: RankedSeller;
  position: 1 | 2 | 3;
}

function PodioSlot({ seller, position }: PodioSlotProps) {
  const isFirst = position === 1;
  const scoreText = Math.round(seller.composite_score).toLocaleString("es-MX");
  const name = seller.display_name ?? "Vendedor";

  return (
    <HapticLink
      href={`/vendedor/${seller.seller_id}`}
      className={cn(
        "flex flex-col items-center text-center min-w-0 max-w-[8.5rem] group active:scale-95 transition-transform",
        isFirst && "-mt-6",
      )}
      // A3 sub-fase 3.6: slot del podio en /rankings + strip home. Top 3 +
      // ranking-list por debajo, prefetch default lanza 13+ GETs a /vendedor/*.
      prefetch={false}
    >
      <div className="relative z-10 flex flex-col items-center">
        {/* Crown Image */}
        <div className={cn("absolute z-20 pointer-events-none", isFirst ? "-top-10 w-[4.5rem] h-[4.5rem]" : "-top-7 w-14 h-14")}>
          <Image
            src={`/images/rankings/crown-${position}.webp`}
            alt={`Corona lugar ${position}`}
            width={isFirst ? 72 : 56}
            height={isFirst ? 72 : 56}
            sizes={isFirst ? "72px" : "56px"}
            className="w-full h-full object-contain drop-shadow-2xl"
          />
        </div>

        {/* Ring and Avatar */}
        <div 
          className={cn(
            "relative rounded-full p-[5px] z-10",
            position === 1 && "bg-gradient-to-br from-[#FFF5C3] via-[#D4AF37] to-[#8A5A19] shadow-[0_10px_20px_rgba(212,168,83,0.3),inset_0_2px_4px_rgba(255,255,255,0.6),inset_0_-4px_6px_rgba(0,0,0,0.4)]",
            position === 2 && "bg-gradient-to-br from-[#FFFFFF] via-[#B0B5B9] to-[#5F6368] shadow-[0_10px_20px_rgba(176,181,185,0.2),inset_0_2px_4px_rgba(255,255,255,0.8),inset_0_-4px_6px_rgba(0,0,0,0.4)]",
            position === 3 && "bg-gradient-to-br from-[#FFD3A3] via-[#CD7F32] to-[#734A12] shadow-[0_10px_20px_rgba(205,127,50,0.2),inset_0_2px_4px_rgba(255,255,255,0.5),inset_0_-4px_6px_rgba(0,0,0,0.4)]"
          )}
        >
          <div className="rounded-full bg-[color:var(--bg)] p-0.5">
            <UserAvatar
              src={seller.foto}
              name={name}
              size={isFirst ? "xl" : "lg"}
              className="border-2 border-transparent"
            />
          </div>
        </div>

        {/* Position Badge overlaying bottom of ring */}
        <div
          className={cn(
            "absolute z-30 -bottom-3 flex items-center justify-center rounded-full font-display font-bold tabular-nums shadow-[0_4px_10px_rgba(0,0,0,0.5)] border-2 border-[color:var(--bg)] bg-white text-black",
            isFirst ? "h-8 w-8 text-base" : "h-7 w-7 text-sm"
          )}
        >
          {position}
        </div>
      </div>
      <p
        className={cn(
          "mt-2 w-full truncate text-sm font-medium",
          isFirst ? "text-foreground group-hover:text-primary transition-colors" : "text-muted-foreground group-hover:text-foreground transition-colors",
        )}
        title={name}
      >
        {name}
      </p>
      <p
        className={cn(
          "mt-0.5 font-display text-lg leading-none tabular-nums",
          isFirst ? "text-gold" : "text-foreground",
        )}
      >
        {scoreText}
      </p>

    </HapticLink>
  );
}
