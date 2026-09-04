"use client";

import { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateProfile, setUsername } from "./actions";
import { Loader2, ShieldAlert, User, Store, ChevronLeft } from "lucide-react";
import { MetodosPagoSelector } from "@/components/profile/metodos-pago-selector";
import { AvatarInlineUpload } from "@/components/profile/avatar-inline-upload";

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
  const [username, setUsernameLocal] = useState(profile?.username ?? "");
  const [usernameGuardado, setUsernameGuardado] = useState(profile?.username ?? "");
  const [metodosSeleccionados, setMetodosSeleccionados] = useState<string[]>(() => {
    const raw = profile?.metodos_pago_aceptados ?? "";
    return raw ? raw.split(",").map(m => m.trim()).filter(Boolean) : [];
  });

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
      setLoading(false);
      return;
    }

    // Sin espera y sin apagar `loading`: el boton se queda en "Guardando..." hasta
    // que pinta /perfil, y asi no hay hueco para reenviar el formulario.
    // `replace` y no `push` para que el boton atras no devuelva al formulario que
    // se acaba de cerrar.
    router.replace("/perfil");
    router.refresh();
  }

  async function handleSubmit(formData: FormData) {
    setError("");

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
    <form action={handleSubmit} className="space-y-6">
      <div className="flex items-center gap-3 mb-2">
        <Link
          href="/perfil"
          className="w-9 h-9 rounded-xl bg-muted flex items-center justify-center hover:bg-accent transition-colors shrink-0"
          aria-label="Volver al perfil"
        >
          <ChevronLeft className="w-5 h-5" />
        </Link>
        <h1 className="flex-1 text-xl font-heading font-bold">Editar perfil</h1>
        <button
          type="submit"
          disabled={loading || pendingDeactivation !== null}
          className="shrink-0 text-[15px] font-semibold text-primary dark:text-accent px-2 py-1 rounded-lg transition-opacity disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {loading ? (
            <span className="inline-flex items-center gap-1.5">
              <Loader2 className="w-4 h-4 animate-spin" />
              Guardando…
            </span>
          ) : (
            "Listo"
          )}
        </button>
      </div>

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
              Ya lo activamos aquí debajo. Completa tu
              nombre y tu zona, guarda, y podrás publicar.
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

      {/* Avatar upload */}
      <AvatarInlineUpload
        initial={profile?.nombre?.charAt(0)?.toUpperCase() ?? "?"}
        avatarUrl={avatarUrl}
        onUploadSuccess={(url) => setAvatarUrl(url)}
        onError={(msg) => setError(msg)}
      />
      <input type="hidden" name="foto" value={avatarUrl} />

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

              {/* Botón desplegable y panel */}
              <MetodosPagoSelector
                metodosSeleccionados={metodosSeleccionados}
                onChange={setMetodosSeleccionados}
              />
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

      {pendingDeactivation && (
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
              {loading ? <Loader2 className="h-5 w-5 animate-spin mx-auto" /> : "Desactivar Modo Vendedor"}
            </button>
          </div>
        </div>
      )}
    </form>
  );
}
