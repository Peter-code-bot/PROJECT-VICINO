"use client";

import { usePushNotifications } from "@/hooks/usePushNotifications";

export function PushNotificationInit() {
  usePushNotifications();
  return null;
}
