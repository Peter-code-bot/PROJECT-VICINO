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

export function ProductForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tipoSeleccionado, setTipoSeleccionado] = useState<"producto" | "servicio">("producto");
  const [selectedCategory, setSelectedCategory] = useState("");
  const [categorySearch, setCategorySearch] = useState("");
  const [categoryOpen, setCategoryOpen] = useState(false);
  const [locationData, setLocationData] = useState({ lat: 0, lng: 0, address: "", radius: 5 });
  const [media, setMedia] = useState<{ file: File; preview: string; isVideo: boolean }[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
  }

  function removeMedia(index: number) {
    setMedia((prev) => {
      const item = prev[index];
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function uploadMedia(): Promise<string[]> {
    if (media.length === 0) return [];
    setUploading(true);
    const supabase = createClient();
    const urls: string[] = [];
    const timestamp = Date.now();
    for (let i = 0; i < media.length; i++) {
      const img = media[i]!;
      const ext = img.file.name.split(".").pop() ?? "jpg";
      const path = `temp/${timestamp}-${i}.${ext}`;
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
    }
    setUploading(false);
    return urls;
  }

  async function handleSubmit(formData: FormData) {
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
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Error al subir imágenes");
      setLoading(false);
    }
  }

  return (
    <form action={handleSubmit} className="space-y-6 animate-scale-in">
      {error && (
        <div className="rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-950/20 p-4 text-sm text-red-600 dark:text-red-400">
          <p className="font-semibold flex items-center gap-2">
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
              "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all duration-200 bg-white dark:bg-neutral-900 group-hover:border-terracotta/40",
              tipoSeleccionado === "producto" ? "border-terracotta shadow-sm bg-terracotta/5 text-terracotta" : "border-border/50 text-muted-foreground"
            )}>
              <PackageOpen className={cn("w-6 h-6 mb-2 transition-colors", tipoSeleccionado === "producto" ? "text-terracotta" : "text-muted-foreground group-hover:text-terracotta/70")} />
              <span className="font-semibold text-sm">Producto físico</span>
            </div>
            {tipoSeleccionado === "producto" && (
              <div className="absolute top-3 right-3 text-terracotta">
                <CheckCircle2 className="w-4 h-4" />
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
              "flex flex-col items-center justify-center p-4 rounded-2xl border-2 transition-all duration-200 bg-white dark:bg-neutral-900 group-hover:border-terracotta/40",
              tipoSeleccionado === "servicio" ? "border-terracotta shadow-sm bg-terracotta/5 text-terracotta" : "border-border/50 text-muted-foreground"
            )}>
              <Store className={cn("w-6 h-6 mb-2 transition-colors", tipoSeleccionado === "servicio" ? "text-terracotta" : "text-muted-foreground group-hover:text-terracotta/70")} />
              <span className="font-semibold text-sm">Servicio local</span>
            </div>
            {tipoSeleccionado === "servicio" && (
              <div className="absolute top-3 right-3 text-terracotta">
                <CheckCircle2 className="w-4 h-4" />
              </div>
            )}
          </label>
        </div>
      </div>

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
            className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 placeholder:text-muted-foreground/50"
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
              className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 pl-8 pr-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 tabular-nums font-heading font-medium"
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
              "w-full flex items-center justify-between rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all hover:border-terracotta/30",
              categoryOpen && "border-terracotta/50 ring-2 ring-terracotta/20",
              !selectedCategory && "text-muted-foreground/50"
            )}
          >
            {selectedCategory ? CATEGORIES.find(c => c.slug === selectedCategory)?.name : "Selecciona una categoría"}
            <ChevronDown className={cn("w-4 h-4 text-muted-foreground transition-transform", categoryOpen && "rotate-180")} />
          </button>
          {categoryOpen && (
            <div className="absolute z-50 top-full left-0 right-0 mt-1 rounded-xl border border-border/50 bg-white dark:bg-neutral-900 shadow-lg max-h-64 overflow-hidden">
              <div className="p-2 border-b border-border/30">
                <div className="flex items-center gap-2 rounded-lg bg-neutral-50 dark:bg-neutral-800 px-3 py-1.5">
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
                            selectedCategory === cat.slug ? "bg-terracotta/10 text-terracotta font-medium" : "hover:bg-neutral-50 dark:hover:bg-neutral-800"
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
          className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 resize-y placeholder:text-muted-foreground/50"
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
            className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 appearance-none"
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
                <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-terracotta text-white px-1 rounded font-medium">
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
              className="w-20 h-20 rounded-xl border-2 border-dashed border-border/50 flex flex-col items-center justify-center text-muted-foreground hover:border-terracotta/40 hover:text-terracotta transition-colors"
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
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-bone px-4 py-4 text-base font-semibold text-bone-contrast shadow-sm transition-all duration-200 hover:bg-bone-dark hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none sticky bottom-20 md:bottom-4 z-10"
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
