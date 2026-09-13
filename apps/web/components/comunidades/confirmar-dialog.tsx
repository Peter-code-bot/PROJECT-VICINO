"use client";

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

interface ConfirmarDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  titulo: string;
  /** Texto exacto del aviso; se pinta tal cual, sin recortar. */
  cuerpo: string;
  confirmar: string;
  cancelar?: string;
  peligroso?: boolean;
  pendiente?: boolean;
  onConfirmar: () => void;
}

/**
 * Confirmacion modal reutilizada para borrar publicaciones (copy exacto de la
 * decision 11), salir de una comunidad y archivarla. Va sobre el Dialog de
 * Radix que ya usa la app, con el foco atrapado y Escape para cerrar.
 */
export function ConfirmarDialog({
  open,
  onOpenChange,
  titulo,
  cuerpo,
  confirmar,
  cancelar = "Cancelar",
  peligroso = false,
  pendiente = false,
  onConfirmar,
}: ConfirmarDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(v) => (!pendiente ? onOpenChange(v) : undefined)}>
      <DialogContent className="max-w-sm" showClose={!pendiente}>
        <DialogHeader>
          <DialogTitle className="font-heading text-lg font-bold">{titulo}</DialogTitle>
          <DialogDescription className="text-sm leading-relaxed text-[color:var(--fg-muted)]">
            {cuerpo}
          </DialogDescription>
        </DialogHeader>
        <div className="mt-2 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button
            type="button"
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={pendiente}
          >
            {cancelar}
          </Button>
          <Button
            type="button"
            variant={peligroso ? "danger" : "primary"}
            onClick={onConfirmar}
            loading={pendiente}
          >
            {confirmar}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
