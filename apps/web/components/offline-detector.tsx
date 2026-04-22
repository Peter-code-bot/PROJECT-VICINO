"use client";

import { useEffect, useState } from "react";
import { WifiOff, RefreshCw, Wifi } from "lucide-react";

export function OfflineDetector() {
  const [isOffline, setIsOffline] = useState(false);
  const [wasOffline, setWasOffline] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined") {
      setIsOffline(!navigator.onLine);
    }

    const goOffline = () => setIsOffline(true);
    const goOnline = () => {
      setIsOffline(false);
      setWasOffline(true);
      setTimeout(() => setWasOffline(false), 3000);
    };

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
          if (s.connected) {
            setIsOffline(false);
            setWasOffline(true);
            setTimeout(() => setWasOffline(false), 3000);
          } else {
            setIsOffline(true);
          }
        });
      } catch {}
    })();

    return () => {
      window.removeEventListener("offline", goOffline);
      window.removeEventListener("online", goOnline);
    };
  }, []);

  // Reconnection toast
  if (wasOffline && !isOffline) {
    return (
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[9999] flex items-center gap-2 px-4 py-2 rounded-xl bg-green-500/90 text-white text-sm font-medium shadow-lg animate-fade-in">
        <Wifi className="w-4 h-4" />
        Conexión restablecida
      </div>
    );
  }

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
        className="flex items-center gap-2 px-6 py-3 rounded-xl bg-bone text-bone-contrast hover:bg-bone-dark transition-colors font-medium"
      >
        <RefreshCw className="w-5 h-5" />
        Reintentar
      </button>
    </div>
  );
}
