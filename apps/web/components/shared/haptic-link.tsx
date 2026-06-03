"use client";

import Link, { type LinkProps } from "next/link";
import { hapticLight, hapticMedium, hapticSelection } from "@/lib/haptics";
import type { ComponentPropsWithoutRef, MouseEvent, ReactNode } from "react";

/**
 * A4 sub-fase 4.1: wrapper de next/link que dispara feedback haptico al tap.
 *
 * Necesario para call-sites dentro de Server Components que no pueden pasar
 * un onClick handler directo al Link (boundary cliente/servidor). Pasa
 * cualquier prop adicional de next/link transparentemente.
 *
 * Default: "light". Override a "medium" para acciones de alto stake.
 * "selection" para segmented-control / tab-switch style transitions
 * (canonical convention from openspec/specs/capacitor-native-ux R1).
 */

type AnchorProps = Omit<ComponentPropsWithoutRef<"a">, keyof LinkProps | "children" | "ref">;

interface HapticLinkProps extends LinkProps, AnchorProps {
  haptic?: "light" | "medium" | "selection";
  children?: ReactNode;
}

export function HapticLink({
  haptic = "light",
  onClick,
  children,
  ...rest
}: HapticLinkProps) {
  function handleClick(e: MouseEvent<HTMLAnchorElement>) {
    // codex follow-up L1: ejecutar onClick del caller PRIMERO. Si el caller
    // hace preventDefault, asumimos que el click se cancelo y NO disparamos
    // el haptic (no debe sonar para un tap cancelado).
    onClick?.(e);
    if (e.defaultPrevented) return;
    if (haptic === "medium") void hapticMedium();
    else if (haptic === "selection") void hapticSelection();
    else void hapticLight();
  }
  return (
    <Link {...rest} onClick={handleClick}>
      {children}
    </Link>
  );
}
