import { parsePaymentMethods } from "@/lib/payment-methods";

interface PaymentChipsProps {
  metodosPagoAceptados: string | null;
}

export function PaymentChips({ metodosPagoAceptados }: PaymentChipsProps) {
  const methods = parsePaymentMethods(metodosPagoAceptados);
  if (methods.length === 0) return null;

  return (
    <section className="flex flex-col gap-2 px-1">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-fg-dim">
        Métodos de pago
      </span>
      <div className="flex flex-wrap gap-1.5">
        {methods.map((method) => (
          <span
            key={method}
            className="inline-flex items-center rounded-full bg-[color:var(--brand-tint)] px-2.5 py-1 text-xs font-medium text-fg-muted"
          >
            {method}
          </span>
        ))}
      </div>
    </section>
  );
}
