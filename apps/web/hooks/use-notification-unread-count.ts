"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { canalesGestionados, refrescoCoalescido } from "@/lib/realtime/canales-gestionados";
import { getTotalUnreadNotifications } from "@/app/(marketplace)/notificaciones/actions";

export interface UseNotificationUnreadCountResult {
  count: number;
  pending: boolean;
  retry: () => void;
  decrement: () => void;
  decrementAll: () => void;
  increment: () => void;
}

export function useNotificationUnreadCount(userId: string, initialCount: number): UseNotificationUnreadCountResult {
  const [value, setValue] = useState({ userId, count: initialCount, pending: false });
  const retryRef = useRef<() => void>(() => {});
  const retry = useCallback(() => retryRef.current(), []);

  useEffect(() => {
    if (!userId) return;
    const supabase = createClient();
    const controller = canalesGestionados(supabase);
    let disposed = false;
    let revision = 0;
    const scopes = new Map<string, () => boolean>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const pending = () => {
      revision++;
      clearTimeout(timer);
      if (!disposed) setValue((v) => ({ userId, count: v.userId === userId ? v.count : initialCount, pending: true }));
    };
    const refresh = refrescoCoalescido(async () => {
      if (![...scopes.values()].some((vigente) => vigente())) return;
      const version = revision;
      const result = await getTotalUnreadNotifications();
      if (disposed || version !== revision) return;
      if (result.error || result.userId !== userId) { pending(); return; }
      setValue({ userId, count: result.count, pending: false });
    }, pending);
    const debounce = () => {
      clearTimeout(timer);
      timer = setTimeout(() => refresh.solicitar(), 300);
    };
    retryRef.current = debounce;
    const unregister = [
      controller.registrar(`notification-unread:${userId}`, ({ vigente }) => {
        scopes.set(`notification-unread:${userId}`, vigente);
        return supabase
        .channel(`notification-unread:${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${userId}` },
          () => { if (vigente()) debounce(); })
        .subscribe((status) => {
          if (!vigente()) return;
          if (status === "SUBSCRIBED") debounce();
          else pending();
        });
      }, pending),
    ];
    return () => {
      disposed = true;
      revision++;
      clearTimeout(timer);
      refresh.cancelar();
      retryRef.current = () => {};
      unregister.forEach((remove) => remove());
    };
  }, [userId, initialCount]);

  const decrement = useCallback(() => setValue((v) => ({ ...v, count: Math.max(0, v.count - 1) })), []);
  const decrementAll = useCallback(() => setValue((v) => ({ ...v, count: 0 })), []);
  const increment = useCallback(() => setValue((v) => ({ ...v, count: v.count + 1 })), []);
  return {
    count: value.userId === userId ? value.count : initialCount,
    pending: value.userId !== userId || value.pending,
    retry, decrement, decrementAll, increment,
  };
}
