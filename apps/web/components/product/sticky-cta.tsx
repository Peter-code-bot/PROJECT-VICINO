"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { Edit3, Eye, MessageCircle, ShoppingBag } from "lucide-react";

interface StickyCtaProps {
  productId: string;
  sellerId: string;
  isOwner: boolean;
  hasSession: boolean;
}

const SHELL =
  "fixed inset-x-0 bottom-0 z-30 flex items-center gap-2 border-t border-border bg-bg px-4 pt-3";
const SAFE_PAD = "calc(env(safe-area-inset-bottom) + 0.75rem)";

export function StickyCta({
  productId,
  sellerId,
  isOwner,
  hasSession,
}: StickyCtaProps) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const isVisitorPreview = searchParams.get("preview") === "visitor";
  const effectiveIsOwner = isOwner && !isVisitorPreview;

  // Owner variant (not in preview).
  if (effectiveIsOwner) {
    const previewUrl = `${pathname}?preview=visitor`;
    return (
      <div className={SHELL} style={{ paddingBottom: SAFE_PAD }}>
        <Link
          href={previewUrl}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-card-2 px-4 py-3 text-sm font-semibold text-fg shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-card"
        >
          <Eye className="h-4 w-4" />
          Ver como visitante
        </Link>
        <Link
          href={`/mis-productos/${productId}/editar`}
          className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform active:scale-95"
        >
          <Edit3 className="h-4 w-4" />
          Editar producto
        </Link>
      </div>
    );
  }

  // Visitor variant: anonymous (no session) -> single primary CTA to login.
  if (!hasSession) {
    const redirectTarget = encodeURIComponent(pathname);
    return (
      <div className={SHELL} style={{ paddingBottom: SAFE_PAD }}>
        <Link
          href={`/login?redirect=${redirectTarget}`}
          className="inline-flex w-full items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform active:scale-95"
        >
          <ShoppingBag className="h-4 w-4" />
          Quiero comprarlo
        </Link>
      </div>
    );
  }

  // Authenticated visitor (or owner-in-preview).
  // intent=buy must be preserved exactly: analytics + chat backend consume it
  // to insert the "comprador quiere comprar" message (see chat/page.tsx).
  return (
    <div className={SHELL} style={{ paddingBottom: SAFE_PAD }}>
      <Link
        href={`/chat?seller=${sellerId}&product=${productId}`}
        aria-label="Contactar al vendedor"
        className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-card-2 text-fg-muted shadow-[inset_0_0_0_1px_var(--border)] transition-colors hover:bg-card"
      >
        <MessageCircle className="h-5 w-5" />
      </Link>
      <Link
        href={`/chat?seller=${sellerId}&product=${productId}&intent=buy`}
        className="inline-flex flex-1 items-center justify-center gap-2 rounded-2xl bg-brand px-4 py-3 text-sm font-semibold text-white shadow-[var(--shadow-glow)] transition-transform active:scale-95"
      >
        <ShoppingBag className="h-4 w-4" />
        Quiero comprarlo
      </Link>
    </div>
  );
}
