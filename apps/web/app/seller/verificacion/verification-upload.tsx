"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { Camera, ImagePlus, CheckCircle, Clock, XCircle, Bot, Trash2 } from "lucide-react";
import { verifyDocument } from "@/app/actions/verify-document";
import { UNIVERSITY_COLORS } from "@/lib/utils";

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

      <div className="space-y-4">
        <p className="text-sm font-medium">Tipo de documento</p>
        <div className="grid grid-cols-2 gap-3">
          <button
            type="button"
            onClick={() => setDocType("INE")}
            disabled={uploading !== null || isAnalyzing}
            className={`flex flex-col items-center gap-2 rounded-[var(--r-xl)] border-2 p-4 transition-all ${
              docType === "INE"
                ? "border-indigo-500 bg-indigo-500/10 shadow-md shadow-indigo-500/10"
                : "border-[color:var(--border)] bg-[color:var(--card-2)] hover:border-[color:var(--text-muted)]"
            } disabled:opacity-50`}
          >
            <span className="text-3xl">🪪</span>
            <span className="text-sm font-semibold">INE Oficial</span>
          </button>
          <button
            type="button"
            onClick={() => setDocType("Credencial Universitaria")}
            disabled={uploading !== null || isAnalyzing}
            className={`flex flex-col items-center gap-2 rounded-[var(--r-xl)] border-2 p-4 transition-all disabled:opacity-50 ${
              docType !== "Credencial Universitaria"
                ? "border-[color:var(--border)] bg-[color:var(--card-2)] hover:border-[color:var(--text-muted)]"
                : ""
            }`}
            style={docType === "Credencial Universitaria" ? {
              borderColor: UNIVERSITY_COLORS[university] || "#0ea5e9",
              backgroundColor: `${UNIVERSITY_COLORS[university] || "#0ea5e9"}1A`,
              boxShadow: `0 4px 6px -1px ${UNIVERSITY_COLORS[university] || "#0ea5e9"}1A`
            } : undefined}
          >
            <span className="text-3xl">🎓</span>
            <span className="text-sm font-semibold" style={docType === "Credencial Universitaria" ? { color: UNIVERSITY_COLORS[university] || "#0ea5e9" } : undefined}>Credencial Universitaria</span>
          </button>
        </div>

        {docType === "Credencial Universitaria" && (
          <div className="rounded-[var(--r-xl)] bg-[color:var(--card-2)] border border-[color:var(--border)] p-4">
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
                {uploading === key ? (
                  <p className="text-xs text-indigo-400 animate-pulse">Procesando...</p>
                ) : existingDocs[key] ? (
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
                    className="inline-flex items-center justify-center h-9 w-9 rounded-full bg-neutral-800 text-neutral-200 hover:bg-neutral-700 transition-colors disabled:opacity-50"
                    title="Eliminar"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
                {/* Botón Galería */}
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
                  <span className="inline-flex flex-col items-center justify-center h-9 w-9 rounded-full bg-[color:var(--card-2)] border border-[color:var(--border)] hover:bg-[color:var(--bg-elev-2)] transition-colors cursor-pointer" title="Galería">
                    <ImagePlus className="h-4 w-4" />
                  </span>
                </label>
                {/* Botón Cámara */}
                <label className="cursor-pointer">
                  <input
                    type="file"
                    id={`file-camera-${key}`}
                    accept="image/*"
                    capture={key === "selfie" ? "user" : "environment"}
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleUpload(key, file);
                    }}
                    disabled={uploading !== null || isAnalyzing}
                  />
                  <span className="inline-flex flex-col items-center justify-center h-9 w-9 rounded-full bg-indigo-500/15 text-indigo-400 border border-indigo-500/30 hover:bg-indigo-500/25 transition-colors cursor-pointer" title="Cámara">
                    <Camera className="h-4 w-4" />
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
