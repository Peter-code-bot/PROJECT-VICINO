import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { ConditionalFooter } from "@/components/layout/conditional-footer";
import { Sidebar } from "@/components/layout/sidebar";
import { PageSwipeWrapper } from "@/components/layout/page-swipe-wrapper";
import { PullToRefreshWrapper } from "@/components/layout/pull-to-refresh-wrapper";
import { ChatUnreadProvider } from "@/components/layout/chat-unread-provider";
import { NotificationUnreadProvider } from "@/components/layout/notification-unread-provider";
import { createClient } from "@/lib/supabase/server";

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
    const { data } = await supabase
      .from("profiles")
      .select("nombre, foto, es_vendedor")
      .eq("id", user.id)
      .single();
    profile = data;

    const { data: adminRole } = await supabase
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .in("role", ["admin", "moderator"]);
    isAdmin = (adminRole?.length ?? 0) > 0;

    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("leida", false)
      .neq("tipo", "message");
    unreadNotifications = count ?? 0;

    const { data: buyerChats } = await supabase
      .from("chats")
      .select("no_leidos_comprador")
      .eq("comprador_id", user.id);
    const { data: sellerChats } = await supabase
      .from("chats")
      .select("no_leidos_vendedor")
      .eq("vendedor_id", user.id);
    unreadChatMessages =
      (buyerChats?.reduce((sum, c) => sum + (c.no_leidos_comprador ?? 0), 0) ?? 0) +
      (sellerChats?.reduce((sum, c) => sum + (c.no_leidos_vendedor ?? 0), 0) ?? 0);
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
              <Header />
            </div>
            <main className="flex-1 pb-20 md:pb-0">
              <PullToRefreshWrapper>
                <PageSwipeWrapper isVendedor={isVendedor}>{children}</PageSwipeWrapper>
              </PullToRefreshWrapper>
            </main>
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
