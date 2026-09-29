"use client";

import { useEffect, useRef, type ComponentProps } from "react";
import Link, { useLinkStatus } from "next/link";
import { createPortal } from "react-dom";
import { hapticLight } from "@/lib/haptics";

function Pending({ busyRef }: { busyRef: { current: boolean } }) {
  const { pending } = useLinkStatus();
  useEffect(() => { busyRef.current = pending; }, [busyRef, pending]);
  return pending ? createPortal(<span role="status" data-navigation-feedback="sell" className="fixed bottom-24 left-1/2 z-50 -translate-x-1/2 whitespace-nowrap rounded-full bg-background px-4 py-2 text-sm text-foreground shadow-sm">Abriendo publicación…</span>, document.body) : null;
}

/** Next owns the transition; the native bridge can keep clicking nav-vender. */
export function SellLink({ children, ...props }: Omit<ComponentProps<typeof Link>, "href">) {
  const busy = useRef(false);
  return <Link {...props} href="/vender" prefetch={false} data-sell-prefetch="true"
    onClick={() => { void hapticLight(); }}
    onNavigate={event => { if (busy.current) event.preventDefault(); else busy.current = true; }}>
    {children}<Pending busyRef={busy} />
  </Link>;
}
