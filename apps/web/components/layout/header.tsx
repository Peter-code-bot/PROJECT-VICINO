"use client";

import Link from "next/link";
import Image from "next/image";

import { Bell } from "lucide-react";
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
        "sticky top-0 z-40 transition-all duration-300",
        scrolled
          ? "bg-background/90 backdrop-blur-md"
          : "bg-background/80 backdrop-blur-sm"
      )}
    >
      <div className="flex items-center justify-between h-14 px-4 max-w-7xl mx-auto">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 group"
          id="header-logo"
        >
          <div className="w-8 h-8 rounded-xl bg-brand flex items-center justify-center shadow-sm group-hover:shadow-md transition-shadow duration-200">
            <MapPin className="w-4 h-4 text-white" />
          </div>
          <div className="flex flex-col">
            <span className="font-heading font-bold text-base leading-none tracking-tight">
              VICINO
            </span>
            <span className="text-[9px] text-muted-foreground font-medium tracking-wider uppercase leading-none mt-0.5 hidden sm:block">
              Confianza Local
            </span>
          </div>
        </Link>

        {/* Search Bar */}
        <div className="flex-1 max-w-xl">
          <Link
            href="/buscar"
            className={cn(
              "flex items-center gap-2 w-full rounded-xl border px-3.5 py-2 text-sm transition-all duration-200",
              "bg-cream-dark/60 dark:bg-neutral-800/40 border-border/50",
              "hover:border-brand/30 hover:shadow-sm",
              pathname === "/buscar" && "border-brand/40 shadow-sm"
            )}
            id="header-search"
          >
            <Search className="h-4 w-4 text-brand/60" />
            <span className="text-muted-foreground text-sm">
              Busca en VICINO...
            </span>
          </Link>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5">
          <button
            className="relative p-2 rounded-xl hover:bg-cream-dark/80 dark:hover:bg-neutral-800/50 transition-colors"
            id="header-notifications"
            aria-label="Notificaciones"
          >
            <Bell className="h-5 w-5 text-muted-foreground" />
            {/* Notification dot */}
            <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-brand ring-2 ring-cream dark:ring-[#0D0D1A]" />
          </button>
        </div>
      </div>
    </header>
  );
}
