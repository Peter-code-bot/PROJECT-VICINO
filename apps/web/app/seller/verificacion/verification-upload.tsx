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
      <CheckCircle className="h-5 w-5 text-green-500" />
    ) : status === "pending" ? (
      <Clock className="h-5 w-5 text-amber-500" />
    ) : status === "rejected" ? (
      <XCircle className="h-5 w-5 text-red-500" />
    ) : null;

  return (
    <div className="space-y-4">
      {status !== "none" && (
        <div className="flex items-center gap-2 rounded-lg border p-3">
          {statusIcon}
          <span className="text-sm font-medium">
            {status === "approved" && "Verificación aprobada"}
            {status === "pending" && "En revisión — espera la aprobación del admin"}
            {status === "rejected" && "Verificación rechazada — sube documentos nuevamente"}
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-md bg-red-50 dark:bg-red-950 p-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {DOCS.map(({ key, label, accept }) => (
          <div key={key} className="rounded-lg border p-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-sm">{label}</p>
                {existingDocs[key] ? (
                  <p className="text-xs text-green-600">Subido</p>
                ) : (
                  <p className="text-xs text-muted-foreground">No subido</p>
                )}
              </div>
              <label className="cursor-pointer">
                <input
                  type="file"
                  accept={accept}
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleUpload(key, file);
                  }}
                  disabled={uploading !== null}
                />
                <span className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-accent">
                  <Upload className="h-3 w-3" />
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
