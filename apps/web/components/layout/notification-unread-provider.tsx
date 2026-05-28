"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  useNotificationUnreadCount,
  type UseNotificationUnreadCountResult,
} from "@/hooks/use-notification-unread-count";

const NotificationUnreadContext = createContext<UseNotificationUnreadCountResult>({
  count: 0,
  decrement: () => {},
  decrementAll: () => {},
  increment: () => {},
});

export function NotificationUnreadProvider({
  userId,
  initialCount,
  children,
}: {
  userId: string;
  initialCount: number;
  children: ReactNode;
}) {
  const value = useNotificationUnreadCount(userId, initialCount);
  return (
    <NotificationUnreadContext.Provider value={value}>
      {children}
    </NotificationUnreadContext.Provider>
  );
}

export function useNotificationUnread(): UseNotificationUnreadCountResult {
  return useContext(NotificationUnreadContext);
}
