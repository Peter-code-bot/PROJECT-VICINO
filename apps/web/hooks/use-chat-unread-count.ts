"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { canalesGestionados, refrescoCoalescido } from "@/lib/realtime/canales-gestionados";
import { getTotalUnreadChats } from "@/app/(marketplace)/chat/actions";


export function useChatUnreadCount(userId: string, initialCount: number) {
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
      const result = await getTotalUnreadChats();
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
      controller.registrar(`chat-unread-buyer:${userId}`, ({ vigente }) => {
        scopes.set(`chat-unread-buyer:${userId}`, vigente);
        return supabase
        .channel(`chat-unread-buyer:${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "chats", filter: `comprador_id=eq.${userId}` },
          () => { if (vigente()) debounce(); })
        .subscribe((status) => {
          if (!vigente()) return;
          if (status === "SUBSCRIBED") debounce();
          else pending();
        });
      }, pending),
      controller.registrar(`chat-unread-seller:${userId}`, ({ vigente }) => {
        scopes.set(`chat-unread-seller:${userId}`, vigente);
        return supabase
        .channel(`chat-unread-seller:${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "chats", filter: `vendedor_id=eq.${userId}` },
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

  return {
    count: value.userId === userId ? value.count : initialCount,
    pending: value.userId !== userId || value.pending,
    retry,
  };
}
