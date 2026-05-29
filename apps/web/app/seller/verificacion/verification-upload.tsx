"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Upload, CheckCircle, Clock, XCircle } from "lucide-react";

interface VerificationUploadProps {
  userId: string;
  verification: {
    selfie_url?: string | null;
    selfie_verified?: boolean;
    id_front_url?: string | null;
    id_back_url?: string | null;
    id_verified?: boolean;
    phone_verified?: boolean;
    current_level?: string;
  } | null;
  sellerVerification: {
    status?: string;
    ine_front_url?: string | null;
    ine_back_url?: string | null;
    selfie_url?: string | null;
  } | null;
}

const DOCS = [
  { key: "selfie", label: "Selfie", accept: "image/*" },
  { key: "ine_front", label: "INE (frente)", accept: "image/*" },
  { key: "ine_back", label: "INE (reverso)", accept: "image/*" },
] as const;

export function VerificationUpload({
  userId,
  verification,
  sellerVerification,
}: VerificationUploadProps) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState("");
  const router = useRouter();
  const supabase = createClient();

  const existingDocs: Record<string, string | null | undefined> = {
    selfie: sellerVerification?.selfie_url ?? verification?.selfie_url,
    ine_front: sellerVerification?.ine_front_url ?? verification?.id_front_url,
    ine_back: sellerVerification?.ine_back_url ?? verification?.id_back_url,
  };

  const status = sellerVerification?.status ?? "none";

  async function handleUpload(key: string, file: File) {
    setError("");
    setUploading(key);

    // eslint-disable-next-line react-hooks/purity -- Date.now() intencional para path unico de upload metadata; follow-up: mover generacion de path a server action
    const path = `${userId}/${key}-${Date.now()}.${file.name.split(".").pop()}`;
    const { error: uploadError } = await supabase.storage
      .from("verification-documents")
      .upload(path, file);

    if (uploadError) {
      setError(uploadError.message);
      setUploading(null);
      return;
    }

    // Store the storage path (not a URL) — bucket is private. Admin
    // generates short-lived signed URLs server-side at view time.
    // Column names retain the *_url suffix for backwards compatibility,
    // but the values are paths like "<userId>/selfie-<ts>.png".
    const updates: Record<string, string> = {};
    if (key === "selfie") updates.selfie_url = path;
    if (key === "ine_front") updates.ine_front_url = path;
    if (key === "ine_back") updates.ine_back_url = path;

    if (sellerVerification) {
      await supabase
        .from("seller_verification")
        .update({ ...updates, status: "pending", submitted_at: new Date().toISOString() })
        .eq("user_id", userId);
    } else {
      await supabase.from("seller_verification").insert({
        user_id: userId,
        ...updates,
        status: "pending",
        submitted_at: new Date().toISOString(),
      });
    }

    setUploading(null);
    router.refresh();
  }

  const statusIcon =
    status === "approved" ? (
      <CheckCircle className="h-5 w-5 text-[color:var(--trust-emerald)]" />
    ) : status === "pending" ? (
      <Clock className="h-5 w-5 text-amber-400" />
    ) : status === "rejected" ? (
      <XCircle className="h-5 w-5 text-[color:var(--danger)]" />
    ) : null;

  return (
    <div className="space-y-4">
      {status !== "none" && (
        <div className="flex items-start sm:items-center gap-2 rounded-[var(--r-lg)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-2 sm:p-3">
          <div className="shrink-0 mt-0.5 sm:mt-0">{statusIcon}</div>
          <span className="text-xs sm:text-sm font-medium">
            {status === "approved" && "Verificación aprobada"}
            {status === "pending" && "En revisión — espera la aprobación del admin"}
            {status === "rejected" && "Verificación rechazada — sube documentos nuevamente"}
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-[var(--r-lg)] bg-[color:var(--danger)]/10 p-3 text-sm text-[color:var(--danger)]">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {DOCS.map(({ key, label, accept }) => (
          <div key={key} className="rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4">
            <div className="flex items-center justify-between gap-2">
              <div className="min-w-0">
                <p className="font-medium text-xs sm:text-sm">{label}</p>
                {existingDocs[key] ? (
                  <p className="text-[10px] sm:text-xs text-[color:var(--trust-emerald)]">Subido</p>
                ) : (
                  <p className="text-[10px] sm:text-xs text-[color:var(--danger)]">Requerido</p>
                )}
              </div>
              <label className="cursor-pointer">
                <input
                  type="file"
                  id={`file-upload-${key}`}
                  accept={accept}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(key, file);
                  }}
                  disabled={uploading !== null}
                />
                <span className="inline-flex items-center gap-1.5 shrink-0 px-2 sm:px-3 py-1 sm:py-1.5 rounded-[var(--r-pill)] border border-[color:var(--border)] text-[10px] sm:text-xs font-medium hover:bg-[color:var(--bg-elev-2)] transition-colors">
                  <Upload className="h-3 w-3 shrink-0" />
                  {uploading === key ? "Subiendo..." : existingDocs[key] ? "Reemplazar" : "Subir"}
                </span>
              </label>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
