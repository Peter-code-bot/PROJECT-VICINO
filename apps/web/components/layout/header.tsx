"use client";

import Link from "next/link";

import { Bell, Trophy, Sparkles, Menu } from "lucide-react";
import { AccountMenuDrawer } from "@/components/profile/account-menu-drawer";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";
import { useNotificationUnread } from "@/components/layout/notification-unread-provider";

export interface HeaderProps {
  isAdmin?: boolean;
  user?: { id: string } | null;
  profile?: {
    nombre?: string | null;
    foto?: string | null;
    username?: string | null;
    es_vendedor?: boolean | null;
  } | null;
}

export function Header({ isAdmin, user, profile }: HeaderProps) {
  const { count: unreadNotifications } = useNotificationUnread();
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
        "bg-bg/80 backdrop-blur-xl pt-[env(safe-area-inset-top)]"
      )}
    >
      <div className="flex items-center justify-between h-14 px-4 max-w-7xl mx-auto">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 shrink-0 group"
          id="header-logo"
        >
          <div className="flex flex-col">
            <span className="font-heading font-bold text-xl leading-none tracking-tight text-fg">
              VICINO
            </span>
            <span className="mt-0.5 hidden text-[9px] font-semibold uppercase leading-none tracking-[0.15em] text-fg-dim sm:block">
              Confianza Local
            </span>
          </div>
        </Link>

        <div className="flex items-center gap-2">
          {/* Admin */}
          {isAdmin && (
            <Link
              href="/admin"
              className="relative inline-flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#F4F1EB] transition-colors"
              aria-label="Panel de admin"
            >
              <Sparkles className="h-4 w-4 text-[#1A1A2E]" strokeWidth={2.2} />
            </Link>
          )}

          {/* Rankings */}
          <Link
            href="/rankings"
            className="relative inline-flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#F4F1EB] transition-colors"
            aria-label="Rankings"
          >
            <Trophy className="h-[17px] w-[17px] text-[#1A1A2E]" strokeWidth={2} />
          </Link>

          {/* Notifications */}
          <Link
            href="/notificaciones"
            className="relative inline-flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#F4F1EB] transition-colors"
            aria-label="Notificaciones"
          >
            <Bell className="h-4 w-4 text-[#1A1A2E]" strokeWidth={2} />
            {unreadNotifications > 0 && (
              <span
                className="absolute top-1.5 right-1.5 h-1.5 w-1.5 rounded-full bg-danger ring-2 ring-bg"
                aria-label={`${unreadNotifications} notificaciones sin leer`}
              />
            )}
          </Link>

          {/* Menu Drawer */}
          {user && (
            <AccountMenuDrawer
              userName={profile?.nombre ?? undefined}
              userAvatar={profile?.foto}
              username={profile?.username}
              userIsVendedor={profile?.es_vendedor ?? false}
              trigger={
                <button
                  aria-label="Menú de cuenta"
                  className="relative inline-flex h-[38px] w-[38px] items-center justify-center rounded-full bg-[#F4F1EB] text-[#1A1A2E] transition-colors"
                >
                  <Menu className="h-5 w-5 text-[#1A1A2E]" strokeWidth={2} />
                </button>
              }
            />
          )}
        </div>
      </div>
    </header>
  );
}
