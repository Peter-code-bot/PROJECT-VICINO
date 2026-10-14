"use client";

import { CACHE_INMUTABLE } from "@/lib/storage/cache";
import { useState, useEffect, useRef, startTransition } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES, createPurchaseRequestSchema, type CreatePurchaseRequestInput } from "@vicino/shared";
import { createPurchaseRequest } from "@/app/actions/purchase-request";
import {
  X,
  Search,
  ChevronDown,
  ImagePlus,
  Clock,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { createPortal } from "react-dom";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { useCerrarConEscape } from "@/hooks/use-cerrar-con-escape";
import dynamic from "next/dynamic";
import Image from "next/image";

const DeliveryMap = dynamic(() => import("@/components/map/delivery-map"), { ssr: false });

interface CreateRequestDrawerProps {
  onClose: () => void;
  onCreated: () => void;
}

interface CategorySelection {
  slug: string;
  nombre: string;
}

const EXPIRY_OPTIONS = [
  { label: "24 horas", hours: 24 },
  { label: "3 días", hours: 72 },
  { label: "1 semana", hours: 168 },
] as const;

type PendingRequest = { input: CreatePurchaseRequestInput; uploadedFilePath: string | null; uncertain: boolean };
function readPendingRequest(userId: string): PendingRequest | null {
  try {
    const stored = sessionStorage.getItem("vicino:pending-request:" + userId);
    if (!stored) return null;
    const attempt = JSON.parse(stored);
    const parsed = createPurchaseRequestSchema.safeParse(attempt.input);
    if (!parsed.success || (attempt.uploadedFilePath !== null && typeof attempt.uploadedFilePath !== "string")) return null;
    if (attempt.uploadedFilePath && !attempt.uploadedFilePath.startsWith(userId + "/solicitudes-" + parsed.data.operation_id + ".")) return null;
    return { input: parsed.data, uploadedFilePath: attempt.uploadedFilePath, uncertain: true };
  } catch { return null; }
}

export function CreateRequestDrawer({
  onClose,
  onCreated,
}: CreateRequestDrawerProps) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [budget, setBudget] = useState("");
  const [expiryHours, setExpiryHours] = useState<number>(72);
  const [categories, setCategories] = useState<CategorySelection[]>([]);
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [unresolved, setUnresolved] = useState(false);
  const [restoring, setRestoring] = useState(true);
  const inFlight = useRef(false);
  const pendingAttempt = useRef<PendingRequest | null>(null);
  const [error, setError] = useState<string | null>(null);
  
  const [locationData, setLocationData] = useState({
    lat: 0,
    lng: 0,
    address: "",
  });

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const submitRequest = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setSubmitting(true);
    setError(null);
    let draftKey: string | null = null;
    try {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { setError("Inicia sesión para publicar"); return; }
      draftKey = "vicino:pending-request:" + user.id;
      let attempt = pendingAttempt.current ?? readPendingRequest(user.id);
      pendingAttempt.current = attempt;
      if (!attempt) {
        const input = {
          operation_id: crypto.randomUUID(), request_title: title,
          request_description: description || null,
          request_budget: budget.trim() ? Number(budget) : null,
          request_lat: locationData.lat, request_lng: locationData.lng,
          category_slugs: categories.map(category => category.slug), expiry_hours: expiryHours,
        };
        const parsed = createPurchaseRequestSchema.safeParse(input);
        if (!parsed.success) { setError(parsed.error.issues.at(0)?.message ?? "Revisa tu solicitud"); return; }
        if (!locationData.address && locationData.lat === 0 && locationData.lng === 0) {
          setError("Selecciona la ubicación de tu solicitud"); return;
        }
        attempt = { input: parsed.data, uploadedFilePath: null, uncertain: false };
        if (imageFile) {
          const extensions: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
          const extension = extensions[imageFile.type];
          if (!extension || imageFile.size > 5 * 1024 * 1024) {
            setError("Usa una imagen JPG, PNG o WebP de hasta 5 MB"); return;
          }
          const path = user.id + "/solicitudes-" + attempt.input.operation_id + "." + extension;
          const { error: uploadError } = await supabase.storage.from("product-media").upload(path, imageFile, { contentType: imageFile.type, cacheControl: CACHE_INMUTABLE });
          if (uploadError) {
            await supabase.storage.from("product-media").remove([path]);
            setError("No se pudo subir la imagen. Intenta de nuevo."); return;
          }
          attempt.uploadedFilePath = path;
          attempt.input.request_image_url = supabase.storage.from("product-media").getPublicUrl(path).data.publicUrl;
        }
        pendingAttempt.current = attempt;
        // Keep the same identity/payload across reloads after an ambiguous response.
        try { sessionStorage.setItem(draftKey, JSON.stringify(attempt)); } catch { /* ref still protects retries in this drawer */ }
      }
      setUnresolved(true);
      const hadUncertainResponse = attempt.uncertain;
      attempt.uncertain = true;
      try { sessionStorage.setItem(draftKey, JSON.stringify(attempt)); } catch { /* optional storage */ }
      const result = await createPurchaseRequest(attempt.input);
      if (result.status === "success") {
        try { sessionStorage.removeItem(draftKey); } catch { /* optional storage */ }
        pendingAttempt.current = null;
        setUnresolved(false);
        onCreated();
      } else if (result.status === "rejected" && !hadUncertainResponse) {
        if (attempt.uploadedFilePath) {
          const { error: cleanupError } = await supabase.storage.from("product-media").remove([attempt.uploadedFilePath]);
          if (cleanupError) setError(result.message + " No pudimos retirar la imagen de referencia.");
          else setError(result.message);
        } else setError(result.message);
        try { sessionStorage.removeItem(draftKey); } catch { /* optional storage */ }
        pendingAttempt.current = null;
        setUnresolved(false);
      } else {
        setError(result.status === "rejected" ? result.message + " La publicación anterior sigue pendiente de confirmar." : result.message);
      }
    } catch {
      // A dropped action response may follow a committed transaction. Never
      // delete its image or generate another operation while it is unresolved.
      setUnresolved(pendingAttempt.current !== null);
      setError("No pudimos confirmar la publicación. Reintenta para comprobar la misma solicitud.");
    } finally {
      inFlight.current = false;
      setSubmitting(false);
    }
  };
  const handleSubmit = () => startTransition(async () => { await submitRequest(); });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const { data: { user } } = await createClient().auth.getUser();
        if (!user || cancelled) return;
        const attempt = readPendingRequest(user.id);
        if (!attempt) return;
        const parsed = { data: attempt.input };
        pendingAttempt.current = attempt;
        setTitle(parsed.data.request_title);
        setDescription(parsed.data.request_description ?? "");
        setBudget(parsed.data.request_budget == null ? "" : String(parsed.data.request_budget));
        setExpiryHours(parsed.data.expiry_hours ?? 72);
        setCategories(parsed.data.category_slugs.map(slug => ({ slug, nombre: CATEGORIES.find(category => category.slug === slug)?.name ?? slug })));
        setLocationData({ lat: parsed.data.request_lat, lng: parsed.data.request_lng, address: "Ubicación de la solicitud pendiente" });
        setUnresolved(true);
        setError("Hay una publicación pendiente de confirmar. Reintenta para comprobar la misma solicitud.");
      } catch { /* no saved attempt */ }
      finally { if (!cancelled) setRestoring(false); }
    })();
    return () => { cancelled = true; };
  }, []);

  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- portal mount-detection pattern
    setMounted(true);
  }, []);
  // Fija raiz y body (ver el hook): antes solo se fijaba el body, que no para
  // el desplazamiento de la raiz, y al cerrar se borraba el overflow a ciegas.
  useBodyScrollLock(true);
  // Marca + Escape siempre juntos: el Atras de Android se traduce a Escape.
  const closeDrawer = () => { if (!inFlight.current) onClose(); };
  useCerrarConEscape(true, closeDrawer);

  if (!mounted) return null;

  const visibleCategories = CATEGORIES.filter((c) => !c.hidden_in_form);

  return createPortal(
    // El cromo nativo de iOS (CromoNativo.swift) se oculta solo con [data-modal-open="true"] o aria-modal; sin marca, la tab bar de vidrio quedaba encima (P0 26-sep).
    <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" data-modal-open="true">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeDrawer}
      />

      {/* Drawer */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nueva solicitud"
        className="relative flex flex-col w-full h-[100dvh] bg-card shadow-2xl animate-slide-up rounded-none md:h-auto md:max-h-[90vh] md:max-w-lg md:rounded-3xl border-t border-border/50"
      >
        {/* Handle */}
        <div className="shrink-0 sticky top-0 z-10 bg-card rounded-none md:rounded-t-3xl pt-2 pb-3">
          <div className="mx-auto mt-2 mb-3 h-1.5 w-12 rounded-full bg-muted-foreground/30 md:hidden" />
          <div className="flex items-center justify-between px-5">
            <h2 className="font-heading text-lg font-bold text-foreground">
              ¿Qué estás buscando?
            </h2>
            <button
              type="button"
              onClick={closeDrawer}
              className="h-8 w-8 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80 transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 space-y-5" inert={submitting || unresolved || restoring}>
          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">
              Título
            </label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ej: Busco técnico para lavadora"
              maxLength={100}
              className="w-full rounded-xl bg-background border border-input px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/20 transition-all"
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">
              Descripción{" "}
              <span className="text-muted-foreground/70 font-normal">
                (opcional)
              </span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe con más detalle lo que necesitas..."
              rows={3}
              maxLength={2000}
              className="w-full rounded-xl bg-background border border-input px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/20 transition-all resize-none"
            />
          </div>

          {/* Categories — multi-select (reusing product-form logic, no is_primary) */}
          <div className="space-y-1.5 relative">
            <div className="flex items-baseline justify-between gap-2">
              <label className="text-sm font-medium text-foreground/80">
                Categorías
              </label>
              <span className="text-xs text-muted-foreground/70">
                {categories.length}/3
              </span>
            </div>

            {/* Selected chips */}
            {categories.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {categories.map((cat) => (
                  <div
                    key={cat.slug}
                    className="inline-flex items-center gap-1 rounded-full bg-muted pl-3 pr-1 py-1 text-sm text-foreground/90"
                  >
                    <span>{cat.nombre}</span>
                    <button
                      type="button"
                      aria-label={`Quitar ${cat.nombre}`}
                      onClick={() =>
                        setCategories((prev) =>
                          prev.filter((c) => c.slug !== cat.slug)
                        )
                      }
                      className="inline-flex h-6 w-6 items-center justify-center rounded-full transition-colors hover:bg-destructive/15"
                    >
                      <X className="h-3 w-3" strokeWidth={2.5} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Combobox */}
            {categories.length < 3 && (
              <button
                type="button"
                onClick={() => setCategoryOpen(!categoryOpen)}
                className={cn(
                  "w-full flex items-center justify-between rounded-xl bg-background border border-input px-4 py-3 text-sm outline-none transition-all hover:border-foreground/30",
                  categoryOpen && "ring-2 ring-primary/20",
                  "text-muted-foreground/80"
                )}
              >
                {categories.length === 0
                  ? "Selecciona una categoría"
                  : "Agregar otra categoría"}
                <ChevronDown
                  className={cn(
                    "w-4 h-4 text-muted-foreground transition-transform",
                    categoryOpen && "rotate-180"
                  )}
                />
              </button>
            )}

            {/* Dropdown */}
            {categoryOpen && categories.length < 3 && (
              <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border border-border/50 bg-card shadow-lg max-h-64 overflow-hidden">
                <div className="p-2 border-b border-border/30">
                  <div className="flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5">
                    <Search className="w-3.5 h-3.5 text-muted-foreground" />
                    <input
                      type="text"
                      value={categorySearch}
                      onChange={(e) => setCategorySearch(e.target.value)}
                      placeholder="Buscar categoría..."
                      className="flex-1 bg-transparent text-xs outline-none placeholder:text-muted-foreground/50"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="overflow-y-auto max-h-48 p-1">
                  {["producto", "servicio", "otro"].map((type) => {
                    const label =
                      type === "producto"
                        ? "Productos"
                        : type === "servicio"
                          ? "Servicios"
                          : "Otros";
                    const cats = visibleCategories.filter(
                      (c) =>
                        c.type === type &&
                        !categories.some((sel) => sel.slug === c.slug) &&
                        // Mismo criterio que el formulario de publicar: se
                        // busca en el nombre Y en los ejemplos, porque quien
                        // pide algo tampoco escribe el nombre del cajon.
                        (c.name
                          .toLowerCase()
                          .includes(categorySearch.toLowerCase()) ||
                          c.ejemplos
                            .toLowerCase()
                            .includes(categorySearch.toLowerCase()))
                    );
                    if (cats.length === 0) return null;
                    return (
                      <div key={type}>
                        <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-3 py-1.5">
                          {label}
                        </p>
                        {cats.map((cat) => (
                          <button
                            key={cat.slug}
                            type="button"
                            onClick={() => {
                              setCategories((prev) => [
                                ...prev,
                                { slug: cat.slug, nombre: cat.name },
                              ]);
                              setCategoryOpen(false);
                              setCategorySearch("");
                            }}
                            className="w-full text-left px-3 py-2 rounded-lg transition-colors hover:bg-muted"
                          >
                            <span className="block text-sm">{cat.name}</span>
                            <span className="block text-[11px] text-muted-foreground truncate">
                              {cat.ejemplos}
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* Budget */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">
              Presupuesto estimado{" "}
              <span className="text-muted-foreground/70 font-normal">
                (opcional)
              </span>
            </label>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                $
              </span>
              <input
                type="number"
                inputMode="numeric"
                value={budget}
                onChange={(e) => setBudget(e.target.value)}
                placeholder="0"
                className="w-full rounded-xl bg-background border border-input pl-8 pr-16 py-3 text-sm text-foreground placeholder:text-muted-foreground/50 outline-none focus:ring-2 focus:ring-primary/20 transition-all"
              />
              <span className="absolute right-4 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">
                MXN
              </span>
            </div>
          </div>

          {/* Expiry */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80 inline-flex items-center gap-1.5">
              <Clock className="h-3.5 w-3.5" />
              Tiempo de vigencia
            </label>
            <div className="flex gap-2">
              {EXPIRY_OPTIONS.map((opt) => (
                <button
                  key={opt.hours}
                  type="button"
                  onClick={() => setExpiryHours(opt.hours)}
                  className={cn(
                    "flex-1 rounded-xl py-2.5 text-sm font-medium border transition-colors",
                    expiryHours === opt.hours
                      ? "bg-foreground text-background border-foreground"
                      : "bg-transparent text-muted-foreground border-border hover:border-foreground/30"
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Image */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-foreground/80">
              Foto de referencia{" "}
              <span className="text-muted-foreground/70 font-normal">
                (opcional)
              </span>
            </label>
            {imagePreview ? (
              <div className="relative w-24 h-24 rounded-xl overflow-hidden">
                <Image
                  width={96}
                  height={96}
                  unoptimized
                  src={imagePreview}
                  alt="Preview"
                  className="w-full h-full object-cover"
                />
                <button
                  type="button"
                  onClick={() => {
                    setImageFile(null);
                    setImagePreview(null);
                  }}
                  className="absolute top-1 right-1 h-6 w-6 rounded-full bg-black/60 flex items-center justify-center"
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              </div>
            ) : (
              <label className="flex h-20 w-20 cursor-pointer items-center justify-center rounded-xl border-2 border-dashed border-border hover:border-foreground/30 transition-colors">
                <ImagePlus className="h-6 w-6 text-muted-foreground" />
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Location indicator */}
          <div className="space-y-1.5 pt-2">
            <label className="text-sm font-medium text-foreground/80">
              Ubicación de la solicitud
            </label>
            {/* el radio de busqueda lo elige quien explora el feed; no es parte de la solicitud */}
            <DeliveryMap
              onLocationChange={(lat, lng, address) => setLocationData((p) => ({ ...p, lat, lng, address }))}
              onRadiusChange={() => {}}
            />
          </div>
        </div>

        {/* Fixed bottom — Submit button (outside scroll area) */}
        <div className="shrink-0 px-5 pt-3 pb-[calc(env(safe-area-inset-bottom)+1rem)] border-t border-border/30 bg-card md:rounded-b-3xl">
          {error && (
            <p className="text-sm text-destructive font-medium mb-2">{error}</p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || restoring}
            className="w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Publicando...
              </>
            ) : (
              unresolved ? "Confirmar publicación pendiente" : "Publicar solicitud"
            )}
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
