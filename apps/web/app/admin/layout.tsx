import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import Link from "next/link";
import { MapPin, ShieldAlert } from "lucide-react";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login?next=/admin");

  // Check admin OR moderator role
  const { data: roles } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["admin", "moderator"]);

  const userRole = roles?.find((r) => r.role === "admin")
    ? "admin"
    : roles?.find((r) => r.role === "moderator")
      ? "moderator"
      : null;

  if (!userRole) redirect("/");

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 animate-fade-in-up">
      <div className="flex items-center gap-4 mb-10 pb-6 border-b border-border/40">
        <Link href="/" className="flex items-center gap-2 group">
          <div className="w-10 h-10 rounded-xl bg-charcoal dark:bg-neutral-800 flex items-center justify-center shadow-md group-hover:scale-105 transition-transform">
            <MapPin className="w-5 h-5 text-white" />
          </div>
          <span className="font-heading font-bold text-xl leading-none">
            VICINO
          </span>
        </Link>
        <span className="text-muted-foreground/40 font-light text-2xl">/</span>
        <div className="flex items-center gap-1.5 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-lg">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span className="font-semibold text-sm tracking-wide uppercase">
            {userRole === "admin" ? "Panel Admin" : "Panel Moderador"}
          </span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-8 lg:gap-12">
        <aside className="w-full md:w-56 lg:w-64 shrink-0">
          <AdminSidebar userRole={userRole} />
        </aside>
        <main className="flex-1 min-w-0 bg-card rounded-3xl border border-border/40 shadow-sm p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
