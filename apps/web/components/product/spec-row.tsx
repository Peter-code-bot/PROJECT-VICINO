import { formatRelativeTime } from "@vicino/shared";
import { formatProductCondition } from "@/lib/product-condition";

interface SpecRowProps {
  estado: string | null;
  deliveryLabel: string;
  createdAt: string;
  /**
   * Free-text color. Pattern B (MP#08 #3): the COLOR column appears only
   * when color has a value AND the listing is a producto. Optional cells
   * take space only when populated; delivery and publication date remain.
   */
  color?: string | null;
  /**
   * Services have no physical condition or color. For products, omit either
   * cell when its value is absent and share the row across the remaining cells.
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
      <span className="w-full wrap-anywhere text-[10px] uppercase tracking-wider text-fg-dim">
        {label}
      </span>
      <span className="w-full wrap-anywhere text-sm font-semibold leading-tight text-fg">{value}</span>
    </div>
  );
}

export function SpecRow({ estado, deliveryLabel, createdAt, color, tipo }: SpecRowProps) {
  const isService = tipo === "servicio";
  const colorTrimmed = color?.trim() ?? "";
  const hasCondition = !isService && Boolean(estado?.trim());
  const hasColor = !isService && colorTrimmed.length > 0;

  return (
    <div
      className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,3rem),1fr))] gap-2 rounded-[var(--r-lg)] product-card-custom p-3"
    >
      {hasCondition && (
        <SpecCell label="ESTADO" value={formatProductCondition(estado)} />
      )}
      {hasColor && <SpecCell label="COLOR" value={colorTrimmed} />}
      <SpecCell label="ENTREGA" value={shortDeliveryLabel(deliveryLabel)} />
      <SpecCell label="PUBLICADO" value={formatRelativeTime(createdAt)} />
    </div>
  );
}
