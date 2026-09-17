"use client";

import { useState } from "react";
import { CreditCard } from "lucide-react";
import { parsePaymentMethods } from "@/lib/payment-methods";
import { PaymentMethodsModal } from "@/components/profile/payment-methods-modal";
import { cn } from "@/lib/utils";

interface PaymentMethodsBadgeProps {
  metodosPagoAceptados: string | null;
  displayName?: string | null;
  className?: string;
}

export function PaymentMethodsBadge({
  metodosPagoAceptados,
  displayName,
  className,
}: PaymentMethodsBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const metodos = parsePaymentMethods(metodosPagoAceptados);

  if (metodos.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        className={cn(
          "relative flex items-center justify-center w-11 h-11 rounded-full bg-[color:var(--sidebar-bg)] text-foreground transition-transform duration-150 hover:scale-105 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary shrink-0",
          className
        )}
        title="Ver métodos de pago"
        aria-label="Ver métodos de pago"
      >
        <CreditCard className="w-5 h-5 stroke-[1.8]" />
      </button>

      <PaymentMethodsModal
        open={isOpen}
        onOpenChange={setIsOpen}
        metodosPagoAceptados={metodosPagoAceptados}
        displayName={displayName}
      />
    </>
  );
}