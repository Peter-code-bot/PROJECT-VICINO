"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import {
  motion,
  useMotionValue,
  animate,
  useDragControls,
  type PanInfo,
} from "framer-motion";

/**
 * Horizontal swipe navigation between marketplace root pages, Instagram-style.
 *   Swipe LEFT  -> next page
 *   Swipe RIGHT -> previous page
 * Skips when:
 *   - Current path is not one of the root pages in PAGES (subroutes preserved)
 *   - A drawer/modal is open (detected via body overflow lock)
 *   - Touch starts inside a child horizontal scroller / [data-no-page-swipe]
 *   - Touch starts within EDGE_GUARD_PX of either screen edge (preserves OS
 *     back/forward gestures on Capacitor Android / iOS)
 *   - Pointer is not a touch (preserves trackMouse:false from prior impl)
 *   - At a list end (no wrap)
 *
 * /vender is excluded from the swipe sequence so users cannot swipe to it.
 * Tapping the + icon is the only way to reach it.
 */
const PAGES = ["/", "/buscar", "/chat", "/perfil"];
const SWIPE_THRESHOLD_OFFSET = 60; // px — minimum drag distance to commit
const SWIPE_THRESHOLD_VELOCITY = 500; // px/sec — fast flick commits at lower offset
const EDGE_GUARD_PX = 30; // px from each screen edge reserved for OS gestures
const COMMIT_DURATION = 0.2; // seconds for the off-screen exit animation

const SWIPE_IGNORE_SELECTOR =
  "[data-no-page-swipe], .overflow-x-auto, .overflow-x-scroll";

function startedInsideHorizontalScroller(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return target.closest(SWIPE_IGNORE_SELECTOR) !== null;
}

interface PageSwipeWrapperProps {
  children: React.ReactNode;
  /** Phase 9: when false, /vender is excluded from the swipe sequence. */
  isVendedor: boolean;
}

export function PageSwipeWrapper({ children, isVendedor }: PageSwipeWrapperProps) {
  const router = useRouter();
  const pathname = usePathname();
  const x = useMotionValue(0);
  const dragControls = useDragControls();
  const cancelledRef = useRef(false);

  const currentIndex = PAGES.indexOf(pathname);

  // Prefetch adjacent root pages so router.push lands instantly post-swipe.
  useEffect(() => {
    if (currentIndex < 0) return;
    PAGES.forEach((p, i) => {
      if (i !== currentIndex) router.prefetch(p);
    });
  }, [currentIndex, router, PAGES]);

  // Reset x on route change in case the wrapper persists across navigations
  // (App Router preserves the layout, so this component does not unmount).
  useEffect(() => {
    x.set(0);
  }, [pathname, x]);

  // Subroute or non-marketplace path: render children without swipe wrapper.
  if (currentIndex < 0) {
    return <>{children}</>;
  }

  const canGoNext = currentIndex < PAGES.length - 1;
  const canGoPrev = currentIndex > 0;

  function handlePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    cancelledRef.current = false;

    // Touch-only: desktop mouse drag stays disabled (matches prior behavior).
    if (e.pointerType !== "touch") {
      cancelledRef.current = true;
      return;
    }

    // Edge guards reserve the leftmost/rightmost EDGE_GUARD_PX for the OS
    // back-swipe (Android) / forward gesture (iOS) so we don't fight the system.
    if (
      e.clientX < EDGE_GUARD_PX ||
      e.clientX > window.innerWidth - EDGE_GUARD_PX
    ) {
      cancelledRef.current = true;
      return;
    }

    // Don't hijack horizontal gestures owned by carousels, chip rows, or any
    // child marked with data-no-page-swipe.
    if (startedInsideHorizontalScroller(e.target)) {
      cancelledRef.current = true;
      return;
    }

    // Don't swipe while a drawer/modal locks body scroll.
    if (
      typeof document !== "undefined" &&
      document.body.style.overflow === "hidden"
    ) {
      cancelledRef.current = true;
      return;
    }

    dragControls.start(e);
  }

  async function handleDragEnd(_event: unknown, info: PanInfo) {
    if (cancelledRef.current) {
      animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
      return;
    }

    const swipedLeft =
      info.offset.x < -SWIPE_THRESHOLD_OFFSET ||
      info.velocity.x < -SWIPE_THRESHOLD_VELOCITY;
    const swipedRight =
      info.offset.x > SWIPE_THRESHOLD_OFFSET ||
      info.velocity.x > SWIPE_THRESHOLD_VELOCITY;

    if (swipedLeft && canGoNext) {
      await navigateTo(currentIndex + 1, "left");
    } else if (swipedRight && canGoPrev) {
      await navigateTo(currentIndex - 1, "right");
    } else {
      animate(x, 0, { type: "spring", stiffness: 300, damping: 30 });
    }
  }

  async function navigateTo(newIndex: number, direction: "left" | "right") {
    const target = PAGES[newIndex];
    if (!target) return;

    // Light haptic feedback on commit (Capacitor only — silent on web).
    try {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Not on Capacitor or plugin unavailable — silent degrade.
    }

    // Slide the current content fully off-screen in the swipe direction, then
    // navigate. The pathname-watcher useEffect resets x to 0 after the new
    // route mounts.
    const targetX =
      direction === "left" ? -window.innerWidth : window.innerWidth;
    await animate(x, targetX, {
      duration: COMMIT_DURATION,
      ease: "easeOut",
    }).finished;
    router.push(target);
  }

  return (
    <motion.div
      drag="x"
      dragDirectionLock
      dragListener={false}
      dragControls={dragControls}
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={0.5}
      // Use clip-path instead of overflow-hidden: it clips off-screen content
      // during the swipe animation without establishing a new overflow ancestor,
      // so descendant `position: sticky` controls (e.g. /vender submit button)
      // continue to stick to the viewport rather than this wrapper.
      style={{ x, clipPath: "inset(0)" }}
      onPointerDown={handlePointerDown}
      onDragEnd={handleDragEnd}
      className="h-full w-full"
    >
      {children}
    </motion.div>
  );
}
