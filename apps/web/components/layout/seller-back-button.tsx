"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

interface SellerBackButtonProps {
  fallback?: string;
  label?: string;
}

export function SellerBackButton({
  fallback = "/seller",
  label = "Regresar",
}: SellerBackButtonProps) {
  const router = useRouter();

  function handleBack() {
    // If there's navigation history within the app, go back
    // Otherwise fall back to the seller dashboard
    if (typeof window !== "undefined" && window.history.length > 2) {
      router.back();
    } else {
      router.push(fallback);
    }
  }

  return (
    <button
      onClick={handleBack}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors mb-4 -ml-1 group"
    >
      <ArrowLeft className="h-4 w-4 group-hover:-translate-x-0.5 transition-transform" />
      {label}
    </button>
  );
}
