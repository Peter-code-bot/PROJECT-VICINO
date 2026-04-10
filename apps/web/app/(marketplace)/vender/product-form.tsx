"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { CATEGORIES } from "@vicino/shared";
import { createProduct } from "./actions";
import { createClient } from "@/lib/supabase/client";
import { Loader2, Store, PackageOpen, CheckCircle2, ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProductForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tipoSeleccionado, setTipoSeleccionado] = useState<"producto" | "servicio">("producto");
  const [images, setImages] = useState<{ file: File; preview: string }[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  async function handleImageSelect(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    if (images.length + files.length > 5) {
      setError("Máximo 5 imágenes");
      return;
    }
    const newImages = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
    }));
    setImages((prev) => [...prev, ...newImages]);
    setError("");
  }

  function removeImage(index: number) {
    setImages((prev) => {
      const item = prev[index];
      if (item) URL.revokeObjectURL(item.preview);
      return prev.filter((_, i) => i !== index);
    });
  }

  async function uploadImages(): Promise<string[]> {
    if (images.length === 0) return [];
    setUploading(true);
    const supabase = createClient();
    const urls: string[] = [];
    const timestamp = Date.now();
    for (let i = 0; i < images.length; i++) {
      const img = images[i]!;
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
      const urls = await uploadImages();
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

        {/* Categoria */}
        <div className="space-y-2">
          <label htmlFor="categoria" className="text-sm font-medium text-foreground/80">
            Categoría
          </label>
          <select
            id="categoria"
            name="categoria"
            required
            defaultValue=""
            className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 appearance-none"
            style={{ backgroundImage: `url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23666666%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7em top 50%', backgroundSize: '.65em auto' }}
          >
            <option value="" disabled hidden>Selecciona una categoría</option>
            {CATEGORIES.map((cat) => (
              <option key={cat.id} value={cat.slug}>
                {cat.name}
              </option>
            ))}
          </select>
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-2 pb-4">
        {/* Ubicacion */}
        <div className="space-y-2">
          <label htmlFor="ubicacion" className="text-sm font-medium text-foreground/80">
            Zona de entrega / operación <span className="text-muted-foreground font-normal">(opcional)</span>
          </label>
          <input
            id="ubicacion"
            name="ubicacion"
            type="text"
            placeholder="Ej: Col. Roma Sur y Centro"
            className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 placeholder:text-muted-foreground/50"
          />
        </div>

        {/* Tipo de entrega */}
        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/80">Opciones de entrega</label>
          <select
            name="tipo_entrega"
            defaultValue="pickup"
            className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 appearance-none"
            style={{ backgroundImage: `url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23666666%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7em top 50%', backgroundSize: '.65em auto' }}
          >
            <option value="pickup">Punto de encuentro seguro</option>
            <option value="envio">Ofrezco envío local</option>
            <option value="ambos">Punto de encuentro o Envío</option>
          </select>
        </div>
      </div>

      {/* Image Upload */}
      <div className="space-y-3 pt-2">
        <label className="text-sm font-medium text-foreground/80">
          Fotos <span className="text-muted-foreground font-normal">(máx. 5, primera será la portada)</span>
        </label>
        <div className="flex gap-2 flex-wrap">
          {images.map((img, i) => (
            <div key={i} className="relative w-20 h-20 rounded-xl overflow-hidden border border-border/50 group">
              <Image src={img.preview} alt={`Preview ${i + 1}`} fill className="object-cover" />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3 text-white" />
              </button>
              {i === 0 && (
                <span className="absolute bottom-0.5 left-0.5 text-[9px] bg-terracotta text-white px-1 rounded font-medium">
                  Portada
                </span>
              )}
            </div>
          ))}
          {images.length < 5 && (
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
          accept="image/jpeg,image/png,image/webp"
          multiple
          className="hidden"
          onChange={handleImageSelect}
        />
      </div>

      <button
        type="submit"
        disabled={loading || uploading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-terracotta px-4 py-4 text-base font-semibold text-white shadow-sm transition-all duration-200 hover:bg-terracotta-dark hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none sticky bottom-20 md:bottom-4 z-10"
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
