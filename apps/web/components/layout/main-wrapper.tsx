"use client";

import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export function MainWrapper({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  // Check if we are inside a chat detail page
  const isChatDetail = pathname?.startsWith("/chat/") && pathname !== "/chat/";

  return (
    <main className={cn("flex-1", !isChatDetail && "pb-20 md:pb-0")}>
      {children}
    </main>
  );
}
