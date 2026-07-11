"use client";

import { useState, useEffect } from "react";
import { createClient } from "@/lib/supabase/client";
import { CATEGORIES } from "@vicino/shared";
import {
  X,
  Search,
  ChevronDown,
  ImagePlus,
  Clock,
  Loader2,
} from "lucide-react";
import { cn } from "@/lib/utils";

interface CreateRequestDrawerProps {
  onClose: () => void;
  onCreated: () => void;
  userLat: number | null;
  userLng: number | null;
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

export function CreateRequestDrawer({
  onClose,
  onCreated,
  userLat,
  userLng,
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
  const [error, setError] = useState<string | null>(null);

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setImageFile(file);
      const reader = new FileReader();
      reader.onload = () => setImagePreview(reader.result as string);
      reader.readAsDataURL(file);
    }
  };

  const handleSubmit = async () => {
    setError(null);

    if (!title.trim()) {
      setError("Escribe qué estás buscando");
      return;
    }
    if (categories.length === 0) {
      setError("Selecciona al menos una categoría");
      return;
    }
    if (userLat === null || userLng === null) {
      setError("Activa tu ubicación para publicar una solicitud");
      return;
    }

    setSubmitting(true);

    try {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setError("Inicia sesión para publicar");
        setSubmitting(false);
        return;
      }

      // Upload image if provided
      let imageUrl: string | null = null;
      if (imageFile) {
        const ext = imageFile.name.split(".").pop();
        const filePath = `solicitudes/${user.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("media")
          .upload(filePath, imageFile, { contentType: imageFile.type });
        if (!uploadError) {
          const { data: urlData } = supabase.storage
            .from("media")
            .getPublicUrl(filePath);
          imageUrl = urlData?.publicUrl ?? null;
        }
      }

      // Calculate expiration
      const expiresAt = new Date(
        Date.now() + expiryHours * 60 * 60 * 1000
      ).toISOString();

      // Insert purchase request
      const { data: newRequest, error: insertError } = await supabase
        .from("purchase_requests")
        .insert({
          buyer_id: user.id,
          title: title.trim(),
          description: description.trim() || null,
          budget_estimated: budget ? parseFloat(budget) : null,
          image_url: imageUrl,
          ubicacion_geo: `POINT(${userLng} ${userLat})`,
          expires_at: expiresAt,
        })
        .select("id")
        .single();

      if (insertError) {
        setError("Error al publicar. Intenta de nuevo.");
        setSubmitting(false);
        return;
      }

      // Insert categories into pivot table
      if (newRequest) {
        // Fetch category IDs by slug
        const { data: catRows } = await supabase
          .from("categories")
          .select("id, slug")
          .in(
            "slug",
            categories.map((c) => c.slug)
          );

        if (catRows && catRows.length > 0) {
          await supabase.from("purchase_request_categories").insert(
            catRows.map((cat) => ({
              request_id: newRequest.id,
              categoria_id: cat.id,
            }))
          );
        }
      }

      onCreated();
    } catch {
      setError("Error inesperado. Intenta de nuevo.");
    } finally {
      setSubmitting(false);
    }
  };

  const visibleCategories = CATEGORIES.filter((c) => !c.hidden_in_form);

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Drawer */}
      <div className="relative w-full max-w-lg rounded-t-3xl bg-card border-t border-border/50 shadow-2xl animate-slide-up max-h-[90vh] overflow-y-auto">
        {/* Handle */}
        <div className="sticky top-0 z-10 bg-card rounded-t-3xl">
          <div className="mx-auto mt-3 mb-2 h-1 w-10 rounded-full bg-muted-foreground/30" />
          <div className="flex items-center justify-between px-5 pb-3">
            <h2 className="font-heading text-lg font-bold text-foreground">
              ¿Qué estás buscando?
            </h2>
            <button
              type="button"
              onClick={onClose}
              className="h-8 w-8 rounded-full flex items-center justify-center bg-muted hover:bg-muted/80 transition-colors"
            >
              <X className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
        </div>

        <div className="px-5 pb-8 space-y-5">
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
                        c.name
                          .toLowerCase()
                          .includes(categorySearch.toLowerCase())
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
                            className="w-full text-left px-3 py-2 text-sm rounded-lg transition-colors hover:bg-muted"
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
                <img
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
                  accept="image/*"
                  onChange={handleImageSelect}
                  className="hidden"
                />
              </label>
            )}
          </div>

          {/* Error */}
          {error && (
            <p className="text-sm text-destructive font-medium">{error}</p>
          )}

          {/* Submit */}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting}
            className="w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Publicando...
              </>
            ) : (
              "Publicar solicitud"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
