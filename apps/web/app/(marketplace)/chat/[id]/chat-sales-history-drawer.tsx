"use client";

import { useRef, useState } from "react";
import { X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import type { useChatOperations } from "@/hooks/use-chat-operations";
import { ChatOperationCard } from "./chat-operation-card";

type Model = ReturnType<typeof useChatOperations>;
const panels = new Map<string, { filter: string; scrollTop: number }>();
interface Props {
  open: boolean; onClose: () => void; currentUserId: string; model: Model;
  stateKey: string;
  expanded: Set<string>; onToggle: (id: string) => void; onBeforeProduct: () => void; onRestoreFocus: () => void;
}
export function ChatSalesHistoryDrawer({ open, onClose, currentUserId, model, stateKey, expanded, onToggle, onBeforeProduct, onRestoreFocus }: Props) {
  const [filter, setFilter] = useState(() => panels.get(stateKey)?.filter ?? "all");
  const scrollRef = useRef<HTMLDivElement>(null);
  const remember = () => {
    panels.set(stateKey, { filter, scrollTop: scrollRef.current?.scrollTop ?? 0 });
    if (panels.size > 20) panels.delete(panels.keys().next().value!);
  };
  const close = () => { remember(); onClose(); };
  const filtered = model.history.filter(op => filter === "all" || (filter === "pending"
    ? ["requested", "accepted", "pending_confirmation", "legacy"].includes(op.status)
    : filter === "completed" ? op.status === "completed" : ["rejected", "cancelled", "expired"].includes(op.status)));
  return <Dialog open={open} onOpenChange={value => { if (!value) close(); }}>
    <DialogContent showClose={false} onOpenAutoFocus={() => { requestAnimationFrame(() => { if (scrollRef.current) scrollRef.current.scrollTop = panels.get(stateKey)?.scrollTop ?? 0; }); }} onCloseAutoFocus={event => { event.preventDefault(); onRestoreFocus(); }} className="left-auto right-0 top-0 flex h-dvh max-h-dvh w-full max-w-md translate-x-0 translate-y-0 flex-col gap-3 rounded-none p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
      <div className="flex items-center justify-between gap-2">
        <DialogTitle>Historial de operaciones</DialogTitle>
        <button type="button" onClick={close} aria-label="Cerrar historial" className="inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl hover:bg-card-2 focus-visible:outline-2 focus-visible:outline-brand"><X aria-hidden /></button>
      </div>
      <DialogDescription>Solicitudes y ventas de este chat. Cada operación conserva su producto y condiciones.</DialogDescription>
      <div className="flex flex-wrap gap-1" aria-label="Filtrar operaciones">
        {([["all", "Todas"], ["pending", "Pendientes"], ["completed", "Completadas"], ["closed", "Rechazadas y cerradas"]] as const).map(([id, label]) => <button type="button" key={id} aria-pressed={filter === id} onClick={() => setFilter(id)} className={`min-h-12 rounded-xl px-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-brand ${filter === id ? "bg-brand text-white" : "bg-card-2 text-fg"}`}>{label}</button>)}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        {model.error && <div role="alert" className="text-sm"><p>{model.error}</p><button type="button" onClick={() => void model.refresh()} className="min-h-12 text-brand-hi font-semibold">Reintentar</button></div>}
        {!model.ready && !model.error && <p role="status">Cargando operaciones…</p>}
        {model.ready && filtered.length === 0 && <p className="text-sm text-fg-muted">{model.nextCursor ? "No hay coincidencias en las páginas cargadas. Puedes cargar más operaciones." : "No hay operaciones para este filtro."}</p>}
        {filtered.map(op => <ChatOperationCard key={op.id} operation={op} currentUserId={currentUserId}
          expanded={expanded.has(op.intentMessageId ?? op.id)} onToggle={() => onToggle(op.intentMessageId ?? op.id)}
          busy={model.isPending(op)} disabled={!model.ready} error={model.errorFor(op)} onBeforeProduct={() => { remember(); onBeforeProduct(); }}
          onAction={(action, proposal) => model.mutate(op, action, proposal)} />)}
        {model.nextCursor && <button type="button" onClick={() => void model.loadMore()} disabled={model.loadingMore} className="min-h-12 w-full rounded-xl border border-border text-sm font-semibold text-brand-hi">{model.loadingMore ? "Cargando…" : "Cargar más operaciones"}</button>}
      </div>
    </DialogContent>
  </Dialog>;
}
