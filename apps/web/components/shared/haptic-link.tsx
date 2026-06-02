"use client";

import Link, { type LinkProps } from "next/link";
import { hapticLight, hapticMedium } from "@/lib/haptics";
import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from "react";

/**
 * A4 sub-fase 4.1: wrapper de next/link que dispara feedback haptico al tap.
 *
 * Necesario para call-sites dentro de Server Components que no pueden pasar
 * un onClick handler directo al Link (boundary cliente/servidor). Pasa
 * cualquier prop adicional de next/link transparentemente.
 *
 * Default: "light". Override a "medium" para acciones de alto stake.
 */

type AnchorProps = Omit<ComponentPropsWithoutRef<"a">, keyof LinkProps | "children" | "ref">;

interface HapticLinkProps extends LinkProps, AnchorProps {
  haptic?: "light" | "medium";
  children?: ReactNode;
}

export function HapticLink({
  haptic = "light",
  onClick,
  children,
  ...rest
}: HapticLinkProps) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    if (haptic === "medium") void hapticMedium();
    else void hapticLight();
    onClick?.(e);
  }
  return (
    <Link {...rest} onClick={handleClick}>
      {children}
    </Link>
  );
}
