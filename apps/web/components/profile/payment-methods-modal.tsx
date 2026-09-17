"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { parsePaymentMethods } from "@/lib/payment-methods";
import {
  Banknote,
  CreditCard,
  Landmark,
  QrCode,
  Store,
  Wallet,
  Building2,
  Coins,
  HelpCircle,
} from "lucide-react";

interface PaymentMethodDetail {
  label: string;
  description: string;
  icon: React.ElementType;
}

const PAYMENT_METHOD_CATALOG: Record<string, PaymentMethodDetail> = {
  "Efectivo": {
    label: "Efectivo",
    description: "Pago en persona al momento de la entrega.",
    icon: Banknote,
  },
  "Tarjeta de crédito": {
    label: "Tarjeta de crédito",
    description: "Pago con tarjeta de crédito física o en terminal.",
    icon: CreditCard,
  },
  "Tarjeta de débito": {
    label: "Tarjeta de débito",
    description: "Pago con tarjeta de débito bancaria.",
    icon: CreditCard,
  },
  "Transferencia bancaria": {
    label: "Transferencia bancaria",
    description: "Pago directo a una cuenta bancaria (SPEI).",
    icon: Landmark,
  },
  "Mercado Pago": {
    label: "Mercado Pago",
    description: "Pago a través de la app o saldo de Mercado Pago.",
    icon: QrCode,
  },
  "OXXO Pay": {
    label: "OXXO Pay",
    description: "Pago en efectivo en tiendas de conveniencia OXXO.",
    icon: Store,
  },
  "PayPal": {
    label: "PayPal",
    description: "Pago seguro en línea mediante cuenta PayPal.",
    icon: Wallet,
  },
  "Depósito bancario": {
    label: "Depósito bancario",
    description: "Depósito en ventanilla bancaria o practicaja.",
    icon: Building2,
  },
  "Crypto": {
    label: "Crypto",
    description: "Pago mediante criptomonedas acordadas.",
    icon: Coins,
  },
};

interface PaymentMethodsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metodosPagoAceptados: string | null;
  displayName?: string | null;
}

export function PaymentMethodsModal({
  open,
  onOpenChange,
  metodosPagoAceptados,
  displayName,
}: PaymentMethodsModalProps) {
  const metodos = parsePaymentMethods(metodosPagoAceptados);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[420px] rounded-[28px] p-6 shadow-2xl border border-border">
        <DialogHeader className="pb-1">
          <DialogTitle className="font-heading font-extrabold text-xl text-foreground leading-tight">
            Métodos de pago
          </DialogTitle>
          {displayName && (
            <p className="text-xs text-muted-foreground font-medium mt-0.5">
              {displayName}
            </p>
          )}
        </DialogHeader>

        <div className="flex flex-col gap-2.5 my-2 max-h-[60vh] overflow-y-auto pr-0.5">
          {metodos.length > 0 ? (
            metodos.map((metodo) => {
              const detail = PAYMENT_METHOD_CATALOG[metodo] ?? {
                label: metodo,
                description: "Método de pago acordado con el vendedor.",
                icon: HelpCircle,
              };
              const Icon = detail.icon;

              return (
                <div
                  key={metodo}
                  className="flex items-center gap-4 p-3.5 rounded-2xl bg-black/[0.02] dark:bg-white/[0.03] border border-black/5 dark:border-white/10 transition-colors"
                >
                  <Icon className="w-7 h-7 text-neutral-500 dark:text-neutral-400 stroke-[1.75] shrink-0" />
                  <div className="flex-1 min-w-0">
                    <h3 className="font-heading font-bold text-sm text-foreground leading-tight">
                      {detail.label}
                    </h3>
                    <p className="text-xs text-muted-foreground mt-0.5 leading-snug">
                      {detail.description}
                    </p>
                  </div>
                </div>
              );
            })
          ) : (
            <div className="py-6 text-center text-xs text-muted-foreground">
              Este vendedor aún no ha especificado sus métodos de pago.
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}