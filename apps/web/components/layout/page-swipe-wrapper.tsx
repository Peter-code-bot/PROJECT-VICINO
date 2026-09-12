"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, useMotionValue, animate, useReducedMotion } from "framer-motion";
import { hapticLight } from "@/lib/haptics";
import { beginNavigation, navigationFeedback } from "@/lib/observability/navigation-metrics";
import { gestureAxis, pageGestureBlocked } from "@/lib/navigation/gestures";

import { TAB_ROUTES } from "@/lib/navigation/tab-routes";

const PAGES: readonly string[] = TAB_ROUTES;
const EDGE_GUARD_PX = 20;

interface PageSwipeWrapperProps {
  children: React.ReactNode;
  isVendedor: boolean;
}

export function PageSwipeWrapper({ children }: PageSwipeWrapperProps) {
  const router = useRouter();
  const pathname = usePathname();
  const currentIndex = PAGES.indexOf(pathname);
  const elementRef = useRef<HTMLDivElement>(null);
  const inFlight = useRef(false);
  const measurement = useRef(0);
  const suppressClick = useRef(false);
  const [isPending, startTransition] = useTransition();
  const reducedMotion = useReducedMotion();
  const x = useMotionValue(0);

  useEffect(() => {
    if (isPending) navigationFeedback(measurement.current);
    if (!isPending) inFlight.current = false;
    x.stop();
    x.set(0);
    return () => x.stop();
  }, [pathname, isPending, x]);

  useEffect(() => {
    const element = elementRef.current;
    if (!element || currentIndex < 0) return;
    let gesture: { x: number; y: number; dx: number; axis: "x" | "y" | null } | null = null;
    const reset = () => {
      gesture = null;
      x.stop();
      if (reducedMotion) x.set(0);
      else animate(x, 0, { duration: 0.16, ease: "easeOut" });
    };
    const start = (event: TouchEvent) => {
      gesture = null;
      suppressClick.current = false;
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1 || inFlight.current || isPending || pageGestureBlocked(event.target, element)) return;
      if (touch.clientX < EDGE_GUARD_PX || touch.clientX > window.innerWidth - EDGE_GUARD_PX) return;
      x.stop();
      gesture = { x: touch.clientX, y: touch.clientY, dx: 0, axis: null };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1) { reset(); return; }
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      gesture.axis ??= gestureAxis(dx, dy);
      if (gesture.axis === "y") { reset(); return; }
      if (gesture.axis !== "x") return;
      // An ancestor pan-y would also disable native child carousels. Cancel
      // default only after this gesture has acquired horizontal ownership.
      if (!event.cancelable) { reset(); return; }
      event.preventDefault();
      suppressClick.current = true;
      gesture.dx = dx;
      const next = currentIndex + (dx < 0 ? 1 : -1);
      x.set(reducedMotion || !PAGES[next] ? 0 : Math.max(-48, Math.min(48, dx * 0.2)));
    };
    const end = () => {
      const completed = gesture;
      reset();
      if (!completed || completed.axis !== "x" || Math.abs(completed.dx) < 50 || inFlight.current) return;
      const target = PAGES[currentIndex + (completed.dx < 0 ? 1 : -1)];
      if (!target) return;
      inFlight.current = true;
      // RSC can take time: retain a visible surface, and start routing now.
      x.stop();
      x.set(0);
      measurement.current = beginNavigation(target, "swipe");
      startTransition(() => router.push(target));
      void hapticLight();
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: true });
    element.addEventListener("touchcancel", reset, { passive: true });
    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", reset);
      gesture = null;
      x.stop();
      x.set(0);
    };
  }, [currentIndex, pathname, router, isPending, reducedMotion, x]);

  if (currentIndex < 0) return <>{children}</>;

  return (
    <motion.div ref={elementRef} style={{ x }} className="relative h-full w-full"
      onClickCapture={(event) => {
        if (!suppressClick.current || event.detail === 0) return;
        suppressClick.current = false;
        event.preventDefault();
        event.stopPropagation();
      }}>
      {isPending && <p role="status" className="pointer-events-none absolute inset-x-0 top-0 z-30 bg-bg px-4 py-1 text-xs text-fg-muted">Abriendo…</p>}
      {children}
    </motion.div>
  );
}
