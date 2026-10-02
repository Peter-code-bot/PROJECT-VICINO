"use client";
import Link from "next/link";
import type { ComponentProps } from "react";
import { useMuroSesion } from "./muro-sesion";
import { loginPara, requiereSesion } from "@/lib/auth/acceso-invitado";
import { esRutaAuth } from "@/lib/auth/destino-seguro";
import { guardarRetornoHome } from "@/lib/auth/retorno-home";

/** Real anchors preserve keyboard/new-tab navigation, with the same guest policy. */
export default function AuthLink({ href, onClick, ...props }: ComponentProps<typeof Link>) {
  const { haySesion } = useMuroSesion();
  let destino: string;
  if (typeof href === "string") destino = href;
  else {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(href.query ?? {})) {
      for (const item of Array.isArray(value) ? value : [value]) if (item != null) query.append(key, String(item));
    }
    destino = `${href.pathname ?? "/"}${href.search ?? (query.size ? `?${query}` : "")}${href.hash ?? ""}`;
  }
  const bloqueado = !haySesion && requiereSesion(destino);
  return <Link {...props} href={bloqueado ? loginPara(destino) : href} prefetch={bloqueado ? false : props.prefetch} onClick={event => {
    if (bloqueado || (!haySesion && esRutaAuth(destino))) guardarRetornoHome();
    if (bloqueado) return;
    onClick?.(event);
  }} />;
}
