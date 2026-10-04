"use client";

import Link from "next/link";
import { useSyncExternalStore, type ComponentProps } from "react";
import { leerRetornoHome } from "@/lib/auth/retorno-home";

const subscribe = () => () => {};
const serverHome = () => "/";

export function AuthHomeLink(props: Omit<ComponentProps<typeof Link>, "href">) {
  const home = useSyncExternalStore(subscribe, leerRetornoHome, serverHome);
  return <Link {...props} href={home} prefetch={false} />;
}
