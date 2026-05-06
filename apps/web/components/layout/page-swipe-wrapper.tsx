"use client";

import { usePageSwipe } from "@/hooks/use-page-swipe";

export function PageSwipeWrapper({ children }: { children: React.ReactNode }) {
  const handlers = usePageSwipe();
  return (
    <div {...handlers} className="contents">
      {children}
    </div>
  );
}
