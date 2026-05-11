"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useChatUnreadCount } from "@/hooks/use-chat-unread-count";

const ChatUnreadContext = createContext(0);

export function ChatUnreadProvider({
  userId,
  initialCount,
  children,
}: {
  userId: string;
  initialCount: number;
  children: ReactNode;
}) {
  const { count } = useChatUnreadCount(userId, initialCount);
  return (
    <ChatUnreadContext.Provider value={count}>
      {children}
    </ChatUnreadContext.Provider>
  );
}

export function useChatUnread(): number {
  return useContext(ChatUnreadContext);
}
