"use client";

import { useState, useRef } from "react";
import Image from "next/image";
import { CATEGORIES } from "@vicino/shared";
import { createProduct } from "./actions";
import { Loader2, Store, PackageOpen, CheckCircle2, Camera, X } from "lucide-react";
import { cn } from "@/lib/utils";

export function ProductForm() {
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [tipoSeleccionado, setTipoSeleccionado] = useState<"producto" | "servicio">("producto");
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleImageChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    setImagePreview(url);
  }

  function clearImage() {
    setImagePreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  async function handleSubmit(formData: FormData) {
    setError("");
    setLoading(true);
    const result = await createProduct(formData);
    if (result?.error) {
      setError(result.error);
      setLoading(false);
    }
    // redirect is handled in action on success
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
            className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 appearance-none"
            style={{ backgroundImage: `url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23666666%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7em top 50%', backgroundSize: '.65em auto' }}
          >
            <option value="" disabled selected hidden>Selecciona una categoría</option>
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
            className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 appearance-none"
            style={{ backgroundImage: `url('data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23666666%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E')`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right .7em top 50%', backgroundSize: '.65em auto' }}
          >
            <option value="pickup">Punto de encuentro seguro</option>
            <option value="envio">Ofrezco envío local</option>
            <option value="ambos">Punto de encuentro o Envío</option>
          </select>
        </div>
      </div>

      {/* Imagen principal */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground/80">
          Foto del producto{" "}
          <span className="text-muted-foreground font-normal">(opcional)</span>
        </label>

        {imagePreview ? (
          <div className="relative aspect-[4/3] w-full max-w-xs rounded-2xl overflow-hidden border border-border/40">
            <Image
              src={imagePreview}
              alt="Vista previa"
              fill
              className="object-cover"
            />
            <button
              type="button"
              onClick={clearImage}
              className="absolute top-2 right-2 w-8 h-8 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center text-white hover:bg-black/80 transition-colors"
              aria-label="Quitar imagen"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <label
            htmlFor="imagen_principal"
            className="flex flex-col items-center justify-center w-full max-w-xs aspect-[4/3] rounded-2xl border-2 border-dashed border-border/50 hover:border-terracotta/40 hover:bg-terracotta/3 cursor-pointer transition-all duration-200 group"
          >
            <Camera className="w-8 h-8 text-muted-foreground/50 group-hover:text-terracotta/60 mb-2 transition-colors" />
            <span className="text-sm font-medium text-muted-foreground group-hover:text-terracotta/80 transition-colors">
              Agregar foto
            </span>
            <span className="text-xs text-muted-foreground/60 mt-0.5">
              JPG, PNG o WebP · Máx 20 MB
            </span>
          </label>
        )}

        <input
          ref={fileInputRef}
          id="imagen_principal"
          name="imagen_principal"
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleImageChange}
          className="sr-only"
        />
      </div>

      <button
        type="submit"
        disabled={loading}
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
