import { ShieldCheck } from "lucide-react";

export function TrustCallout() {
  return (
    <div
      role="note"
      className="flex items-start gap-3 rounded-[var(--r-lg)] product-card-custom p-3 product-card-text"
    >
      <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
      <p className="text-xs leading-relaxed">
        Confirmación mutua: VICINO solo conecta. El pago y la entrega se
        acuerdan en persona.
      </p>
    </div>
  );
}
