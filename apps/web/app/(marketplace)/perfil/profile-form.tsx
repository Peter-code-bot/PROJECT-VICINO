"use client";

import { CACHE_INMUTABLE } from "@/lib/storage/cache";
import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateProfile, setUsername } from "./actions";
import { Loader2, ShieldAlert, CheckCircle2, User, Store, ChevronDown } from "lucide-react";

const METODOS_PAGO = [
  "Efectivo",
  "Tarjeta de crédito",
  "Tarjeta de débito",
  "Transferencia bancaria",
  "Mercado Pago",
  "OXXO Pay",
  "PayPal",
  "Depósito bancario",
  "Crypto",
];

function FieldRow({ label, htmlFor, hint, children, last = false }: {
  label: string;
  htmlFor?: string;
  hint?: React.ReactNode;
  children: React.ReactNode;
  last?: boolean;
}) {
  const Etiqueta = htmlFor ? "label" : "span";
  return (
    <div className={`group/field flex items-start gap-3 py-3 ${last ? "" : "border-b border-border/10"}`}>
      <Etiqueta
        htmlFor={htmlFor}
        className="w-24 shrink-0 pt-0.5 text-[13px] text-muted-foreground transition-colors group-focus-within/field:text-primary"
      >
        {label}
      </Etiqueta>
      <div className="min-w-0 flex-1">
        {children}
        {hint && <span className="mt-1 block text-[11px] text-muted-foreground">{hint}</span>}
      </div>
    </div>
  );
}

interface ProfileFormProps {
  profile: {
    nombre: string;
    email: string;
    foto: string | null;
    bio: string | null;
    ubicacion: string | null;
    es_vendedor: boolean;
    seller_type: string | null;
    nombre_negocio: string | null;
    descripcion_negocio: string | null;
    metodos_pago_aceptados: string | null;
    trust_level: string;
    user_id: string | null;
    username?: string | null;
  } | null;
  /**
   * Phase 9: number of products with `estatus='disponible'` for this user. Used
   * to warn before turning seller mode off — those products will be auto-paused
   * by the server action.
   */
  activeProductCount: number;
  /** Llega de ?prompt=seller-mode: la persona acaba de decir que quiere vender. */
  vieneAVender?: boolean;
}

export function ProfileForm({
  profile,
  activeProductCount,
  vieneAVender = false,
}: ProfileFormProps) {
  const initialEsVendedor = profile?.es_vendedor ?? false;
  const [error, setError] = useState("");
  const [usernameError, setUsernameError] = useState(false);
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  // Si llega desde "Quiero vender" y todavia no lo es, la casilla nace
  // marcada. Honra lo que acaba de pedir, y el aviso de arriba lo dice en
  // voz alta para que no sea un cambio a sus espaldas: sigue pudiendo
  // desmarcarla antes de guardar.
  const [esVendedor, setEsVendedor] = useState(
    initialEsVendedor || (vieneAVender && !initialEsVendedor),
  );
  // Phase 9: hold the FormData while the user confirms turning off seller mode
  // with active products. Mirror of the cancel-appointment-button.tsx pattern
  // (state-based inline confirmation, no modal lib).
  const [pendingDeactivation, setPendingDeactivation] = useState<FormData | null>(null);
  const [sellerType, setSellerType] = useState(profile?.seller_type ?? "casual");
  const [avatarUrl, setAvatarUrl] = useState(profile?.foto ?? "");
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [username, setUsernameLocal] = useState(profile?.username ?? "");
  const [usernameGuardado, setUsernameGuardado] = useState(profile?.username ?? "");
  const [metodosSeleccionados, setMetodosSeleccionados] = useState<string[]>(() => {
    const raw = profile?.metodos_pago_aceptados ?? "";
    return raw ? raw.split(",").map(m => m.trim()).filter(Boolean) : [];
  });
  const [metodosOpen, setMetodosOpen] = useState(false);
  const router = useRouter();

  const bioRef = useRef<HTMLTextAreaElement>(null);
  const negocioRef = useRef<HTMLTextAreaElement>(null);

  function autoGrow(el: HTMLTextAreaElement) {
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  useEffect(() => {
    if (bioRef.current) {
      autoGrow(bioRef.current);
    }
  }, []);

  useEffect(() => {
    if (sellerType === "business" && negocioRef.current) {
      autoGrow(negocioRef.current);
    }
  }, [sellerType]);

  function toggleMetodo(metodo: string) {
    setMetodosSeleccionados(prev =>
      prev.includes(metodo) ? prev.filter(m => m !== metodo) : [...prev, metodo]
    );
  }

  async function runUpdate(formData: FormData) {
    setLoading(true);
    setUsernameError(false);

    if (username.trim() !== usernameGuardado) {
      const usernameData = new FormData();
      usernameData.set("username", username.trim());
      const r = await setUsername(usernameData);
      if (r.error) {
        setError(r.error);
        setUsernameError(true);
        setLoading(false);
        return;
      }
      if (r.username) {
        setUsernameLocal(r.username);
        setUsernameGuardado(r.username);
      }
    }

    const result = await updateProfile(formData);
    if (result?.error) {
      setError(result.error);
    } else {
      setSuccess(true);
      setTimeout(() => {
        router.push("/perfil");
        router.refresh();
      }, 1500);
    }
    setLoading(false);
  }

  async function handleSubmit(formData: FormData) {
    setError("");
    setSuccess(false);

    // Phase 9: intercept ON→OFF transitions when the user has active products.
    // The form data still goes through unchanged once the user confirms; the
    // server action does the actual products UPDATE atomically with the
    // profile UPDATE.
    const submittingEsVendedor = formData.get("es_vendedor") === "on";
    const turningSellerOff = initialEsVendedor && !submittingEsVendedor;
    // Sale SIEMPRE que se desactive, no solo con publicaciones activas.
    //
    // Antes la condicion era `turningSellerOff && activeProductCount > 0`, asi
    // que un vendedor con cero publicaciones desmarcaba la casilla, guardaba, y
    // no veia ningun aviso — pese a que desactivar tambien devuelve el tipo a
    // "casual" y le quita el permiso de publicar. Un cambio de estado que la
    // persona no puede deshacer sin volver a pasar por aqui merece que se le
    // pregunte, tenga cero publicaciones o veinte.
    if (turningSellerOff) {
      setPendingDeactivation(formData);
      return;
    }

    await runUpdate(formData);
  }

  function cancelDeactivation() {
    setPendingDeactivation(null);
  }

  function confirmDeactivation() {
    if (!pendingDeactivation) return;
    const formData = pendingDeactivation;
    setPendingDeactivation(null);
    void runUpdate(formData);
  }

  return (
    <>
    <form action={handleSubmit} className="space-y-6">
      {/* El aviso que cierra el item 7. Quien llega desde "Quiero vender" se
          encontraba el titulo "Editar perfil" y nada mas, con la casilla que
          tenia que marcar desmarcada, colapsada y por debajo de seis campos.
          Aqui se le dice que ya esta marcada y que solo falta guardar. */}
      {vieneAVender && !initialEsVendedor && (
        <div
          role="status"
          className="flex items-start gap-3 rounded-xl border border-primary/25 bg-primary/5 p-4 text-sm animate-fade-in"
        >
          <Store className="w-5 h-5 shrink-0 text-primary mt-0.5" />
          <div>
            <p className="font-medium">Ya casi eres vendedor</p>
            <p className="mt-0.5 text-muted-foreground">
              Activamos el <strong>Modo Vendedor</strong> más abajo. Completa tu
              nombre y tu ubicación, guarda los cambios y podrás publicar.
            </p>
          </div>
        </div>
      )}

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

      {/* Avatar upload */}
      <div className="flex flex-col items-center justify-center mb-6">
        <div className="relative w-[72px] h-[72px] rounded-full bg-muted overflow-hidden shrink-0">
          {avatarUrl ? (
            <img src={avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl font-bold text-muted-foreground">
              {profile?.nombre?.charAt(0)?.toUpperCase() ?? "?"}
            </div>
          )}
          {avatarUploading && (
            <div className="absolute inset-0 bg-black/60 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            </div>
          )}
        </div>
        <label className="cursor-pointer mt-3">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            disabled={avatarUploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) { setError("La imagen no debe exceder 5MB"); return; }
              setAvatarUploading(true);
              try {
                const supabase = (await import("@/lib/supabase/client")).createClient();
                const { data: { user } } = await supabase.auth.getUser();
                if (!user) throw new Error("No autenticado");
                const ext = file.name.split(".").pop() ?? "jpg";
                const path = `${user.id}/avatar-${Date.now()}.${ext}`;
                const { error: upErr } = await supabase.storage.from("avatars").upload(path, file, { upsert: true, cacheControl: CACHE_INMUTABLE });
                if (upErr) throw upErr;
                const { data: urlData } = supabase.storage.from("avatars").getPublicUrl(path);
                setAvatarUrl(urlData.publicUrl);
              } catch (err) {
                setError(err instanceof Error ? err.message : "Error al subir foto");
              }
              setAvatarUploading(false);
            }}
          />
          <span className="text-[13px] font-medium text-primary hover:underline">
            {avatarUrl ? "Cambiar foto" : "Subir foto"}
          </span>
        </label>
        <input type="hidden" name="foto" value={avatarUrl} />
      </div>

      {/* Basic Info Section */}
      <div className="p-5 rounded-3xl bg-card shadow-sm animate-scale-in">
        <div className="pb-4">
          <h2 className="font-heading font-semibold text-[15px]">Información personal</h2>
        </div>

        <FieldRow label="Nombre" htmlFor="nombre">
          <input
            id="nombre"
            name="nombre"
            type="text"
            required
            maxLength={100}
            defaultValue={profile?.nombre ?? ""}
            className="w-full bg-transparent border-0 p-0 text-base text-foreground outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
          />
        </FieldRow>

        <FieldRow 
          label="Usuario" 
          htmlFor="username"
          hint={
            <>
              Visible en tu perfil · ID: {profile?.user_id ?? "—"}
              {usernameError && (
                <span className="block text-destructive mt-1" role="alert">
                  3 a 30 caracteres · letras, números y guion bajo
                </span>
              )}
            </>
          }
        >
          <div className="flex items-center">
            <span className="text-base text-muted-foreground mr-0.5">@</span>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsernameLocal(e.target.value)}
              maxLength={30}
              className="w-full bg-transparent border-0 p-0 text-base text-foreground outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
            />
          </div>
        </FieldRow>

        <FieldRow 
          label="Correo"
          htmlFor="email"
          hint="No se puede cambiar"
        >
          <input
            id="email"
            type="email"
            disabled
            value={profile?.email ?? ""}
            className="w-full bg-transparent border-0 p-0 text-base text-muted-foreground outline-none focus:outline-none focus:ring-0 cursor-not-allowed opacity-80"
          />
        </FieldRow>

        <FieldRow label="Bio" htmlFor="bio" hint="Opcional">
          <textarea
            id="bio"
            name="bio"
            ref={bioRef}
            rows={2}
            maxLength={500}
            defaultValue={profile?.bio ?? ""}
            onInput={(e) => autoGrow(e.currentTarget)}
            placeholder="Cuéntanos sobre ti..."
            className="w-full bg-transparent border-0 p-0 text-base text-foreground outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground resize-none overflow-hidden"
          />
        </FieldRow>

        <FieldRow 
          label="Zona"
          htmlFor="ubicacion"
          hint="Opcional · Se muestra junto a tu nombre. Dónde apareces en las búsquedas lo decide la ubicación de cada publicación."
          last
        >
          <input
            id="ubicacion"
            name="ubicacion"
            type="text"
            maxLength={200}
            defaultValue={profile?.ubicacion ?? ""}
            placeholder="Ej: Col. Roma, CDMX"
            className="w-full bg-transparent border-0 p-0 text-base text-foreground outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
          />
        </FieldRow>
      </div>

      {/* Seller Section */}
      <div className="p-5 rounded-3xl bg-card shadow-sm transition-all duration-300 stagger">
        <label className="flex items-center justify-between cursor-pointer group mb-1">
          <div>
            <h3 className="font-heading font-semibold text-[15px] group-hover:text-primary transition-colors">
              Modo Vendedor
            </h3>
            <p className="text-[13px] text-muted-foreground mt-0.5">
              Publica productos y servicios
            </p>
          </div>
          <div className="relative flex items-center shrink-0">
            <input
              type="checkbox"
              name="es_vendedor"
              checked={esVendedor}
              onChange={(e) => {
                setEsVendedor(e.target.checked);
                // Discard any stale deactivation snapshot if the user
                // reconsiders after submitting the confirmation block.
                setPendingDeactivation(null);
              }}
              className="peer sr-only"
            />
            <div className={`relative w-11 h-[26px] rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-primary/40 ${
              esVendedor ? "bg-primary" : "bg-muted-foreground/30"
            }`}>
              <div className={`absolute top-[2px] h-[22px] w-[22px] rounded-full bg-white shadow-sm transition-all duration-200 ${
                esVendedor ? "left-[20px]" : "left-[2px]"
              }`} />
            </div>
          </div>
        </label>

        <div className={`grid transition-all duration-300 ${
          esVendedor ? "grid-rows-[1fr] opacity-100 mt-5 pt-5 border-t border-border/10" : "grid-rows-[0fr] opacity-0"
        }`}>
          <div className="overflow-hidden space-y-4">
            {/* Seller type */}
            <input type="hidden" name="seller_type" value={sellerType} />
            <div className="space-y-3">
              <span className="block text-[13px] text-muted-foreground">Tipo de vendedor</span>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setSellerType("casual")}
                  className={`p-3 rounded-xl border text-left transition-all ${sellerType === "casual" ? "border-primary bg-primary/10" : "border-border/15"}`}>
                  <User className="w-5 h-5 mb-1 text-muted-foreground" />
                  <p className="font-semibold text-sm">Casual</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Vende artículos personales</p>
                </button>
                <button type="button" onClick={() => setSellerType("business")}
                  className={`p-3 rounded-xl border text-left transition-all ${sellerType === "business" ? "border-primary bg-primary/10" : "border-border/15"}`}>
                  <Store className="w-5 h-5 mb-1 text-muted-foreground" />
                  <p className="font-semibold text-sm">Negocio</p>
                  <p className="text-[11px] text-muted-foreground mt-0.5">Registra tu tienda</p>
                </button>
              </div>
            </div>

            <hr className="border-border/10" />

            {/* Business fields — only if type is business */}
            {sellerType === "business" && (
              <>
                <div>
                  <FieldRow label="Tienda" htmlFor="nombre_negocio">
                    <input
                      id="nombre_negocio"
                      name="nombre_negocio"
                      type="text"
                      maxLength={100}
                      defaultValue={profile?.nombre_negocio ?? ""}
                      placeholder="Mi Tienda Local"
                      className="w-full bg-transparent border-0 p-0 text-base text-foreground outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
                    />
                  </FieldRow>

                  <FieldRow label="Descripción" htmlFor="descripcion_negocio" hint="Opcional" last>
                    <textarea
                      id="descripcion_negocio"
                      name="descripcion_negocio"
                      ref={negocioRef}
                      rows={2}
                      maxLength={1000}
                      defaultValue={profile?.descripcion_negocio ?? ""}
                      onInput={(e) => autoGrow(e.currentTarget)}
                      placeholder="¿Qué tipo de productos ofreces?"
                      className="w-full bg-transparent border-0 p-0 text-base text-foreground outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground resize-none overflow-hidden"
                    />
                  </FieldRow>
                </div>
                <hr className="border-border/10" />
              </>
            )}

            <div className="space-y-3">
              <span className="block text-[13px] text-muted-foreground">
                Métodos de pago
              </span>
              <input type="hidden" name="metodos_pago_aceptados" value={metodosSeleccionados.join(", ")} />

              {/* Botón desplegable */}
              <button
                type="button"
                onClick={() => setMetodosOpen(!metodosOpen)}
                className="w-full flex items-center justify-between rounded-xl bg-muted px-4 py-3 text-base text-left transition-all outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                <span className={metodosSeleccionados.length > 0 ? "text-foreground truncate pr-2" : "text-muted-foreground"}>
                  {metodosSeleccionados.length > 0
                    ? metodosSeleccionados.join(", ")
                    : "Selecciona métodos de pago..."}
                </span>
                <ChevronDown className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ${metodosOpen ? "rotate-180" : ""}`} />
              </button>

              {/* Panel expandible INLINE (NO absolute — el padre tiene overflow-hidden) */}
              <div className={`grid transition-all duration-300 ${metodosOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"}`}>
                <div className="overflow-hidden">
                  <div className="rounded-xl bg-muted mt-1">
                    <div className="p-2 space-y-0.5">
                      {METODOS_PAGO.map((metodo) => (
                        <label
                          key={metodo}
                          className={`flex items-center gap-3 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                            metodosSeleccionados.includes(metodo)
                              ? "bg-primary/10 text-foreground"
                              : "hover:bg-foreground/5 text-foreground/80"
                          }`}
                        >
                          <input
                            type="checkbox"
                            className="sr-only"
                            checked={metodosSeleccionados.includes(metodo)}
                            onChange={() => toggleMetodo(metodo)}
                          />
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                            metodosSeleccionados.includes(metodo)
                              ? "bg-primary border-primary"
                              : "border-muted-foreground/40"
                          }`}>
                            {metodosSeleccionados.includes(metodo) && (
                              <CheckCircle2 className="w-3 h-3 text-primary-foreground" />
                            )}
                          </div>
                          <span className="text-base">{metodo}</span>
                        </label>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <Link
                href="/seller/verificacion"
                className="flex items-center gap-3 bg-primary/[0.06] rounded-xl px-3 py-2.5 group"
              >
                <div className="w-5 h-5 rounded-full bg-primary/10 flex items-center justify-center shrink-0 group-hover:scale-110 transition-transform">
                  <ShieldAlert className="w-3 h-3 text-primary" />
                </div>
                <span className="text-[12px] font-medium text-primary flex-1">
                  Verifica tu identidad para más confianza →
                </span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {pendingDeactivation ? (
        <div className="space-y-3 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
          <p className="font-semibold text-amber-900 dark:text-amber-200">
            Desactivar Modo Vendedor
          </p>
          <div className="space-y-2 text-amber-800/90 dark:text-amber-200/80">
            <p>Al desactivarlo:</p>
            <ul className="space-y-1 pl-4">
              {activeProductCount > 0 && (
                <li className="list-disc">
                  Tus {activeProductCount}{" "}
                  {activeProductCount === 1
                    ? "publicación activa se pausa"
                    : "publicaciones activas se pausan"}{" "}
                  y {activeProductCount === 1 ? "deja" : "dejan"} de aparecer en las
                  búsquedas. No se {activeProductCount === 1 ? "borra" : "borran"}.
                </li>
              )}
              <li className="list-disc">Dejas de poder publicar hasta que lo vuelvas a activar.</li>
              <li className="list-disc">Tu perfil deja de mostrar tu categoría y el nombre de tu negocio.</li>
              <li className="list-disc">Vuelves a ser vendedor «Casual».</li>
            </ul>
            {/* Esto es cierto desde la migracion 20260826340000. Antes NO lo era:
                desactivar ponia a NULL el nombre del negocio, su descripcion y
                los metodos de pago, y este mismo recuadro decia "podras
                reactivarlos", dando a entender que se recuperaba todo. */}
            <p className="pt-1">
              No se borra nada: el nombre de tu negocio, su descripción y tus métodos
              de pago se guardan, y vuelven tal cual si lo reactivas.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={cancelDeactivation}
              disabled={loading}
              className="flex-1 rounded-lg border border-amber-300 bg-white dark:bg-transparent dark:border-amber-700 px-4 py-2.5 text-sm font-medium text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors disabled:opacity-50"
            >
              Cancelar
            </button>
            <button
              type="button"
              onClick={confirmDeactivation}
              disabled={loading}
              className="flex-1 rounded-lg bg-red-600 hover:bg-red-700 px-4 py-2.5 text-sm font-semibold text-white transition-colors disabled:opacity-50"
            >
              {/* La confirmacion REPITE la etiqueta de la accion, como hace Instagram,
                  en vez de un "Aceptar" ambiguo. Y ya no dice "y pausar": con cero
                  publicaciones no habia nada que pausar y el boton mentia. */}
              {loading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : "Desactivar Modo Vendedor"}
            </button>
          </div>
        </div>
      ) : (
        <button
          type="submit"
          disabled={loading}
          className="flex w-full items-center justify-center gap-2 rounded-xl bg-primary px-4 py-4 text-[15px] font-semibold text-primary-foreground transition-all duration-200 hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none"
        >
          {loading ? (
            <Loader2 className="h-5 w-5 animate-spin" />
          ) : (
            "Guardar cambios"
          )}
        </button>
      )}
    </form>

    </>
  );
}
