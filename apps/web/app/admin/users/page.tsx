import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { SellerBadge } from "@/components/shared/seller-badge";
import type { TrustLevel } from "@vicino/shared";
import { RoleActions } from "./role-actions";

export const metadata = { title: "Admin — Usuarios" };

interface Props {
  searchParams: Promise<{ q?: string }>;
}

export default async function AdminUsersPage({ searchParams }: Props) {
  const params = await searchParams;
  const supabase = await createClient();

  // Only admins can access user management (not moderators)
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/login");
  const { data: adminCheck } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .eq("role", "admin")
    .maybeSingle();
  if (!adminCheck) redirect("/admin");

  let query = supabase
    .from("profiles")
    .select("id, nombre, email, user_id, es_vendedor, trust_level, average_rating, total_sales, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (params.q) {
    query = query.or(`nombre.ilike.%${params.q}%,email.ilike.%${params.q}%,user_id.ilike.%${params.q}%`);
  }

  const { data: users } = await query;

  // Get roles
  const { data: allRoles } = await supabase.from("user_roles").select("user_id, role");
  const roleMap = new Map<string, string[]>();
  allRoles?.forEach((r) => {
    const existing = roleMap.get(r.user_id) ?? [];
    existing.push(r.role);
    roleMap.set(r.user_id, existing);
  });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Usuarios</h1>

      <form className="flex gap-2">
        <input
          name="q"
          type="text"
          defaultValue={params.q}
          placeholder="Buscar por nombre, email o ID..."
          className="flex-1 rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary"
        />
        <button
          type="submit"
          className="rounded-md bg-bone px-4 py-2 text-sm font-medium text-bone-contrast hover:bg-bone-dark"
        >
          Buscar
        </button>
      </form>

      <div className="space-y-2">
        {users?.map((u) => {
          const roles = roleMap.get(u.id) ?? [];
          return (
            <div key={u.id} className="rounded-lg border p-4 flex items-center gap-4">
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm">{u.nombre || "Sin nombre"}</span>
                  <SellerBadge level={(u.trust_level as TrustLevel) ?? "nuevo"} size="sm" />
                  {u.es_vendedor && (
                    <span className="text-xs bg-blue-50 dark:bg-blue-950/50 text-blue-600 px-2 py-0.5 rounded-full">
                      Vendedor
                    </span>
                  )}
                  {roles.map((r) => (
                    <span
                      key={r}
                      className="text-xs bg-red-50 dark:bg-red-950/50 text-red-600 px-2 py-0.5 rounded-full"
                    >
                      {r}
                    </span>
                  ))}
                </div>
                <div className="flex gap-3 text-xs text-muted-foreground">
                  <span>{u.email}</span>
                  <span>{u.user_id}</span>
                  <span>{u.total_sales} ventas</span>
                </div>
              </div>
              <RoleActions userId={u.id} currentRoles={roles} />
            </div>
          );
        })}
        {(!users || users.length === 0) && (
          <p className="text-sm text-muted-foreground text-center py-8">Sin resultados</p>
        )}
      </div>

      <div className="mt-6 p-4 rounded-xl bg-muted/50 text-sm text-muted-foreground space-y-1">
        <p className="font-medium text-foreground">Roles disponibles:</p>
        <p>• <strong>Admin</strong> — Acceso completo: usuarios, métricas financieras, verificaciones, disputas, moderación</p>
        <p>• <strong>Moderador</strong> — Acceso limitado: verificaciones, disputas, moderación de contenido (sin gestión de usuarios ni métricas financieras)</p>
      </div>
    </div>
  );
}
