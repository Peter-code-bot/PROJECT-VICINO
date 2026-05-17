import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AdminSidebar } from "@/components/layout/admin-sidebar";
import Link from "next/link";
import Image from "next/image";
import { ShieldAlert } from "lucide-react";

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

  const { data: adminRole } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();

  if (!adminRole) redirect("/");

  return (
    <div className="max-w-7xl mx-auto px-4 py-8 animate-fade-in-up">
      <div className="flex items-center gap-4 mb-10">
        <Link href="/" className="flex items-center gap-2 group">
          <Image
            src="/vicino-logo.png"
            alt="VICINO"
            width={40}
            height={40}
            className="shrink-0 group-hover:scale-105 transition-transform"
            priority
          />
          <span className="font-heading font-bold text-xl leading-none">
            VICINO
          </span>
        </Link>
        <span className="text-muted-foreground/40 font-light text-2xl">/</span>
        <div className="flex items-center gap-1.5 bg-red-500/10 text-red-600 dark:text-red-400 px-3 py-1.5 rounded-lg">
          <ShieldAlert className="w-4 h-4 shrink-0" />
          <span className="font-semibold text-sm tracking-wide uppercase">
            Panel Admin
          </span>
        </div>
      </div>

      <div className="flex flex-col md:flex-row gap-8 lg:gap-12">
        <aside className="w-full md:w-56 lg:w-64 shrink-0">
          <AdminSidebar />
        </aside>
        <main className="flex-1 min-w-0 bg-card rounded-3xl border border-border/40 shadow-sm p-6 lg:p-8">
          {children}
        </main>
      </div>
    </div>
  );
}
