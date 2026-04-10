import { Header } from "@/components/layout/header";
import { BottomNav } from "@/components/layout/bottom-nav";
import { Footer } from "@/components/layout/footer";
import { Sidebar } from "@/components/layout/sidebar";
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
      .eq("role", "admin")
      .maybeSingle();
    isAdmin = !!adminRole;

    const { count } = await supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .eq("user_id", user.id)
      .eq("leida", false);
    unreadNotifications = count ?? 0;
  }

  return (
    <div className="flex min-h-screen">
      <Sidebar
        user={user ? { id: user.id } : null}
        profile={profile}
        isAdmin={isAdmin}
        unreadNotifications={unreadNotifications}
      />
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="md:hidden">
          <Header />
        </div>
        <main className="flex-1 pb-20 md:pb-0">{children}</main>
        <div className="hidden md:block">
          <Footer />
        </div>
        <BottomNav />
      </div>
    </div>
  );
}
