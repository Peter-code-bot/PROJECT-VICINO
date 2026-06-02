"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

function DebugUrl() {
  const [info, setInfo] = useState<{ href: string; pathname: string } | null>(null);

  useEffect(() => {
    setInfo({
      href: window.location.href,
      pathname: window.location.pathname,
    });
  }, []);

  if (!info) return null;

  return (
    <div className="mt-6 rounded-md bg-black/90 px-4 py-3 text-left max-w-sm mx-auto">
      <p className="text-xs font-mono text-yellow-400 font-bold mb-1">DEBUG 404 URL:</p>
      <p className="text-xs font-mono text-white break-all">{info.href}</p>
      <p className="text-xs font-mono text-gray-400 mt-1">pathname: {info.pathname}</p>
    </div>
  );
}

export default function NotFound() {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="text-center space-y-4">
        <h1 className="text-6xl font-bold text-primary">404</h1>
        <h2 className="text-xl font-bold">VICINO</h2>
        <p className="text-muted-foreground max-w-sm">
          La página que buscas no existe o fue movida.
        </p>
        <Link
          href="/"
          className="inline-flex rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          Volver al inicio
        </Link>
        <DebugUrl />
      </div>
    </div>
  );
}
