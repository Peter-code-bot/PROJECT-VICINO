import Link from "next/link";
import Image from "next/image";
import { cn } from "@/lib/utils";

export interface FollowedStore {
  id: string;
  name: string;
  letter: string;
  imgUrl?: string;
  hasRecentPosts: boolean;
}

export interface FollowingRailProps {
  stores: FollowedStore[];
}

export function FollowingRail({ stores }: FollowingRailProps) {
  if (!stores || stores.length === 0) return null;

  return (
    <section className="mb-6 pt-2">
      <div className="flex items-center justify-between px-4 mb-3">
        <h2 className="font-display font-medium text-[15.5px] text-[var(--fg)]">
          Tiendas que sigues <span className="text-[var(--fg-muted)] font-normal">· {stores.length}</span>
        </h2>
        <Link
          href="/perfil/siguiendo"
          className="text-[13.5px] font-medium text-[var(--brand-hi)] hover:text-[var(--brand)] transition-colors"
        >
          Gestionar
        </Link>
      </div>

      <div className="flex overflow-x-auto gap-4 px-4 pb-2 snap-x scrollbar-none" style={{ scrollbarWidth: "none" }}>
        {stores.map((store) => (
          <Link
            key={store.id}
            href={`/vendedor/${store.id}`}
            className="flex flex-col items-center gap-1.5 snap-start shrink-0"
            style={{ width: "60px" }}
            // A3 sub-fase 3.6: carousel de tiendas seguidas (N items). El Link
            // "Gestionar" arriba (linea ~26) mantiene prefetch default.
            prefetch={false}
          >
            <div
              className={cn(
                "relative rounded-[20px] p-[2px]", // +2px extra space for gradient
                store.hasRecentPosts
                  ? "bg-gradient-to-tr from-[var(--brand)] to-[var(--brand-hi)]"
                  : "bg-transparent"
              )}
            >
              <div className="w-[56px] h-[56px] rounded-[18px] bg-[var(--bg)] p-[2px]">
                <div className="w-full h-full rounded-[16px] bg-[var(--bg-elev-2)] overflow-hidden flex items-center justify-center font-bold text-[var(--fg-muted)] text-xl relative">
                  {store.imgUrl ? (
                    <Image src={store.imgUrl} alt={store.name} fill className="object-cover" />
                  ) : (
                    store.letter
                  )}
                </div>
              </div>
            </div>
            <span className="text-[11px] font-medium text-[var(--fg)] text-center truncate w-full px-0.5">
              {store.name}
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
}
