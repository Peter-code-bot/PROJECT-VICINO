"use client";

import { useEffect, useState } from "react";
import { WifiOff, RefreshCw } from "lucide-react";

export function OfflineDetector() {
  const [isOffline, setIsOffline] = useState(
    () => typeof navigator !== "undefined" ? !navigator.onLine : false
  );

  useEffect(() => {
    const goOffline = () => setIsOffline(true);
    const goOnline = () => setIsOffline(false);

    window.addEventListener("offline", goOffline);
    window.addEventListener("online", goOnline);

    // Use Capacitor Network plugin if available
    (async () => {
      try {
        const { Capacitor } = await import("@capacitor/core");
        if (!Capacitor.isNativePlatform()) return;
        const { Network } = await import("@capacitor/network");
        const status = await Network.getStatus();
        setIsOffline(!status.connected);
        Network.addListener("networkStatusChange", (s) => {
          setIsOffline(!s.connected);
        });
      } catch {}
    })();

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  if (!isOffline) return null;

  return (
    <div className="fixed inset-0 z-[9999] bg-background flex flex-col items-center justify-center p-6 text-center">
      <WifiOff className="w-16 h-16 text-muted-foreground mb-6" />
      <h2 className="text-2xl font-heading font-bold mb-2">Sin conexión</h2>
      <p className="text-muted-foreground mb-6 max-w-sm">
        VICINO necesita conexión a internet para funcionar. Verifica tu conexión y vuelve a intentar.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-primary text-primary-foreground hover:bg-primary/90 transition-colors font-medium"
      >
        <RefreshCw className="w-5 h-5" />
        Reintentar
      </button>
    </div>
  );
}
