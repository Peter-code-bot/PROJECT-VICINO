import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@vicino/shared";
import { CouponActions } from "./coupon-actions";

export const metadata = { title: "Mis cupones" };

export default async function CuponesPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: coupons } = await supabase
    .from("coupons")
    .select("*")
    .eq("vendedor_id", user.id)
    .order("created_at", { ascending: false });

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex items-center justify-between gap-3 min-w-0">
        <h1 className="text-xl font-bold truncate">Cupones</h1>
        <Link
          href="/seller/cupones/nuevo"
          className="rounded-[var(--r-pill)] bg-[color:var(--fg)] px-3 sm:px-4 py-2 text-xs sm:text-sm font-medium text-[color:var(--bg)] hover:opacity-90 transition-colors shrink-0 whitespace-nowrap"
        >
          <span className="hidden sm:inline">Crear cupón</span>
          <span className="sm:hidden">Crear</span>
        </Link>
      </div>

      {coupons && coupons.length > 0 ? (
        <div className="space-y-3">
          {coupons.map((c) => (
            <div key={c.id} className="rounded-[var(--r-xl)] bg-[color:var(--sidebar-bg)] p-4 space-y-2 min-w-0 overflow-hidden">
              <div className="flex items-center justify-between gap-3 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-mono font-bold text-sm bg-[color:var(--bg-elev-2)] text-[color:var(--fg)] px-2 py-0.5 rounded-[var(--r-sm)] truncate min-w-0">
                    {c.codigo}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-[var(--r-pill)] font-medium shrink-0 ${c.activo ? "bg-[color:var(--fg)] text-[color:var(--bg)]" : "bg-[color:var(--bg-elev-2)] text-[color:var(--fg-dim)] border border-[color:var(--border)]"}`}
                  >
                    {c.activo ? "Activo" : "Inactivo"}
                  </span>
                </div>
                <CouponActions id={c.id} activo={c.activo} />
              </div>
              <p className="text-sm">
                {c.tipo_descuento === "porcentaje"
                  ? `${c.valor}% de descuento`
                  : `$${c.valor} MXN de descuento`}
              </p>
              <div className="flex gap-4 text-xs text-[color:var(--fg-muted)]">
                {c.fecha_expiracion && (
                  <span>Expira: {formatDate(c.fecha_expiracion)}</span>
                )}
                {c.usos_maximos && (
                  <span>
                    Usos: {c.usos_actuales}/{c.usos_maximos}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">🏷️</p>
          <p className="font-medium">Sin cupones</p>
          <p className="text-sm text-[color:var(--fg-muted)]">
            Crea cupones para atraer compradores. Se muestran en tus productos.
          </p>
        </div>
      )}
    </div>
  );
}
