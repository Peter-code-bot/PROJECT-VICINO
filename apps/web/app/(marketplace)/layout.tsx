import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ConditionalFooter } from "@/components/layout/conditional-footer";
import { Sidebar } from "@/components/layout/sidebar";
import { PageSwipeWrapper } from "@/components/layout/page-swipe-wrapper";
import { PullToRefreshWrapper } from "@/components/layout/pull-to-refresh-wrapper";
import { ChatUnreadProvider } from "@/components/layout/chat-unread-provider";
import { NotificationUnreadProvider } from "@/components/layout/notification-unread-provider";
import { createClient } from "@/lib/supabase/server";

import { MainWrapper } from "@/components/layout/main-wrapper";

export default async function MarketplaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let profile = null;
  let isAdmin = false;
  let unreadNotifications = 0;
  let unreadChatMessages = 0;

  if (user) {
    // F3 + fault-isolation (optimize-auth-session-hydration): the 5 DB queries
    // below all depend on user.id but are independent of each other. Run them
    // concurrently via Promise.allSettled — Promise.all would reject the whole
    // batch on a single query failure and crash the layout. allSettled
    // preserves the pre-F3 behavior where a failed/slow query just reduced to
    // the empty default (?? null / ?? 0) without taking the page down.
    const [
      profileResult,
      rolesResult,
      notifResult,
      buyerChatsResult,
      sellerChatsResult,
    ] = await Promise.allSettled([
      supabase
        .from("profiles")
        .select("nombre, foto, es_vendedor")
        .eq("id", user.id)
        .single(),
      supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id)
        .in("role", ["admin", "moderator"]),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("leida", false)
        .neq("tipo", "message"),
      supabase
        .from("chats")
        .select("no_leidos_comprador")
        .eq("comprador_id", user.id),
      supabase
        .from("chats")
        .select("no_leidos_vendedor")
        .eq("vendedor_id", user.id),
    ]);

    profile =
      profileResult.status === "fulfilled" ? profileResult.value.data : null;
    isAdmin =
      rolesResult.status === "fulfilled" &&
      (rolesResult.value.data?.length ?? 0) > 0;
    unreadNotifications =
      notifResult.status === "fulfilled" ? notifResult.value.count ?? 0 : 0;
    const buyerCount =
      buyerChatsResult.status === "fulfilled"
        ? buyerChatsResult.value.data?.reduce(
            (sum, c) => sum + (c.no_leidos_comprador ?? 0),
            0,
          ) ?? 0
        : 0;
    const sellerCount =
      sellerChatsResult.status === "fulfilled"
        ? sellerChatsResult.value.data?.reduce(
            (sum, c) => sum + (c.no_leidos_vendedor ?? 0),
            0,
          ) ?? 0
        : 0;
    unreadChatMessages = buyerCount + sellerCount;
  }

  const isVendedor = profile?.es_vendedor ?? false;

  return (
    <ChatUnreadProvider userId={user?.id ?? ""} initialCount={unreadChatMessages}>
      <NotificationUnreadProvider
        userId={user?.id ?? ""}
        initialCount={unreadNotifications}
      >
        <div className="flex min-h-screen">
          <Sidebar
            user={user ? { id: user.id } : null}
            profile={profile}
            isAdmin={isAdmin}
          />
          <div className="flex-1 min-w-0 flex flex-col">
            <div className="md:hidden">
              <Header isAdmin={isAdmin} />
            </div>
            <MainWrapper>
              <PullToRefreshWrapper>
                <PageSwipeWrapper isVendedor={isVendedor}>{children}</PageSwipeWrapper>
              </PullToRefreshWrapper>
            </MainWrapper>
            <div className="hidden md:block">
              <ConditionalFooter isVendedor={isVendedor} />
            </div>
            <BottomNav isVendedor={isVendedor} />
          </div>
        </div>
      </NotificationUnreadProvider>
    </ChatUnreadProvider>
  );
}
