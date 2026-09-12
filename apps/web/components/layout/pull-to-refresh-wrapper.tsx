"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter, usePathname } from "next/navigation";
import { motion, useMotionValue, useTransform, animate, useReducedMotion } from "framer-motion";
import { Loader2 } from "lucide-react";
import { hapticLight } from "@/lib/haptics";
import { beginNavigation, navigationFeedback } from "@/lib/observability/navigation-metrics";
import { gestureAxis, pageGestureBlocked } from "@/lib/navigation/gestures";

const PAGES = ["/", "/buscar", "/chat", "/perfil"];
const PULL_THRESHOLD = 80;
const MAX_PULL = 150;

export function PullToRefreshWrapper({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [isRefreshing, startTransition] = useTransition();
  const inFlight = useRef(false);
  const measurement = useRef(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const reducedMotion = useReducedMotion();
  const distance = useMotionValue(0);
  const opacity = useTransform(distance, [0, PULL_THRESHOLD], [0, 1]);
  const y = useTransform(distance, [0, MAX_PULL], [-60, 60]);
  const active = PAGES.includes(pathname);

  useEffect(() => {
    if (isRefreshing) navigationFeedback(measurement.current);
    if (!isRefreshing) inFlight.current = false;
    distance.stop();
    const target = isRefreshing && active ? PULL_THRESHOLD : 0;
    if (reducedMotion) distance.set(target);
    else animate(distance, target, { duration: 0.16, ease: "easeOut" });
    return () => distance.stop();
  }, [isRefreshing, pathname, active, reducedMotion, distance]);

  useEffect(() => {
    const element = containerRef.current;
    if (!active || !element) return;
    let gesture: { x: number; y: number; pull: number; axis: "x" | "y" | null } | null = null;
    const cancel = () => {
      gesture = null;
      if (inFlight.current) return;
      distance.stop();
      if (reducedMotion) distance.set(0);
      else animate(distance, 0, { duration: 0.16, ease: "easeOut" });
    };
    const start = (event: TouchEvent) => {
      gesture = null;
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1 || window.scrollY > 0 || inFlight.current || isRefreshing || pageGestureBlocked(event.target, element)) return;
      gesture = { x: touch.clientX, y: touch.clientY, pull: 0, axis: null };
    };
    const move = (event: TouchEvent) => {
      if (!gesture) return;
      const touch = event.touches[0];
      if (!touch || event.touches.length !== 1) { cancel(); return; }
      const dx = touch.clientX - gesture.x;
      const dy = touch.clientY - gesture.y;
      gesture.axis ??= gestureAxis(dx, dy);
      if (gesture.axis === "x" || dy < 0 || window.scrollY > 0) { cancel(); return; }
      if (gesture.axis !== "y") return;
      if (!event.cancelable) { cancel(); return; }
      event.preventDefault();
      gesture.pull = Math.min(dy * 0.4, MAX_PULL);
      distance.stop();
      distance.set(gesture.pull);
    };
    const end = () => {
      const completed = gesture;
      gesture = null;
      if (!completed || completed.pull < PULL_THRESHOLD || inFlight.current) { cancel(); return; }
      inFlight.current = true;
      // React follows completion of the RSC transition; refresh itself is void.
      measurement.current = beginNavigation(window.location.href, "refresh");
      startTransition(() => router.refresh());
      void hapticLight();
    };
    element.addEventListener("touchstart", start, { passive: true });
    element.addEventListener("touchmove", move, { passive: false });
    element.addEventListener("touchend", end, { passive: true });
    element.addEventListener("touchcancel", cancel, { passive: true });
    return () => {
      element.removeEventListener("touchstart", start);
      element.removeEventListener("touchmove", move);
      element.removeEventListener("touchend", end);
      element.removeEventListener("touchcancel", cancel);
      gesture = null;
    };
  }, [active, pathname, isRefreshing, reducedMotion, router, distance]);

  return (
    <div ref={containerRef} className="relative h-full w-full">
      {active && <motion.div aria-hidden style={{ y: reducedMotion ? 0 : y, opacity }}
        className="pointer-events-none fixed left-1/2 top-0 z-[100] flex h-10 w-10 -translate-x-1/2 items-center justify-center rounded-full bg-card shadow-md ring-1 ring-border">
        <Loader2 className={isRefreshing ? "h-5 w-5 animate-spin text-brand motion-reduce:animate-none" : "h-5 w-5 text-brand"} />
      </motion.div>}
      {isRefreshing && active && <span role="status" className="sr-only">Actualizando</span>}
      {children}
    </div>
  );
}
