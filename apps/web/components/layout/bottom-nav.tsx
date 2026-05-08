"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, PlusCircle, MessageCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/", label: "Inicio", icon: Home },
  { href: "/buscar", label: "Buscar", icon: Search },
  { href: "/vender", label: "Vender", icon: PlusCircle },
  { href: "/chat", label: "Chat", icon: MessageCircle },
  { href: "/perfil", label: "Perfil", icon: User },
] as const;

interface BottomNavProps {
  /**
   * Whether the current user has opted in to seller mode. When false, the
   * central "Vender" CTA is hidden and the nav renders 4 items instead of 5.
   * Phase 9: gating extends to /vender route via middleware + seller layout.
   */
  isVendedor: boolean;
  /** Total unread chat messages across all the user's conversations. */
  unreadChatMessages?: number;
}

export function BottomNav({ isVendedor, unreadChatMessages = 0 }: BottomNavProps) {
  const pathname = usePathname();
  const navItems = isVendedor
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.href !== "/vender");

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 md:hidden">
      {/* Glassmorphism background */}
      <div className="glass dark:glass-dark border-t border-border/30 shadow-[0_-4px_16px_rgba(0,0,0,0.12)]">
        <div className="flex items-center justify-around h-16 px-1 max-w-md mx-auto">
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);
            const isVender = href === "/vender";

            return (
              <Link
                key={href}
                href={href}
                className={cn(
                  "flex flex-col items-center justify-center gap-0.5 w-16 h-full text-xs transition-all duration-200",
                  isActive
                    ? "text-primary"
                    : "text-muted-foreground hover:text-foreground",
                  isVender && "relative"
                )}
                id={`nav-${label.toLowerCase()}`}
              >
                {isVender ? (
                  <div
                    className={cn(
                      "flex items-center justify-center w-11 h-11 rounded-2xl -mt-5 shadow-lg transition-all duration-200 active:scale-[0.93]",
                      "bg-primary text-white",
                      "hover:bg-primary/90 hover:shadow-xl",
                      "ring-4 ring-background"
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                ) : (
                  <div
                    className={cn(
                      "relative flex items-center justify-center w-10 h-8 rounded-xl transition-all duration-200",
                      isActive && "bg-primary/10 dark:bg-primary/10"
                    )}
                  >
                    <Icon
                      className={cn(
                        "h-5 w-5 transition-transform duration-200",
                        isActive && "scale-110"
                      )}
                    />
                    {href === "/chat" && unreadChatMessages > 0 && (
                      <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] font-bold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1 leading-none">
                        {unreadChatMessages > 99 ? "99+" : unreadChatMessages}
                      </span>
                    )}
                    {/* Active indicator dot */}
                    {isActive && (
                      <span className="absolute -bottom-0.5 w-1 h-1 rounded-full bg-primary" />
                    )}
                  </div>
                )}
                <span
                  className={cn(
                    "text-[10px] font-medium transition-colors",
                    isVender && "mt-0.5",
                    isActive && "font-semibold"
                  )}
                >
                  {label}
                </span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Safe area spacing for iOS */}
      <div className="h-[env(safe-area-inset-bottom)] glass dark:glass-dark" />
    </nav>
  );
}
