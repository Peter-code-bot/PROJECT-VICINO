import { formatRelativeTime } from "@vicino/shared";
import { formatProductCondition } from "@/lib/product-condition";

interface SpecRowProps {
  estado: string | null;
  deliveryLabel: string;
  createdAt: string;
  /**
   * Listing type. Optional for backward compatibility: when omitted, the
   * row keeps the legacy 3-column layout (ESTADO + ENTREGA + PUBLICADO).
   * When set to "servicio", the ESTADO column is hidden because physical
   * condition does not apply to services; the grid collapses to 2 columns.
   */
  tipo?: string | null;
}

function shortDeliveryLabel(label: string): string {
  const lower = label.toLowerCase();
  if (lower.includes("mano a mano")) return "Mano a mano";
  if (lower.includes("pickup o env")) return "Pickup / envio";
  if (lower.includes("recoger") || lower === "pickup") return "Pickup";
  if (lower.startsWith("env")) return "Envio";
  return label;
}

interface SpecCellProps {
  label: string;
  value: string;
}

function SpecCell({ label, value }: SpecCellProps) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1 text-center">
      <span className="text-[10px] uppercase tracking-wider text-fg-dim">
        {label}
      </span>
      <span className="text-sm font-semibold leading-tight text-fg">{value}</span>
    </div>
  );
}

export function SpecRow({ estado, deliveryLabel, createdAt, tipo }: SpecRowProps) {
  const isService = tipo === "servicio";
  const gridClass = isService ? "grid-cols-2" : "grid-cols-3";

  return (
    <div
      className={`grid ${gridClass} gap-2 rounded-[var(--r-lg)] bg-card p-3 shadow-[inset_0_0_0_1px_var(--border)]`}
    >
      {!isService && (
        <SpecCell label="ESTADO" value={formatProductCondition(estado)} />
      )}
      <SpecCell label="ENTREGA" value={shortDeliveryLabel(deliveryLabel)} />
      <SpecCell label="PUBLICADO" value={formatRelativeTime(createdAt)} />
    </div>
  );
}
