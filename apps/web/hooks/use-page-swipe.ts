"use client";

import { useRouter, usePathname } from "next/navigation";
import { useSwipeable, type SwipeableHandlers } from "react-swipeable";

const PAGES = ["/", "/buscar", "/chat", "/perfil"] as const;

/**
 * Selectors that mark a child element as "owns its own horizontal gestures".
 * Touches that start inside any of these are absorbed by their own scroll/drag
 * handlers (browser native overflow-x or Embla viewport) and must NOT trigger
 * page navigation.
 *   - .overflow-x-auto / .overflow-x-scroll: native horizontal scrollers
 *     (filter chips in /buscar, category chips in /, etc.)
 *   - [data-no-page-swipe]: opt-out marker for components that manage their
 *     own horizontal touch (Embla carousels — overflow-hidden parent, can't
 *     be detected generically).
 */
const SWIPE_IGNORE_SELECTOR =
  "[data-no-page-swipe], .overflow-x-auto, .overflow-x-scroll";

function startedInsideHorizontalScroller(target: EventTarget | null): boolean {
  if (!target || !(target instanceof Element)) return false;
  return target.closest(SWIPE_IGNORE_SELECTOR) !== null;
}

/**
 * Horizontal swipe navigation between marketplace root pages.
 *   Swipe LEFT  -> next page  (estandar movil: TikTok / Instagram / iOS Pages)
 *   Swipe RIGHT -> previous page
 * Skips when:
 *   - Current path is not one of the 4 root pages (subroutes excluded by design)
 *   - A drawer/modal is open (detected via body overflow lock)
 *   - At a list end (no wrap)
 * Never navigates to /vender.
 */
export function usePageSwipe(): SwipeableHandlers {
  const router = useRouter();
  const pathname = usePathname();

  const currentIndex = (PAGES as readonly string[]).indexOf(pathname);

  const navigate = async (newIndex: number): Promise<void> => {
    if (currentIndex < 0) return;
    const target = PAGES[newIndex];
    if (!target) return;
    if (typeof document !== "undefined" && document.body.style.overflow === "hidden") {
      return;
    }

    try {
      const { Haptics, ImpactStyle } = await import("@capacitor/haptics");
      await Haptics.impact({ style: ImpactStyle.Light });
    } catch {
      // Not on Capacitor or haptics unavailable — silent degrade.
    }

    router.push(target);
  };

  return useSwipeable({
    onSwipedLeft: (eventData) => {
      if (startedInsideHorizontalScroller(eventData.event.target)) return;
      navigate(currentIndex + 1);
    },
    onSwipedRight: (eventData) => {
      if (startedInsideHorizontalScroller(eventData.event.target)) return;
      navigate(currentIndex - 1);
    },
    delta: 80,
    trackMouse: false,
    preventScrollOnSwipe: false,
    swipeDuration: 500,
  });
}
