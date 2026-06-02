"use client";

// MP#08 / F1 fix: covers /callback (no /auth prefix) which is the path Android
// resolves when the deep link vicino://auth/callback is opened — the OS parses
// host="auth" and path="/callback", so the WebView lands on /callback, not
// /auth/callback. Redirect immediately to /auth/callback where the real handler
// (page.tsx loader + OAuthUrlListener) lives.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export default function CallbackRedirectPage() {
  const router = useRouter();

  useEffect(() => {
    // Preserve query params so the code= param reaches /auth/callback
    const search = window.location.search;
    router.replace(`/auth/callback${search}`);
  }, [router]);

  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
    </div>
  );
}
