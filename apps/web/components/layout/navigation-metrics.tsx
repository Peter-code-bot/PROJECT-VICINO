"use client";

import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { createNavigationMetrics, installNavigationMetrics, type NavigationSample } from "@/lib/observability/navigation-metrics";

declare global { interface Window { __vicinoNavigationMetrics?: () => NavigationSample[] } }

export function NavigationMetrics() {
  const pathname = usePathname();
  const search = useSearchParams().toString();
  const notifyCommit = useRef<(path: string) => void>(() => {});
  useEffect(() => {
    const metrics = createNavigationMetrics();
    const routeKey = (url: URL) => {
      // Home category ordering is local state, not a new server navigation.
      if (url.pathname === "/") url.searchParams.delete("cats");
      return url.pathname + (url.searchParams.size ? `?${url.searchParams.toString()}` : "");
    };
    let current = routeKey(new URL(location.href));
    let frame = 0;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const markers = () => [...document.querySelectorAll<HTMLElement>("[data-navigation-ready]")];
    const inspect = () => {
      frame = 0;
      if (!metrics.active()) return;
      for (const node of markers()) metrics.ready(node.dataset.navigationReady!, node.dataset.navigationKind ?? "");
      if (!metrics.active()) clearTimeout(timeout);
    };
    const schedule = () => { if (metrics.active() && !frame) frame = requestAnimationFrame(inspect); };
    const begin = (target: string, source: "link" | "swipe" | "refresh" | "back_forward") => {
      clearTimeout(timeout);
      const url = new URL(target, location.href);
      const id = metrics.begin(routeKey(url), current, source, markers().map(node => node.dataset.navigationReady!));
      timeout = setTimeout(() => metrics.close("timeout"), 30_000);
      return id;
    };
    const click = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      if (event.target instanceof Element && event.target.closest("button,input,textarea,select")) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      if (!link || link.hasAttribute("download") || (link.target && link.target !== "_self")) return;
      const url = new URL(link.href, location.href);
      if (url.origin !== location.origin || routeKey(url) === current) return;
      begin(url.href, "link");
    };
    const pop = () => { if (routeKey(new URL(location.href)) !== current) begin(location.href, "back_forward"); };
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["data-navigation-ready"] });
    notifyCommit.current = target => { current = routeKey(new URL(target, location.href)); metrics.commit(current); schedule(); };
    installNavigationMetrics({ begin, feedback: id => metrics.feedback(id) });
    window.__vicinoNavigationMetrics = metrics.read;
    document.addEventListener("click", click, true);
    window.addEventListener("popstate", pop);
    return () => {
      observer.disconnect(); cancelAnimationFrame(frame); clearTimeout(timeout);
      document.removeEventListener("click", click, true); window.removeEventListener("popstate", pop);
      notifyCommit.current = () => {}; installNavigationMetrics(undefined); metrics.clear();
      delete window.__vicinoNavigationMetrics;
    };
  }, []);
  useEffect(() => { notifyCommit.current(pathname + (search ? `?${search}` : "")); }, [pathname, search]);
  return null;
}
