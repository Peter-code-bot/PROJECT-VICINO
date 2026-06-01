import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@vicino/shared";
import { DisputeActions } from "./dispute-actions";

export const metadata = { title: "Admin — Disputas" };

export default async function DisputesPage() {
  const supabase = await createClient();

  const { data: disputes } = await supabase
    .from("disputes")
    .select(
      `
      id, motivo, descripcion, status, created_at,
      reporter:profiles!reporter_id(nombre),
      reported:profiles!reported_id(nombre),
      sale_confirmations(precio_acordado, products_services(titulo))
    `
    )
    .in("status", ["open", "under_review"])
    .order("created_at", { ascending: true });

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-bold">Disputas</h1>

      {disputes && disputes.length > 0 ? (
        <div className="space-y-4">
          {disputes.map((d) => {
            const reporter = Array.isArray(d.reporter) ? d.reporter[0] : d.reporter;
            const reported = Array.isArray(d.reported) ? d.reported[0] : d.reported;
            const sale = Array.isArray(d.sale_confirmations) ? d.sale_confirmations[0] : d.sale_confirmations;
            const product = sale?.products_services
              ? (Array.isArray(sale.products_services) ? sale.products_services[0] : sale.products_services)
              : null;

            return (
              <div key={d.id} className="rounded-lg border p-4 space-y-3 w-full">
                <div className="flex items-start justify-between gap-4">
                  <span className="font-medium text-sm flex-1 min-w-0 break-words">{d.motivo}</span>
                  <span className="text-xs text-muted-foreground shrink-0">{formatDate(d.created_at)}</span>
                </div>
                <div className="text-xs text-muted-foreground space-y-1">
                  <p>Reporta: <strong>{reporter?.nombre ?? "Usuario"}</strong></p>
                  <p>Reportado: <strong>{reported?.nombre ?? "Usuario"}</strong></p>
                  {product && <p>Producto: {product.titulo}</p>}
                </div>
                {d.descripcion && (
                  <p className="text-sm">{d.descripcion}</p>
                )}
                <DisputeActions id={d.id} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="text-center py-12 space-y-2">
          <p className="text-4xl">✅</p>
          <p className="font-medium">Sin disputas abiertas</p>
        </div>
      )}
    </div>
  );
}
