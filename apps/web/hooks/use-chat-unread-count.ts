"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { createClient } from "@/lib/supabase/client";
import { getTotalUnreadChats } from "@/app/(marketplace)/chat/actions";

export function useChatUnreadCount(userId: string, initialCount: number) {
  const [count, setCount] = useState(initialCount);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const refetch = useCallback(async () => {
    try {
      const total = await getTotalUnreadChats();
      setCount(total);
    } catch (err) {
      console.error("[chat-unread] refetch failed", err);
      // mantiene último valor válido en error de red
    }
  }, []);

  // Debounce de 300ms: ráfagas de mensajes → un solo refetch
  const debouncedRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refetch, 300);
  }, [refetch]);

  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();

    const buyerChannel = supabase
      .channel(`chat-unread-buyer:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chats",
          filter: `comprador_id=eq.${userId}`,
        },
        debouncedRefetch
      )
      .subscribe();

    const sellerChannel = supabase
      .channel(`chat-unread-seller:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "chats",
          filter: `vendedor_id=eq.${userId}`,
        },
        debouncedRefetch
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(buyerChannel);
      supabase.removeChannel(sellerChannel);
    };
  }, [userId, debouncedRefetch]);

  return { count };
}
