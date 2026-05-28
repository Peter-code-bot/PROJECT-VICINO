"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getTotalUnreadNotifications } from "@/app/(marketplace)/notificaciones/actions";

export interface UseNotificationUnreadCountResult {
  count: number;
  decrement: () => void;
  decrementAll: () => void;
  increment: () => void;
}

export function useNotificationUnreadCount(
  userId: string,
  initialCount: number,
): UseNotificationUnreadCountResult {
  const [count, setCount] = useState(initialCount);
  const debounceRef = useRef<NodeJS.Timeout | null>(null);

  const refetch = useCallback(async () => {
    try {
      const total = await getTotalUnreadNotifications();
      setCount(total);
    } catch (err) {
      console.error("[notification-unread] refetch failed", err);
    }
  }, []);

  const debouncedRefetch = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(refetch, 300);
  }, [refetch]);

  useEffect(() => {
    if (!userId) return;

    const supabase = createClient();

    const channel = supabase
      .channel(`notification-unread:${userId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${userId}`,
        },
        debouncedRefetch,
      )
      .subscribe();

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [userId, debouncedRefetch]);

  const decrement = useCallback(() => {
    setCount((c) => Math.max(0, c - 1));
  }, []);

  const decrementAll = useCallback(() => {
    setCount(0);
  }, []);

  const increment = useCallback(() => {
    setCount((c) => c + 1);
  }, []);

  return { count, decrement, decrementAll, increment };
}
