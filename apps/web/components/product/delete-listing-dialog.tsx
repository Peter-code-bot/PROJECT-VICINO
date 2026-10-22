"use client";

import { useRef, useState, useTransition, type RefObject } from "react";
import { deleteProduct } from "@/app/(marketplace)/vender/actions";
import { esNavegacionDeNext } from "@/lib/next-navigation-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface DeleteListingDialogProps {
  productId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef?: RefObject<HTMLButtonElement | null>;
}

export function DeleteListingDialog({ productId, open, onOpenChange, triggerRef }: DeleteListingDialogProps) {
  const [pending, startTransition] = useTransition();
  const inFlight = useRef(false);
  const [error, setError] = useState("");

  function changeOpen(next: boolean) {
    if (pending || inFlight.current) return;
    setError("");
    onOpenChange(next);
  }

  function confirmDelete() {
    if (pending || inFlight.current) return;
    inFlight.current = true;
    setError("");
    startTransition(async () => {
      try {
        const result = await deleteProduct(productId);
        if (result?.error) setError(result.error);
      } catch (err) {
        // No convertir la navegación de Next en un error de eliminación.
        if (esNavegacionDeNext(err)) throw err;
        setError("No se pudo confirmar la eliminación. Intenta de nuevo.");
      } finally {
        inFlight.current = false;
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-sm"
        showClose={!pending}
        aria-busy={pending}
        onCloseAutoFocus={(event) => {
          if (triggerRef?.current) {
            event.preventDefault();
            triggerRef.current.focus();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>¿Eliminar esta publicación?</DialogTitle>
          <DialogDescription>Esta acción no se puede deshacer.</DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="secondary" size="lg" disabled={pending} onClick={() => changeOpen(false)}>
            Cancelar
          </Button>
          <Button type="button" variant="danger" size="lg" loading={pending} onClick={confirmDelete}>
            {pending ? "Eliminando…" : "Eliminar publicación"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
