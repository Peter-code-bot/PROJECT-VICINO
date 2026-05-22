"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Search, PlusCircle, MessageCircle, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatUnread } from "@/components/layout/chat-unread-provider";

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
   */
  isVendedor: boolean;
}

export function BottomNav({ isVendedor }: BottomNavProps) {
  const pathname = usePathname();
  const unreadChatMessages = useChatUnread();
  const navItems = isVendedor
    ? NAV_ITEMS
    : NAV_ITEMS.filter((item) => item.href !== "/vender");

  return (
    <nav
      className="fixed inset-x-0 z-50 md:hidden"
      style={{ bottom: "calc(env(safe-area-inset-bottom) + 12px)" }}
    >
      <div className="mx-auto w-fit max-w-[calc(100%-24px)] px-2">
        <div
          className={cn(
            "flex items-center gap-1 rounded-pill p-1.5",
            "bg-[color:var(--card-2)] backdrop-blur-xl",
            "shadow-[inset_0_0_0_1px_var(--border),0_12px_40px_rgba(0,0,0,0.30)]"
          )}
        >
          {navItems.map(({ href, label, icon: Icon }) => {
            const isActive =
              href === "/" ? pathname === "/" : pathname.startsWith(href);

            return (
              <Link
                key={href}
                href={href}
                aria-label={label}
                aria-current={isActive ? "page" : undefined}
                id={`nav-${label.toLowerCase()}`}
                className={cn(
                  "relative inline-flex items-center gap-1.5 rounded-pill px-3.5 py-2 text-[12px] font-medium transition-colors duration-150",
                  isActive
                    ? "text-[color:var(--brand-hi)] bg-[color:var(--brand-tint-strong)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                    : "text-[color:var(--fg-muted)] hover:text-[color:var(--fg)]"
                )}
              >
                <Icon
                  className={cn(
                    "h-[18px] w-[18px] transition-transform duration-200",
                    isActive && "scale-105"
                  )}
                  strokeWidth={2}
                />
                <span
                  className={cn(
                    "hidden xs:inline",
                    isActive ? "inline" : "max-[360px]:hidden"
                  )}
                >
                  {label}
                </span>
                {href === "/chat" && unreadChatMessages > 0 && (
                  <span
                    className="absolute -top-1 -right-1 inline-flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-[color:var(--danger)] px-1 text-[10px] font-bold leading-none text-white shadow-[0_0_0_2px_var(--card-2)]"
                    aria-label={`${unreadChatMessages} mensajes sin leer`}
                  >
                    {unreadChatMessages > 99 ? "99+" : unreadChatMessages}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      </div>
    </nav>
  );
}
