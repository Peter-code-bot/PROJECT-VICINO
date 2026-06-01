"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Upload, CheckCircle, Clock, XCircle, Bot, Trash2 } from "lucide-react";
import { verifyDocument } from "@/app/actions/verify-document";

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
    document_type?: string | null;
    university_name?: string | null;
  } | null;
}

const UNIVERSITIES = [
  "BUAP",
  "UDLAP",
  "UPAEP",
  "Tecnológico de Monterrey",
  "Universidad Iberoamericana",
  "Universidad Anáhuac",
  "UVM",
  "UMAD",
  "UVP",
  "Otra"
];

export function VerificationUpload({
  userId,
  verification,
  sellerVerification,
}: VerificationUploadProps) {
  const [uploading, setUploading] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState("");
  
  const [docType, setDocType] = useState<"INE" | "Credencial Universitaria">(
    (sellerVerification?.document_type as "INE" | "Credencial Universitaria") || "INE"
  );
  const [university, setUniversity] = useState<string>(
    sellerVerification?.university_name || "BUAP"
  );

  const router = useRouter();
  const supabase = createClient();

  const existingDocs: Record<string, string | null | undefined> = {
    selfie: sellerVerification?.selfie_url ?? verification?.selfie_url,
    ine_front: sellerVerification?.ine_front_url ?? verification?.id_front_url,
    ine_back: sellerVerification?.ine_back_url ?? verification?.id_back_url,
  };

  const [previews, setPreviews] = useState<Record<string, string | null>>({});

  useEffect(() => {
    async function loadPreviews() {
      const p: Record<string, string | null> = {};
      for (const [key, path] of Object.entries(existingDocs)) {
        if (path) {
          // Extraemos path limpio en caso de que venga sucio
          const parts = path.split("verification-documents/");
          const cleanPath = (parts.length > 1 && parts[1]
            ? parts[1].split("?")[0]
            : path) as string;
            
          const { data } = await supabase.storage.from("verification-documents").createSignedUrl(cleanPath, 60 * 60);
          if (data) {
            p[key] = data.signedUrl;
          }
        }
      }
      setPreviews(prev => ({ ...prev, ...p }));
    }
    loadPreviews();
  }, [existingDocs.selfie, existingDocs.ine_front, existingDocs.ine_back]);

  const status = sellerVerification?.status ?? "none";

  const getDocsConfig = () => {
    if (docType === "Credencial Universitaria") {
      return [
        { key: "selfie", label: "Selfie", accept: "image/*" },
        { key: "ine_front", label: "Credencial (frente)", accept: "image/*" },
        { key: "ine_back", label: "Credencial (reverso)", accept: "image/*" },
      ];
    }
    return [
      { key: "selfie", label: "Selfie", accept: "image/*" },
      { key: "ine_front", label: "INE (frente)", accept: "image/*" },
      { key: "ine_back", label: "INE (reverso)", accept: "image/*" },
    ];
  };

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

    const updates: Record<string, string> = {};
    if (key === "selfie") updates.selfie_url = path;
    if (key === "ine_front") updates.ine_front_url = path;
    if (key === "ine_back") updates.ine_back_url = path;

    // Actualizamos DB inicialmente como pending
    if (sellerVerification) {
      await supabase
        .from("seller_verification")
        .update({ 
          ...updates, 
          status: "pending", 
          document_type: docType,
          university_name: docType === "Credencial Universitaria" ? university : null,
          submitted_at: new Date().toISOString() 
        })
        .eq("user_id", userId);
    } else {
      await supabase.from("seller_verification").insert({
        user_id: userId,
        ...updates,
        status: "pending",
        document_type: docType,
        university_name: docType === "Credencial Universitaria" ? university : null,
        submitted_at: new Date().toISOString(),
      });
    }

    // Si es la foto frontal, lanzamos la IA
    if (key === "ine_front") {
      setIsAnalyzing(true);
      const result = await verifyDocument(
        path, 
        docType, 
        docType === "Credencial Universitaria" ? university : undefined
      );
      
      if (!result.success && result.error) {
        setError(result.error);
      }
      setIsAnalyzing(false);
    }

    setPreviews(prev => ({ ...prev, [key]: URL.createObjectURL(file) }));
    setUploading(null);
    router.refresh();
  }

  async function handleDelete(key: string) {
    const path = existingDocs[key];
    if (!path) return;

    setError("");
    setUploading(key); // Reusamos el estado de uploading para bloquear el UI

    // Borramos físicamente del storage
    const parts = path.split("verification-documents/");
    const cleanPath = (parts.length > 1 && parts[1]
      ? parts[1].split("?")[0]
      : path) as string;
      
    await supabase.storage.from("verification-documents").remove([cleanPath]);

    // Borramos de la DB
    const updates: Record<string, null> = {};
    if (key === "selfie") updates.selfie_url = null;
    if (key === "ine_front") updates.ine_front_url = null;
    if (key === "ine_back") updates.ine_back_url = null;

    if (sellerVerification) {
      await supabase.from("seller_verification").update(updates).eq("user_id", userId);
    }

    setPreviews(prev => ({ ...prev, [key]: null }));
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
    <div className="space-y-6">
      {status !== "none" && !isAnalyzing && (
        <div className="flex items-start sm:items-center gap-2 rounded-[var(--r-lg)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-2 sm:p-3">
          <div className="shrink-0 mt-0.5 sm:mt-0">{statusIcon}</div>
          <span className="text-xs sm:text-sm font-medium">
            {status === "approved" && "Verificación aprobada automáticamente por IA"}
            {status === "pending" && "En revisión manual — espera la aprobación del admin"}
            {status === "rejected" && "Verificación rechazada — documento no válido"}
          </span>
        </div>
      )}

      {isAnalyzing && (
        <div className="flex items-center gap-2 rounded-[var(--r-lg)] bg-indigo-500/10 border border-indigo-500/20 p-3">
          <Bot className="h-5 w-5 text-indigo-500 animate-pulse" />
          <span className="text-sm font-medium text-indigo-500">
            Analizando documento con Inteligencia Artificial...
          </span>
        </div>
      )}

      {error && (
        <div className="rounded-[var(--r-lg)] bg-[color:var(--danger)]/10 p-3 text-sm text-[color:var(--danger)]">
          {error}
        </div>
      )}

      <div className="space-y-4 rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4">
        <div>
          <label className="block text-sm font-medium mb-2">Tipo de documento</label>
          <select 
            value={docType}
            onChange={(e) => setDocType(e.target.value as any)}
            disabled={uploading !== null || isAnalyzing}
            className="w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 text-sm"
          >
            <option value="INE">INE Oficial</option>
            <option value="Credencial Universitaria">Credencial Universitaria</option>
          </select>
        </div>

        {docType === "Credencial Universitaria" && (
          <div>
            <label className="block text-sm font-medium mb-2">Selecciona tu Universidad</label>
            <select 
              value={university}
              onChange={(e) => setUniversity(e.target.value)}
              disabled={uploading !== null || isAnalyzing}
              className="w-full rounded-md border border-[color:var(--border)] bg-[color:var(--bg-elev-1)] px-3 py-2 text-sm"
            >
              {UNIVERSITIES.map(u => (
                <option key={u} value={u}>{u}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {getDocsConfig().map(({ key, label, accept }) => (
          <div key={key} className="rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4 overflow-hidden">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-sm">{label}</p>
                {existingDocs[key] ? (
                  <p className="text-xs text-[color:var(--trust-emerald)]">Subido correctamente</p>
                ) : (
                  <p className="text-xs text-[color:var(--danger)]">Documento requerido</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {existingDocs[key] && (
                  <button
                    onClick={() => handleDelete(key)}
                    disabled={uploading !== null || isAnalyzing}
                    className="inline-flex items-center justify-center h-8 w-8 rounded-full bg-red-500/10 text-red-600 hover:bg-red-500/20 transition-colors disabled:opacity-50"
                    title="Eliminar imagen"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
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
                    disabled={uploading !== null || isAnalyzing}
                  />
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--r-pill)] border border-[color:var(--border)] text-xs font-medium hover:bg-[color:var(--bg-elev-2)] transition-colors">
                    <Upload className="h-4 w-4 shrink-0" />
                    {uploading === key ? "Procesando..." : existingDocs[key] ? "Reemplazar" : "Subir archivo"}
                  </span>
                </label>
              </div>
            </div>

            {previews[key] && (
              <div className="mt-4 w-full h-40 rounded-lg overflow-hidden border border-[color:var(--border)] relative bg-[color:var(--bg-elev-1)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img 
                  src={previews[key]!} 
                  alt={`Preview ${label}`}
                  className="w-full h-full object-contain"
                />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
