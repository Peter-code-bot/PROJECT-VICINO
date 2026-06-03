"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, useMotionValue, useTransform, animate } from "framer-motion";
import { Loader2 } from "lucide-react";

const PAGES_WITH_PULL_TO_REFRESH = ["/", "/buscar", "/chat", "/perfil"];

const PULL_THRESHOLD = 80;
const MAX_PULL = 150;

export function PullToRefreshWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  
  const [isRefreshing, setIsRefreshing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const startY = useRef<number>(0);
  const currentY = useRef<number>(0);
  const isPulling = useRef(false);
  
  const pullDistance = useMotionValue(0);
  const indicatorOpacity = useTransform(pullDistance, [0, PULL_THRESHOLD], [0, 1]);
  const indicatorScale = useTransform(pullDistance, [0, PULL_THRESHOLD], [0.5, 1]);
  // Start above screen and drop down
  const indicatorY = useTransform(pullDistance, [0, MAX_PULL], [-60, 60]);
  const indicatorRotate = useTransform(pullDistance, [0, PULL_THRESHOLD], [0, 180]);

  const isActiveRoute = PAGES_WITH_PULL_TO_REFRESH.includes(pathname);

  useEffect(() => {
    if (!isActiveRoute) return;
    
    const element = containerRef.current;
    if (!element) return;

    const handleTouchStart = (e: TouchEvent) => {
      // Only enable pull to refresh if we are exactly at the top of the page.
      // Asymmetric on purpose with the touchmove check below (`scrollY <= 0`):
      //   touchstart `> 0`  rejects when scrolled DOWN past the top.
      //   touchmove  `<= 0` accepts at the exact top (0) AND during iOS
      //                     overscroll rebound (negative scrollY) so PTR
      //                     stays armed through the rubber-band bounce.
      // Looks like a typo at first glance; it is not -- the two checks cover
      // different states and both are intentional.
      if (window.scrollY > 0 || isRefreshing) return;
      startY.current = e.touches[0]?.clientY ?? 0;
      isPulling.current = true;
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPulling.current || isRefreshing) return;
      
      const y = e.touches[0]?.clientY ?? 0;
      const deltaY = y - startY.current;

      if (deltaY > 0 && window.scrollY <= 0) {
        // We are pulling down while at the top
        currentY.current = Math.min(deltaY * 0.4, MAX_PULL); // add resistance
        pullDistance.set(currentY.current);
        
        // Prevent default scroll behavior
        if (e.cancelable) {
          e.preventDefault();
        }
      } else {
        // If they scroll back up or normal scroll occurs
        isPulling.current = false;
        animate(pullDistance, 0, { type: "spring", stiffness: 400, damping: 30 });
      }
    };

    const handleTouchEnd = async () => {
      if (!isPulling.current) return;
      isPulling.current = false;

      if (currentY.current >= PULL_THRESHOLD && !isRefreshing) {
        setIsRefreshing(true);
        // Snap indicator to threshold point for the refresh state
        animate(pullDistance, PULL_THRESHOLD, { type: "spring", stiffness: 300, damping: 20 });
        
        // Haptic feedback if Capacitor is available
        try {
          const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
          await Haptics.impact({ style: ImpactStyle.Light });
        } catch {
          // Ignore if web
        }

        // Trigger refresh
        router.refresh();

        // Wait a bit to show the spinner and simulate the load visually
        setTimeout(() => {
          setIsRefreshing(false);
          animate(pullDistance, 0, { type: "spring", stiffness: 300, damping: 25 });
          currentY.current = 0;
        }, 1200);
      } else {
        // Didn't reach threshold, spring back and hide
        animate(pullDistance, 0, { type: "spring", stiffness: 400, damping: 30 });
        currentY.current = 0;
      }
    };

    element.addEventListener("touchstart", handleTouchStart, { passive: true });
    element.addEventListener("touchmove", handleTouchMove, { passive: false });
    element.addEventListener("touchend", handleTouchEnd, { passive: true });
    element.addEventListener("touchcancel", handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener("touchstart", handleTouchStart);
      element.removeEventListener("touchmove", handleTouchMove);
      element.removeEventListener("touchend", handleTouchEnd);
      element.removeEventListener("touchcancel", handleTouchEnd);
    };
  }, [isActiveRoute, isRefreshing, router, pullDistance]);

  return (
    <div ref={containerRef} className="w-full h-full relative">
      {isActiveRoute && (
        <motion.div
          style={{
            y: indicatorY,
            opacity: indicatorOpacity,
            scale: indicatorScale,
          }}
          className="fixed top-0 left-1/2 z-[100] flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-card shadow-[0_4px_12px_rgba(0,0,0,0.15)] ring-1 ring-border"
        >
          <motion.div
            style={!isRefreshing ? { rotate: indicatorRotate } : undefined}
            animate={isRefreshing ? { rotate: 360 } : undefined}
            transition={
              isRefreshing ? { repeat: Infinity, ease: "linear", duration: 1 } : undefined
            }
          >
            <Loader2 className="h-5 w-5 text-brand" />
          </motion.div>
        </motion.div>
      )}
      
      {children}
    </div>
  );
}
