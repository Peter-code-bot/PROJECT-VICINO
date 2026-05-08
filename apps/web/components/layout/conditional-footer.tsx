'use client';

import { usePathname } from 'next/navigation';
import { Footer } from './footer';

const HIDE_FOOTER_PATTERN = /^\/chat(\/|$)/;

interface ConditionalFooterProps {
  /** Phase 9: hides the "Vender" footer link when the user is not a seller. */
  isVendedor: boolean;
}

export function ConditionalFooter({ isVendedor }: ConditionalFooterProps) {
  const pathname = usePathname();
  if (HIDE_FOOTER_PATTERN.test(pathname)) return null;
  return <Footer isVendedor={isVendedor} />;
}
