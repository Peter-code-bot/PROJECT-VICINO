"use client";

import Link from "next/link";
import Image from "next/image";

import { Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

export function Header() {
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
          <Image
            src="/vicino-logo.png"
            alt="VICINO"
            width={36}
            height={36}
            className="shrink-0"
            priority
          />
          <div className="flex flex-col">
            <span className="font-heading font-bold text-base leading-none tracking-tight">
              VICINO
            </span>
            <span className="text-[9px] text-muted-foreground font-medium tracking-wider uppercase leading-none mt-0.5 hidden sm:block">
              Confianza Local
            </span>
          </div>
        </Link>

        {/* Notifications */}
        <Link
          href="/notificaciones"
          className="relative w-10 h-10 rounded-full hover:bg-muted active:bg-muted transition-colors flex items-center justify-center"
          aria-label="Notificaciones"
        >
          <Bell className="h-5 w-5 text-foreground" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 rounded-full bg-primary ring-2 ring-background" />
        </Link>
      </div>
    </header>
  );
}
