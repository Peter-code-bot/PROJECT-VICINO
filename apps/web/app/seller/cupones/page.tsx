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
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">Cupones</h1>
        <Link
          href="/seller/cupones/nuevo"
          className="rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Crear cupón
        </Link>
      </div>

      {coupons && coupons.length > 0 ? (
        <div className="space-y-3">
          {coupons.map((c) => (
            <div key={c.id} className="rounded-lg border p-4 space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="font-mono font-bold text-sm bg-muted px-2 py-0.5 rounded">
                    {c.codigo}
                  </span>
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full font-medium ${c.activo ? "bg-emerald-trust/10 text-emerald-trust" : "bg-muted text-muted-foreground"}`}
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
              <div className="flex gap-4 text-xs text-muted-foreground">
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
          <p className="text-sm text-muted-foreground">
            Crea cupones para atraer compradores. Se muestran en tus productos.
          </p>
        </div>
      )}
    </div>
  );
}
