"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { LogoutButton } from "@/components/shared/logout-button";
import { updateProfile } from "./actions";
import { Loader2, ShieldAlert, CheckCircle2 } from "lucide-react";

interface ProfileFormProps {
  profile: {
    nombre: string;
    email: string;
    foto: string | null;
    bio: string | null;
    ubicacion: string | null;
    es_vendedor: boolean;
    nombre_negocio: string | null;
    descripcion_negocio: string | null;
    metodos_pago_aceptados: string | null;
    trust_level: string;
    user_id: string | null;
  } | null;
}

export function ProfileForm({ profile }: ProfileFormProps) {
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const [esVendedor, setEsVendedor] = useState(profile?.es_vendedor ?? false);
  const router = useRouter();

  async function handleSubmit(formData: FormData) {
    setError("");
    setSuccess(false);
    setLoading(true);

    const result = await updateProfile(formData);
    if (result?.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      router.refresh();
      // Auto hide success message
      setTimeout(() => setSuccess(false), 3000);
    }
    setLoading(false);
  }

  return (
    <>
    <form action={handleSubmit} className="space-y-6">
      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-950/20 p-4 text-sm text-red-600 dark:text-red-400 animate-fade-in">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-3 rounded-xl border border-green-200/50 bg-green-50/50 dark:bg-green-950/20 p-4 text-sm text-green-700 dark:text-green-400 animate-fade-in">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <p>Tu perfil se ha actualizado correctamente.</p>
        </div>
      )}

      {/* Basic Info Section */}
      <div className="space-y-4 p-5 rounded-3xl bg-card border border-border/40 shadow-sm animate-scale-in">
        <div className="flex items-center justify-between pb-2 border-b border-border/40">
          <h2 className="font-heading font-semibold text-lg">Información Personal</h2>
          <span className="text-xs font-mono text-muted-foreground bg-neutral-100 dark:bg-neutral-800 px-2 py-1 rounded-md">
            ID: {profile?.user_id?.split('-')[0] ?? "—"}
          </span>
        </div>

        <div className="space-y-2">
          <label htmlFor="nombre" className="text-sm font-medium text-foreground/80">
            Nombre completo
          </label>
          <input
            id="nombre"
            name="nombre"
            type="text"
            required
            defaultValue={profile?.nombre ?? ""}
            className="w-full rounded-xl border border-border/50 bg-white/50 dark:bg-neutral-900/50 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20"
          />
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium text-foreground/80">
            Correo electrónico
          </label>
          <input
            type="email"
            disabled
            value={profile?.email ?? ""}
            className="w-full rounded-xl border border-border/30 bg-neutral-50 dark:bg-neutral-900/80 px-4 py-3 text-sm text-muted-foreground outline-none cursor-not-allowed opacity-80"
          />
          <p className="text-[11px] text-muted-foreground/70 ml-1">Tu email no se puede cambiar.</p>
        </div>

        <div className="space-y-2">
          <label htmlFor="foto" className="text-sm font-medium text-foreground/80">
            URL de foto de perfil <span className="text-muted-foreground font-normal">(opcional)</span>
          </label>
          <input
            id="foto"
            name="foto"
            type="url"
            defaultValue={profile?.foto ?? ""}
            placeholder="https://..."
            className="w-full rounded-xl border border-border/50 bg-white/50 dark:bg-neutral-900/50 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="bio" className="text-sm font-medium text-foreground/80">
            Bio <span className="text-muted-foreground font-normal">(opcional)</span>
          </label>
          <textarea
            id="bio"
            name="bio"
            rows={3}
            defaultValue={profile?.bio ?? ""}
            placeholder="Cuéntanos un poco sobre ti..."
            className="w-full rounded-xl border border-border/50 bg-white/50 dark:bg-neutral-900/50 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 resize-y"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="ubicacion" className="text-sm font-medium text-foreground/80">
            Ubicación principal <span className="text-muted-foreground font-normal">(opcional)</span>
          </label>
          <input
            id="ubicacion"
            name="ubicacion"
            type="text"
            defaultValue={profile?.ubicacion ?? ""}
            placeholder="Ej: Col. Roma, CDMX"
            className="w-full rounded-xl border border-border/50 bg-white/50 dark:bg-neutral-900/50 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20"
          />
        </div>
      </div>

      {/* Seller Section */}
      <div className={`p-5 rounded-3xl border transition-all duration-300 stagger ${
        esVendedor 
          ? "bg-terracotta/5 border-terracotta/20 shadow-sm" 
          : "bg-card border-border/40"
      }`}>
        <label className="flex items-start gap-4 cursor-pointer group mb-1">
          <div className="relative flex items-center justify-center mt-1 w-5 h-5 shrink-0">
            <input
              type="checkbox"
              name="es_vendedor"
              checked={esVendedor}
              onChange={(e) => setEsVendedor(e.target.checked)}
              className="peer sr-only"
            />
            <div className="w-5 h-5 rounded border-2 border-muted-foreground/40 peer-checked:bg-terracotta peer-checked:border-terracotta transition-colors flex items-center justify-center">
              <CheckCircle2 className="w-3.5 h-3.5 text-white opacity-0 peer-checked:opacity-100 transition-opacity" />
            </div>
          </div>
          <div>
            <h3 className="font-heading font-semibold text-lg group-hover:text-terracotta transition-colors">
              Modo Vendedor
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Activa esta opción para publicar productos y servicios en el marketplace.
            </p>
          </div>
        </label>

        <div className={`grid transition-all duration-300 ${
          esVendedor ? "grid-rows-[1fr] opacity-100 mt-5 pt-5 border-t border-terracotta/10" : "grid-rows-[0fr] opacity-0"
        }`}>
          <div className="overflow-hidden space-y-4">
            <div className="space-y-2">
              <label htmlFor="nombre_negocio" className="text-sm font-medium text-foreground/80">
                Nombre de tienda o negocio
              </label>
              <input
                id="nombre_negocio"
                name="nombre_negocio"
                type="text"
                defaultValue={profile?.nombre_negocio ?? ""}
                placeholder="Mi Tienda Local"
                className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="descripcion_negocio" className="text-sm font-medium text-foreground/80">
                Descripción del negocio <span className="text-muted-foreground font-normal">(opcional)</span>
              </label>
              <textarea
                id="descripcion_negocio"
                name="descripcion_negocio"
                rows={2}
                defaultValue={profile?.descripcion_negocio ?? ""}
                placeholder="¿Qué tipo de productos ofreces?"
                className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20 resize-y"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="metodos_pago_aceptados" className="text-sm font-medium text-foreground/80">
                Métodos de pago aceptados
              </label>
              <input
                id="metodos_pago_aceptados"
                name="metodos_pago_aceptados"
                type="text"
                defaultValue={profile?.metodos_pago_aceptados ?? ""}
                placeholder="Efectivo, transferencia, MercadoPago..."
                className="w-full rounded-xl border border-border/50 bg-white dark:bg-neutral-900 px-4 py-3 text-sm outline-none transition-all focus:border-terracotta/50 focus:ring-2 focus:ring-terracotta/20"
              />
            </div>

            <div className="pt-2">
              <Link
                href="/seller/verificacion"
                className="inline-flex items-center text-sm font-semibold text-terracotta hover:text-terracotta-dark hover:underline transition-all group"
              >
                <div className="w-6 h-6 rounded-full bg-terracotta/10 flex items-center justify-center mr-2 group-hover:scale-110 transition-transform">
                  <ShieldAlert className="w-3.5 h-3.5" />
                </div>
                Verificar identidad para subir nivel de confianza →
              </Link>
            </div>
          </div>
        </div>
      </div>

      <button
        type="submit"
        disabled={loading}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-charcoal dark:bg-neutral-800 px-4 py-4 text-sm font-semibold text-white shadow-sm transition-all duration-200 hover:bg-charcoal-light dark:hover:bg-neutral-700 hover:shadow-md active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none sticky bottom-20 md:bottom-4 z-10"
      >
        {loading ? (
          <Loader2 className="h-5 w-5 animate-spin" />
        ) : (
          "Guardar cambios"
        )}
      </button>
    </form>

      {/* Cerrar sesión */}
      <div className="mt-8 pt-6 border-t border-border/40">
        <LogoutButton />
      </div>
    </>
  );
}
