"use client";

import { useRef, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

/** Confirmación deliberada: foco inicial en Cancelar, Escape y retorno del foco. */
export function ConfirmacionCuenta({ open, onClose, titulo, descripcion, confirmar, pendiente, onConfirmar, children, restaurarFoco }: {
  open: boolean;
  onClose: () => void;
  titulo: string;
  descripcion: string;
  confirmar: string;
  pendiente: boolean;
  onConfirmar: () => void;
  children?: ReactNode;
  restaurarFoco: () => void;
}) {
  const cancelarRef = useRef<HTMLButtonElement>(null);
  return (
    <Dialog open={open} onOpenChange={(abierto) => { if (!abierto && !pendiente) onClose(); }}>
      <DialogContent className="w-[calc(100%_-_2rem)] max-w-sm" showClose={!pendiente}
        onEscapeKeyDown={(event) => { if (pendiente) event.preventDefault(); }}
        onInteractOutside={(event) => { if (pendiente) event.preventDefault(); }}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelarRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restaurarFoco();
        }}>
        <DialogHeader>
          <DialogTitle className="pr-6">{titulo}</DialogTitle>
          <DialogDescription>{descripcion}</DialogDescription>
        </DialogHeader>
        {children}
        <DialogFooter>
          <Button ref={cancelarRef} type="button" variant="secondary" disabled={pendiente} onClick={onClose}>Cancelar</Button>
          <Button type="button" variant="danger" loading={pendiente} disabled={pendiente} onClick={onConfirmar}>{confirmar}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
