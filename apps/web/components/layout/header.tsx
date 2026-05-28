"use client";

import Link from "next/link";
import Image from "next/image";

import { Bell, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

export function Header({ unreadNotifications = 0 }: { unreadNotifications?: number }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 10);
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-40 transition-[background,backdrop-filter] duration-300",
        "bg-bg/80 backdrop-blur-xl",
        scrolled
          ? "shadow-[inset_0_-1px_0_0_var(--border)]"
          : "shadow-none"
      )}
    >
      <div className="flex items-center justify-between h-14 px-4 max-w-7xl mx-auto">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 group"
          id="header-logo"
        >
          <Image
            src="/vicino-logo.png"
            alt="VICINO"
            width={36}
            height={36}
            className="shrink-0"
            priority
          />
          <div className="flex flex-col">
            <span className="font-heading font-bold text-base leading-none tracking-tight text-fg">
              VICINO
            </span>
            <span className="mt-0.5 hidden text-[9px] font-semibold uppercase leading-none tracking-[0.15em] text-fg-dim sm:block">
              Confianza Local
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {/* Rankings */}
          <Link
            href="/rankings"
            className={cn(
              "relative inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
              "bg-card-2 text-fg-muted hover:text-fg",
              "shadow-[inset_0_0_0_1px_var(--border)]"
            )}
            aria-label="Rankings"
          >
            <Trophy className="h-[18px] w-[18px]" strokeWidth={2} />
          </Link>

          {/* Notifications */}
        <Link
          href="/notificaciones"
          className={cn(
            "relative inline-flex h-10 w-10 items-center justify-center rounded-xl transition-colors",
            "bg-card-2 text-fg-muted hover:text-fg",
            "shadow-[inset_0_0_0_1px_var(--border)]"
          )}
          aria-label="Notificaciones"
        >
          <Bell className="h-[18px] w-[18px]" strokeWidth={2} />
          {unreadNotifications > 0 && (
            <span
              className="absolute top-[9px] right-[9px] h-[7px] w-[7px] rounded-full bg-brand shadow-[0_0_0_2px_var(--card-2)]"
              aria-label={`${unreadNotifications} notificaciones sin leer`}
            />
          )}
        </Link>
        </div>
      </div>
    </header>
  );
}
