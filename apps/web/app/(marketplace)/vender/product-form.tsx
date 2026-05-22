"use client";

import { useState, useRef } from "react";
import dynamic from "next/dynamic";
import Image from "next/image";
import { CATEGORIES, DELIVERY_OPTIONS } from "@vicino/shared";

const DeliveryMap = dynamic(() => import("@/components/map/delivery-map"), { ssr: false });
import { createProduct } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Store, PackageOpen, CheckCircle2, ImagePlus, X, Search, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { generateVideoThumbnail } from "@/lib/video-thumbnail";

export function ProductForm() {
  const submittingRef = useRef(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tipoSeleccionado, setTipoSeleccionado] = useState<"producto" | "servicio">("producto");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [locationData, setLocationData] = useState({ lat: 0, lng: 0, address: "", radius: 5 });
  const [allowAppointments, setAllowAppointments] = useState(false);
  const [apptStart, setApptStart] = useState("09:00");
  const [apptEnd, setApptEnd] = useState("18:00");
  const [apptDuration, setApptDuration] = useState("60");
  const [media, setMedia] = useState<{ file: File; preview: string; isVideo: boolean }[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  // In-flight thumbnail generations, keyed by source File. The upload path
  // awaits the matching promise before deciding whether to upload a thumb,
  // so a fast submit during background generation no longer silently drops
  // the thumbnail. Resolved promises also stay cached so this is a no-op
  // wait when the work has already finished.
  const pendingThumbsRef = useRef<Map<File, Promise<Blob | null>>>(new Map());

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (media.length + files.length > 5) {
      setError("Máximo 5 archivos");
      return;
    }
    for (const f of files) {
      const isVid = f.type.startsWith("video/");
      if (isVid && f.size > 50 * 1024 * 1024) { setError(`${f.name} excede 50MB`); return; }
      if (!isVid && f.size > 5 * 1024 * 1024) { setError(`${f.name} excede 5MB`); return; }
    }
    setError("");
    const newMedia = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      isVideo: file.type.startsWith("video/"),
    }));
    setMedia((prev) => [...prev, ...newMedia]);

    // Kick off thumbnail generation in the background and stash the promise
    // in pendingThumbsRef so uploadMedia can await it before deciding to skip
    // the thumb. Best-effort: failure resolves to null (NOT a rejection) so a
    // user who never submits the form doesn't leave a cached rejected promise
    // in the Map — that would surface as an unhandledrejection warning even
    // though the thumbnail is intentionally optional.
    for (const item of newMedia) {
      if (!item.isVideo) continue;
      const promise: Promise<Blob | null> = generateVideoThumbnail(item.file).catch((err) => {
        // Diagnostic only — user-facing display already has a fallback path.
        console.warn("video thumbnail generation failed", item.file.name, err);
        return null;
      });
      pendingThumbsRef.current.set(item.file, promise);
    }
  }

  function removeMedia(index: number) {
    setMedia((prev) => {
      const item = prev[index];
      if (item) {
        URL.revokeObjectURL(item.preview);
        pendingThumbsRef.current.delete(item.file);
      }
      return prev.filter((_, i) => i !== index);
    });
  }

  async function uploadMedia(): Promise<string[]> {
    if (media.length === 0) return [];
    setUploading(true);
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const userId = user?.id ?? "anon";
    const urls: string[] = [];
    const timestamp = Date.now();
    for (let i = 0; i < media.length; i++) {
      const img = media[i]!;
      const ext = img.file.name.split(".").pop() ?? "jpg";
      const path = `${userId}/${timestamp}-${i}.${ext}`;
      const { error: uploadErr } = await supabase.storage
        .from("product-media")
        .upload(path, img.file);
      if (uploadErr) {
        setUploading(false);
        throw new Error(`Error subiendo imagen ${i + 1}: ${uploadErr.message}`);
      }
      const { data: urlData } = supabase.storage
        .from("product-media")
        .getPublicUrl(path);
      urls.push(urlData.publicUrl);

      // Best-effort thumbnail upload for videos. Path mirrors the
      // derivedThumbnailUrl convention in lib/video-thumbnail.ts so the
      // gallery can resolve thumbs without a DB lookup. We await any
      // pending background generation here so a fast submit (before the
      // canvas decode finishes) still ships the thumbnail when it
      // ultimately resolves. A failure (rejection or upload error) is
      // logged but does not abort the product upload — display falls
      // back to <video #t=0.1> for missing thumbs.
      if (img.isVideo) {
        const pending = pendingThumbsRef.current.get(img.file);
        let thumbBlob: Blob | null = null;
        if (pending) {
          // Race the pending generation against an 8s timeout. Canvas decode
          // typically completes in <1s; 4K sources take ~2-3s. 8s is safe
          // margin while bailing on hangs (e.g., WebView legacy Android,
          // corrupted source, codecs that never fire loadeddata/seeked).
          // Since thumbnails are best-effort, blocking submission is worse
          // than skipping the thumb — display falls back to <video #t=0.1>.
          const THUMB_GENERATION_TIMEOUT_MS = 8000;
          try {
            thumbBlob = await Promise.race([
              pending,
              new Promise<never>((_, reject) =>
                setTimeout(
                  () => reject(new Error("thumbnail generation timed out")),
                  THUMB_GENERATION_TIMEOUT_MS,
                ),
              ),
            ]);
          } catch {
            // Either generation rejected or timed out — proceed without thumb.
          }
        }
        if (thumbBlob) {
          const thumbPath = `${userId}/${timestamp}-${i}_thumb.jpg`;
          const { error: thumbErr } = await supabase.storage
            .from("product-media")
            .upload(thumbPath, thumbBlob, { contentType: "image/jpeg" });
          if (thumbErr) {
            // Diagnostic only — product upload already succeeded.
            console.warn(`thumbnail upload failed for video ${i + 1}: ${thumbErr.message}`);
          }
        }
      }
    }
    setUploading(false);
    return urls;
  }

  async function handleSubmit(formData: FormData) {
    if (submittingRef.current) return;
    submittingRef.current = true;
    setError("");
    setLoading(true);
    try {
      const urls = await uploadMedia();
      if (urls.length > 0 && urls[0]) {
        formData.set("imagen_principal", urls[0]);
        formData.set("galeria_imagenes", JSON.stringify(urls));
      }
      const result = await createProduct(formData);
      if (result?.error) {
        setError(result.error);
        setLoading(false);
        submittingRef.current = false;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir imágenes");
      setLoading(false);
      submittingRef.current = false;
    }
  }

  return (
    <form action={handleSubmit} className="space-y-6 animate-scale-in">
      {error && (
        <div className="rounded-xl bg-[rgba(255,59,48,0.10)] p-4 text-sm text-[color:var(--danger)] shadow-[inset_0_0_0_1px_rgba(255,59,48,0.30)]">
          <p className="flex items-center gap-2 font-semibold">
            <span className="text-lg">⚠️</span> {error}
          </p>
        </div>
      )}

      {/* Tipo Toggle Buttons */}
      <div className="space-y-3 pb-4 border-b border-border/40">
        <label className="text-sm font-semibold tracking-wide uppercase text-muted-foreground/80">¿Qué tipo de publicación es?</label>
        <div className="grid grid-cols-2 gap-3">
          <label className="group relative cursor-pointer">
            <input
              type="radio"
              name="tipo"
              value="producto"
              checked={tipoSeleccionado === "producto"}
              onChange={() => setTipoSeleccionado("producto")}
              className="peer sr-only"
            />
            <div className={cn(
              "flex flex-col items-center justify-center rounded-2xl p-4 transition-all duration-200",
              tipoSeleccionado === "producto"
                ? "bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                : "bg-[color:var(--card)] text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)] group-hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            )}>
              <PackageOpen className={cn("mb-2 h-6 w-6 transition-colors", tipoSeleccionado === "producto" ? "text-[color:var(--brand-hi)]" : "text-[color:var(--fg-muted)] group-hover:text-[color:var(--brand-hi)]")} />
              <span className="text-sm font-semibold">Producto físico</span>
            </div>
            {tipoSeleccionado === "producto" && (
              <div className="absolute right-3 top-3 text-[color:var(--brand-hi)]">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            )}
          </label>

          <label className="group relative cursor-pointer">
            <input
              type="radio"
              name="tipo"
              value="servicio"
              checked={tipoSeleccionado === "servicio"}
              onChange={() => setTipoSeleccionado("servicio")}
              className="peer sr-only"
            />
            <div className={cn(
              "flex flex-col items-center justify-center rounded-2xl p-4 transition-all duration-200",
              tipoSeleccionado === "servicio"
                ? "bg-[color:var(--brand-tint)] text-[color:var(--brand-hi)] shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
                : "bg-[color:var(--card)] text-[color:var(--fg-muted)] shadow-[inset_0_0_0_1px_var(--border)] group-hover:shadow-[inset_0_0_0_1px_var(--brand-tint-strong)]"
            )}>
              <Store className={cn("mb-2 h-6 w-6 transition-colors", tipoSeleccionado === "servicio" ? "text-[color:var(--brand-hi)]" : "text-[color:var(--fg-muted)] group-hover:text-[color:var(--brand-hi)]")} />
              <span className="text-sm font-semibold">Servicio local</span>
            </div>
            {tipoSeleccionado === "servicio" && (
              <div className="absolute right-3 top-3 text-[color:var(--brand-hi)]">
                <CheckCircle2 className="h-4 w-4" />
              </div>
            )}
          </label>
        </div>
      </div>

      {/* Appointment config — services only */}
      {tipoSeleccionado === "servicio" && (
        <div className="space-y-4 p-4 rounded-2xl border border-border/50 bg-card">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-foreground">Permitir agendar citas</p>
              <p className="text-xs text-muted-foreground mt-0.5">Los compradores podrán reservar horarios</p>
            </div>
            <button
              type="button"
              onClick={() => setAllowAppointments(!allowAppointments)}
              className={`relative h-6 w-11 rounded-full transition-colors ${
                allowAppointments
                  ? "bg-[color:var(--brand)] shadow-[var(--shadow-glow)]"
                  : "bg-[color:var(--bg-elev-2)] shadow-[inset_0_0_0_1px_var(--border)]"
              }`}
              aria-pressed={allowAppointments}
            >
              <span
                className={`absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                  allowAppointments ? "translate-x-5" : ""
                }`}
              />
            </button>
          </div>
          <input type="hidden" name="allow_appointments" value={allowAppointments ? "true" : "false"} />

          {allowAppointments && (
            <div className="space-y-3 pt-3 border-t border-border/30">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Mis citas empiezan a las:</label>
                  <select name="appointment_start_time" value={apptStart} onChange={(e) => setApptStart(e.target.value)}
                    className="w-full bg-muted rounded-xl px-4 py-3 text-sm text-foreground border-0 outline-none appearance-none">
                    {Array.from({ length: 48 }, (_, i) => {
                      const h = Math.floor(i / 2);
                      const m = i % 2 === 0 ? "00" : "30";
                      const v = `${String(h).padStart(2, "0")}:${m}`;
                      const p = h >= 12 ? "p.m." : "a.m.";
                      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                      return <option key={v} value={v}>{h12}:{m} {p}</option>;
                    })}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Termino de atender a las:</label>
                  <select name="appointment_end_time" value={apptEnd} onChange={(e) => setApptEnd(e.target.value)}
                    className="w-full bg-muted rounded-xl px-4 py-3 text-sm text-foreground border-0 outline-none appearance-none">
                    {Array.from({ length: 48 }, (_, i) => {
                      const h = Math.floor(i / 2);
                      const m = i % 2 === 0 ? "00" : "30";
                      const v = `${String(h).padStart(2, "0")}:${m}`;
                      const p = h >= 12 ? "p.m." : "a.m.";
                      const h12 = h === 0 ? 12 : h > 12 ? h - 12 : h;
                      return <option key={v} value={v}>{h12}:{m} {p}</option>;
                    })}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Cada cita dura:</label>
                <select name="appointment_duration_minutes" value={apptDuration} onChange={(e) => setApptDuration(e.target.value)}
                  className="w-full bg-muted rounded-xl px-4 py-3 text-sm text-foreground border-0 outline-none appearance-none">
                  <option value="30">30 minutos</option>
                  <option value="45">45 minutos</option>
                  <option value="60">1 hora</option>
                  <option value="90">1.5 horas</option>
                  <option value="120">2 horas</option>
                  <option value="240">4 horas</option>
                </select>
              </div>
            </div>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pb-2">
        {/* Titulo */}
        <div className="space-y-2 md:col-span-2">
          <label htmlFor="titulo" className="text-sm font-medium text-foreground/80">
            Título de la publicación
          </label>
          <input
            id="titulo"
            name="titulo"
            type="text"
            required
            minLength={3}
            maxLength={120}
            placeholder={tipoSeleccionado === "producto" ? "Ej: iPhone 13 Pro Max - Como nuevo" : "Ej: Clases de regularización de matemáticas"}
            className="w-full rounded-xl border border-border/50 bg-muted px-4 py-3 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/20 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Precio */}
        <div className="space-y-2">
          <label htmlFor="precio" className="text-sm font-medium text-foreground/80">
            Precio <span className="text-muted-foreground font-normal">(MXN)</span>
          </label>
          <div className="relative">
            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-muted-foreground font-medium">$</span>
            <input
              id="precio"
              name="precio"
              type="number"
              required
              min={1}
              max={999999}
              step="0.01"
              placeholder="0.00"
              className="w-full rounded-xl border border-border/50 bg-card pl-8 pr-4 py-3 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/20 tabular-nums font-heading font-medium"
            />
          </div>
        </div>

        {/* Categoria — combobox con búsqueda */}
        <div className="space-y-2 relative">
          <label className="text-sm font-medium text-foreground/80">Categoría</label>
          <input type="hidden" name="categoria" value={selectedCategory} required />
          <button
            type="button"
            onClick={() => setCategoryOpen(!categoryOpen)}
            className={cn(
              "w-full flex items-center justify-between rounded-xl border border-border/50 bg-muted px-4 py-3 text-sm outline-none transition-all hover:border-primary/30",
              categoryOpen && "border-primary/50 ring-2 ring-primary/20",
              !selectedCategory && "text-muted-foreground/50"
            )}
          >
            {selectedCategory ? CATEGORIES.find(c => c.slug === selectedCategory)?.name : "Selecciona una categoría"}
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", categoryOpen && "rotate-180")} />
          </button>
          {categoryOpen && (
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
                  const label = type === "producto" ? "Productos" : type === "servicio" ? "Servicios" : "Otros";
                  const cats = CATEGORIES.filter(c => c.type === type && c.name.toLowerCase().includes(categorySearch.toLowerCase()));
                  if (cats.length === 0) return null;
                  return (
                    <div key={type}>
                      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 px-3 py-1.5">{label}</p>
                      {cats.map(cat => (
                        <button
                          key={cat.slug}
                          type="button"
                          onClick={() => { setSelectedCategory(cat.slug); setCategoryOpen(false); setCategorySearch(""); }}
                          className={cn(
                            "w-full text-left px-3 py-2 text-sm rounded-lg transition-colors",
                            selectedCategory === cat.slug ? "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)] font-semibold" : "hover:bg-[color:var(--bg-elev-2)]"
                          )}
                        >
                          {cat.name}
                        </button>
                      ))}
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Descripcion */}
      <div className="space-y-2">
        <label htmlFor="descripcion" className="text-sm font-medium text-foreground/80">
          Descripción detallada
        </label>
        <textarea
          id="descripcion"
          name="descripcion"
          required
          minLength={10}
          maxLength={5000}
          rows={5}
          placeholder="Describe los detalles, condición, medidas, o lo que incluye tu servicio..."
          className="w-full rounded-xl border border-border/50 bg-muted px-4 py-3 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/20 resize-y placeholder:text-muted-foreground/50"
        />
      </div>

      {/* Ubicación con mapa */}
      <div className="space-y-2 pt-2">
        <label className="text-sm font-medium text-foreground/80">
          Zona de entrega / operación <span className="text-muted-foreground font-normal">(opcional)</span>
        </label>
        <input type="hidden" name="ubicacion" value={locationData.address} />
        <input type="hidden" name="ubicacion_lat" value={locationData.lat || ""} />
        <input type="hidden" name="ubicacion_lng" value={locationData.lng || ""} />
        <input type="hidden" name="delivery_radius_km" value={locationData.radius} />
        <DeliveryMap
          onLocationChange={(lat, lng, address) => setLocationData((p) => ({ ...p, lat, lng, address }))}
          onRadiusChange={(radius) => setLocationData((p) => ({ ...p, radius }))}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 pb-4">

        {/* Tipo de entrega */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/80">Opciones de entrega</label>
          <select
            name="tipo_entrega"
            defaultValue="punto_encuentro"
            className="w-full rounded-xl border border-border/50 bg-muted px-4 py-3 text-sm outline-none transition-all focus:border-primary/50 focus:ring-2 focus:ring-primary/20 appearance-none"
            style={{ backgroundImage: `url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23666666%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7em top 50%', backgroundSize: '.65em auto' }}
          >
            {DELIVERY_OPTIONS
              .filter(o => (o.for as readonly string[]).includes(tipoSeleccionado))
              .map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))
            }
          </select>
        </div>
      </div>

      {/* Media Upload */}
      <div className="space-y-3 pt-2">
        <label className="text-sm font-medium text-foreground/80">
          Fotos y videos <span className="text-muted-foreground font-normal">(máx. 5, primera será la portada)</span>
        </label>
        <div className="flex gap-2 flex-wrap">
          {media.map((item, i) => (
            <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-border/50 group">
              {item.isVideo ? (
                <video src={item.preview} className="w-full h-full object-cover" />
              ) : (
                <Image src={item.preview} alt={`Preview ${i + 1}`} fill className="object-cover" />
              )}
              <button
                type="button"
                onClick={() => removeMedia(i)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>
              {i === 0 && (
                <span className="absolute bottom-0.5 left-0.5 rounded bg-[color:var(--brand)] px-1 text-[9px] font-medium text-white">
                  Portada
                </span>
              )}
              {item.isVideo && (
                <span className="absolute bottom-0.5 right-0.5 text-[9px] bg-black/70 text-white px-1 rounded font-medium">
                  Video
                </span>
              )}
            </div>
          ))}
          {media.length < 5 && (
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="w-20 h-20 rounded-xl border-2 border-dashed border-border/50 flex flex-col items-center justify-center text-muted-foreground hover:border-primary/40 hover:text-primary transition-colors"
            >
              <ImagePlus className="w-5 h-5" />
              <span className="text-[10px] mt-0.5">Agregar</span>
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,video/mp4,video/webm,video/quicktime"
          multiple
          className="hidden"
          onChange={handleImageSelect}
        />
      </div>

      <button
        type="submit"
        disabled={loading || uploading}
        className="sticky bottom-20 z-10 flex w-full items-center justify-center gap-2 rounded-xl bg-[color:var(--brand)] px-4 py-4 text-base font-semibold text-white shadow-[var(--shadow-glow)] transition-all duration-200 hover:bg-[color:var(--brand-dark)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 md:bottom-4"
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          "Publicar ahora"
        )}
      </button>
    </form>
  );
}
