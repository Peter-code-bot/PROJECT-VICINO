"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getChatOperations } from "@/app/(marketplace)/chat/sales-actions";
import { cancelSale, confirmSale, respondPurchaseIntent } from "@/app/(marketplace)/chat/actions";
import { mergeOperations, type ChatOperation, type OperationCursor, type OperationProposal } from "@/lib/chat/operations";

type Restoration = { ids: string[]; cursor: OperationCursor | null } | null;
const keyFor = (op: ChatOperation) => op.intentMessageId ?? op.saleId ?? op.id;

export function useChatOperations(chatId: string, messageIds: string[], restoration: Restoration = null, enabled = true) {
  const [operations, setOperations] = useState<ChatOperation[]>([]);
  const [historyIds, setHistoryIds] = useState<string[]>([]);
  const [nextCursor, setNextCursor] = useState<OperationCursor | null>(null);
  const paginationCursor = useRef<OperationCursor | null>(null);
  const updateCursor = useCallback((value: OperationCursor | null) => { paginationCursor.current = value; setNextCursor(value); }, []);
  const [ready, setReady] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Set<string>>(new Set());
  const [errors, setErrors] = useState<Record<string, string>>({});
  const ids = useRef(messageIds);
  const known = useRef<ChatOperation[]>([]);
  const mounted = useRef(false);
  const allowed = useRef(enabled);
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const refreshing = useRef<Promise<boolean> | null>(null);
  const again = useRef(false);
  const paging = useRef(false);
  const mutationLocks = useRef(new Set<string>());
  const revision = useRef(0);
  const restore = useRef<Restoration>(null);
  const initialized = useRef(false);
  const messageKey = messageIds.join(",");
  const restorationKey = JSON.stringify(restoration);

  const refresh = useCallback((): Promise<boolean> => {
    again.current = true;
    if (refreshing.current) return refreshing.current;
    const run = async () => {
      let succeeded = false;
      try {
        do {
          again.current = false;
          if (!mounted.current || !allowed.current) return false;
          const version = revision.current;
          const first = await getChatOperations({ chatId, limit: 20 });
          if (!mounted.current || !allowed.current) return false;
          if (first.error) throw new Error(first.error);
          const wanted = [...new Set([...ids.current, ...(restore.current?.ids ?? []), ...known.current.map(op => op.saleId ?? op.intentMessageId ?? op.id)])];
          let received = first.items;
          for (let offset = 0; offset < wanted.length; offset += 100) {
            const batch = await getChatOperations({ chatId, ids: wanted.slice(offset, offset + 100), limit: 100 });
            if (!mounted.current || !allowed.current) return false;
            if (batch.error) throw new Error(batch.error);
            received = mergeOperations(received, batch.items);
          }
          if (version !== revision.current) { again.current = true; continue; }
          const restored = restore.current;
          restore.current = null;
          const previousKeys = new Set(known.current.map(keyFor));
          known.current = received;
          setOperations(received);
          setHistoryIds(previous => [...new Set([...first.items.map(keyFor), ...(restored?.ids ?? []), ...previous])].filter(id => received.some(op => keyFor(op) === id)));
          if (restored) updateCursor(restored.cursor);
          else if (!initialized.current) updateCursor(first.nextCursor);
          else if (first.nextCursor && first.items.length > 0 && !previousKeys.has(keyFor(first.items[first.items.length - 1]!))) {
            // More than a page of new requests may arrive after an exhausted history.
            // Reopen only the unseen gap; a routine refresh must preserve exhaustion.
            updateCursor(first.nextCursor);
          }
          initialized.current = true;
          setError(null); setReady(true); succeeded = true;
        } while (again.current && mounted.current && allowed.current);
      } catch (cause) {
        if (mounted.current && allowed.current) { setError(cause instanceof Error ? cause.message : "No se pudo comprobar el estado. Reintenta."); setReady(false); }
      }
      return succeeded;
    };
    // Pagination and reconciliation share one queue: no late page can overwrite a newer refresh.
    const promise = queue.current.then(run, run);
    queue.current = promise.catch(() => false);
    refreshing.current = promise.finally(() => { refreshing.current = null; if (again.current && mounted.current && allowed.current) void refresh(); });
    return refreshing.current;
  }, [chatId, updateCursor]);

  useEffect(() => { restore.current = JSON.parse(restorationKey); }, [restorationKey]);
  useEffect(() => {
    mounted.current = true;
    const recover = () => { void refresh(); };
    window.addEventListener("online", recover); window.addEventListener("focus", recover);
    return () => { mounted.current = false; revision.current++; window.removeEventListener("online", recover); window.removeEventListener("focus", recover); };
  }, [refresh]);
  useEffect(() => {
    allowed.current = enabled;
    revision.current++;
    if (!enabled) {
      known.current = []; initialized.current = false;
      queueMicrotask(() => { if (mounted.current && !allowed.current) { setOperations([]); setHistoryIds([]); setReady(false); updateCursor(null); } });
      return;
    }
    ids.current = messageKey ? messageKey.split(",") : [];
    void refresh();
  }, [messageKey, restorationKey, enabled, refresh, updateCursor]);

  const loadMore = useCallback(async () => {
    if (!paginationCursor.current || paging.current || !allowed.current) return;
    paging.current = true; setLoadingMore(true);
    const run = async () => {
      if (!mounted.current || !allowed.current) return;
      const cursor = paginationCursor.current;
      if (!cursor) return;
      const version = revision.current;
      try {
        const page = await getChatOperations({ chatId, cursor, limit: 20 });
        if (!mounted.current || !allowed.current) return;
        if (page.error) throw new Error(page.error);
        if (version !== revision.current) { void refresh(); return; }
        known.current = mergeOperations(known.current, page.items);
        setOperations(known.current);
        setHistoryIds(previous => [...new Set([...previous, ...page.items.map(keyFor)])]);
        updateCursor(page.nextCursor); setError(null);
      } catch (cause) { if (mounted.current && allowed.current) setError(cause instanceof Error ? cause.message : "No se pudo cargar la siguiente página."); }
    };
    const promise = queue.current.then(run, run);
    queue.current = promise.catch(() => undefined);
    try { await promise; } finally { paging.current = false; if (mounted.current) setLoadingMore(false); }
  }, [chatId, refresh, updateCursor]);

  const mutate = useCallback(async (op: ChatOperation, action: "accept" | "confirm" | "reject", proposal?: OperationProposal) => {
    const key = keyFor(op);
    if (!allowed.current || mutationLocks.current.has(key)) return false;
    mutationLocks.current.add(key); revision.current++;
    setPending(new Set(mutationLocks.current)); setErrors(previous => ({ ...previous, [key]: "" }));
    try {
      const result = action === "accept" && op.intentMessageId
        ? await respondPurchaseIntent({ messageId: op.intentMessageId, action: "aceptar", ...proposal })
        : action === "reject" && !op.saleId && op.intentMessageId ? await respondPurchaseIntent({ messageId: op.intentMessageId, action: "rechazar" })
          : action === "confirm" && op.saleId ? await confirmSale(op.saleId)
            : action === "reject" && op.saleId ? await cancelSale(op.saleId, "Operación cerrada desde el chat")
              : { error: "Esta acción ya no está disponible." };
      if ("error" in result && result.error) throw new Error(result.error);
      const checked = await refresh();
      if (!checked && mounted.current && allowed.current) setErrors(previous => ({ ...previous, [key]: "Respuesta enviada. Actualiza las operaciones para comprobar el resultado antes de continuar." }));
      return checked;
    } catch (cause) {
      if (mounted.current && allowed.current) setErrors(previous => ({ ...previous, [key]: cause instanceof Error ? cause.message : "No pudimos comprobar el resultado. Reintenta la misma respuesta; no se duplicará la operación." }));
      await refresh(); return false;
    } finally { mutationLocks.current.delete(key); if (mounted.current) setPending(new Set(mutationLocks.current)); }
  }, [refresh]);

  return { operations: enabled ? operations : [], history: enabled ? historyIds.flatMap(id => operations.find(op => keyFor(op) === id) ?? []) : [],
    ready: enabled && ready, error, nextCursor: enabled ? nextCursor : null, loadingMore, refresh, loadMore, mutate,
    reveal: (op: ChatOperation) => setHistoryIds(previous => [...new Set([...previous, keyFor(op)])]),
    isPending: (op: ChatOperation) => pending.has(keyFor(op)), errorFor: (op: ChatOperation) => errors[keyFor(op)] };
}
