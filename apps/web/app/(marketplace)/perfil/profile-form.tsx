"use client";

import { publicProfileName } from "@vicino/shared";

import { useState, useRef, useEffect } from "react";
import { BotonRegresar } from "@/components/ui/boton-regresar";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { updateProfile, setUsername } from "./actions";
import { invalidateSessionData } from "@/lib/session-events";
import { Loader2, ShieldAlert, User, Store } from "lucide-react";
import { MetodosPagoSelector } from "@/components/profile/metodos-pago-selector";
import { AvatarInlineUpload } from "@/components/profile/avatar-inline-upload";
import { CampoWhatsApp } from "@/components/profile/campo-whatsapp";

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
    instagram_usuario?: string | null;
    whatsapp_numero?: string | null;
    google_maps_url?: string | null;
    google_resenas_url?: string | null;
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
  const saving = useRef(false);
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
  const avisoRef = useRef<HTMLDivElement>(null);
  const errorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (pendingDeactivation) avisoRef.current?.scrollIntoView({ block: "center" });
  }, [pendingDeactivation]);

  useEffect(() => {
    if (error) errorRef.current?.scrollIntoView({ block: "center" });
  }, [error]);

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
    if (saving.current) return;
    saving.current = true;
    setLoading(true);
    setUsernameError(false);
    let navigating = false;
    let usernameUpdated = false;
    const requestedUsername = String(formData.get("username") ?? username).trim();
    const describeFailure = (message: string) => usernameUpdated
      ? `Tu nombre de usuario se guardó, pero faltan los demás cambios. ${message}`
      : message;
    try {
      if (requestedUsername !== usernameGuardado) {
        const usernameData = new FormData();
        usernameData.set("username", requestedUsername);
        const result = await setUsername(usernameData);
        if (result.error) {
          setError(result.error);
          setUsernameError(true);
          return;
        }
        if (result.username) {
          setUsernameLocal(result.username);
          setUsernameGuardado(result.username);
          usernameUpdated = true;
        }
      }
      const result = await updateProfile(formData);
      if (result?.error) {
        setError(describeFailure(result.error));
        return;
      }
      invalidateSessionData();
      router.replace("/perfil");
      router.refresh();
      navigating = true;
    } catch {
      setError(describeFailure("No pudimos confirmar el guardado. Revisa tu conexión e inténtalo de nuevo."));
    } finally {
      // Keep duplicate submission blocked until navigation after success;
      // every error restores the form and preserves the user's draft.
      if (!navigating) {
        saving.current = false;
        setLoading(false);
      }
    }
  }

  async function handleSubmit(formData: FormData) {
    if (saving.current) return;
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
    <form action={handleSubmit} className="relative space-y-6">
      <h1 className="pointer-events-none absolute inset-x-14 top-0 flex h-11 items-center text-xl font-heading font-bold">
        Editar perfil
      </h1>
      <div className="pointer-events-none sticky top-[calc(3.5rem+env(safe-area-inset-top,0px))] z-30 flex h-11 items-center justify-between md:top-0">
        <BotonRegresar href="/perfil" aria-label="Volver al perfil" variante="solido" className="pointer-events-auto" />
        <button
          type="submit"
          disabled={loading || pendingDeactivation !== null}
          className="pointer-events-auto min-h-11 shrink-0 rounded-full bg-[color:var(--bg)] px-3 text-[15px] font-semibold text-primary shadow-sm transition-opacity disabled:opacity-40 focus-visible:ring-2 focus-visible:ring-primary/40 dark:text-accent"
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
        <div ref={errorRef} role="alert" className="flex items-start gap-3 rounded-xl border border-red-200/50 bg-red-50/50 dark:bg-red-950/20 p-4 text-sm text-red-600 dark:text-red-400 animate-fade-in">
          <ShieldAlert className="w-5 h-5 shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {/* Avatar upload */}
      {/* El recorte llega tambien aqui, y no solo al onboarding: el componente
          de subida es compartido, asi que encuadrar deja de depender del CSS
          en las tres superficies que suben avatar. Antes la foto se subia tal
          cual y el contenedor la recortaba con object-cover — con una foto
          apaisada, eso es una cara cortada. */}
      <AvatarInlineUpload
        conRecorte
        initial={publicProfileName(profile).charAt(0).toUpperCase()}
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

            <hr className="border-border/10" />

            {/* Enlaces externos del negocio. Son campos de texto libre y no
                type="url" a proposito: la gente pega "maps.app.goo.gl/x" sin
                https o "@mitienda", y el navegador los rechazaria antes de que
                el servidor pudiera limpiarlos (enlacesNegocioSchema). Vacio
                significa "quitar": el servidor recibe los cuatro siempre. */}
            <div>
              <span className="block text-[13px] text-muted-foreground">
                Contacto y redes del negocio
              </span>
              <p className="mt-0.5 mb-1 text-[11px] text-muted-foreground">
                Opcional. Aparecen como botones en tu perfil público. Pon solo lo que ya sea público.
              </p>

              <FieldRow label="Instagram" htmlFor="instagram_usuario" hint="Tu usuario, con o sin @">
                <input
                  id="instagram_usuario"
                  name="instagram_usuario"
                  type="text"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={100}
                  defaultValue={profile?.instagram_usuario ?? ""}
                  placeholder="mitienda.puebla"
                  className="w-full bg-transparent border-0 p-0 text-base text-foreground outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
                />
              </FieldRow>

              <FieldRow label="WhatsApp" htmlFor="whatsapp_nacional" hint="Selecciona el país y escribe tu número local.">
                <CampoWhatsApp inicial={profile?.whatsapp_numero ?? ""} activo={esVendedor} />
              </FieldRow>

              <FieldRow label="Google Maps" htmlFor="google_maps_url" hint="Enlace de tu ficha o del punto que quieras compartir (Compartir → Copiar enlace)">
                <input
                  id="google_maps_url"
                  name="google_maps_url"
                  type="text"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={500}
                  defaultValue={profile?.google_maps_url ?? ""}
                  placeholder="https://maps.app.goo.gl/…"
                  className="w-full bg-transparent border-0 p-0 text-base text-foreground outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
                />
              </FieldRow>

              <FieldRow
                label="Reseñas Google"
                htmlFor="google_resenas_url"
                hint="El enlace que te da Google en tu Perfil de Negocio (Pedir reseñas). Solo se ofrece a quien ya te compró; nunca a cambio de un premio."
                last
              >
                <input
                  id="google_resenas_url"
                  name="google_resenas_url"
                  type="text"
                  inputMode="url"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  maxLength={300}
                  defaultValue={profile?.google_resenas_url ?? ""}
                  placeholder="https://g.page/r/…/review"
                  className="w-full bg-transparent border-0 p-0 text-base text-foreground outline-none focus:outline-none focus:ring-0 placeholder:text-muted-foreground"
                />
              </FieldRow>
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
          label="Nombre de usuario"
          htmlFor="username"
          hint={
            <>
              Visible en tu perfil
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
              name="username"
              disabled={loading}
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
        <div ref={avisoRef} className="space-y-3 rounded-xl border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 p-4 text-sm">
          <p className="font-semibold text-amber-900 dark:text-amber-200">
            Desactivar Modo Vendedor
          </p>
          <div className="space-y-2 text-amber-800/90 dark:text-amber-200/80">
            {/* Texto de Alejandro (8-nov-2026). Antes la lista cerraba con
                "Vuelves a ser vendedor «Casual»", que se leia como si la cuenta
                siguiera vendiendo con otro tipo. Es un detalle de la base
                (update_profile_and_pause_products guarda seller_type = 'casual'
                al desactivar) que no le toca a quien lee: lo que pasa es que
                Modo Vendedor queda apagado. */}
            <p>
              Al desactivar Modo Vendedor, tus publicaciones se pausarán y se quitarán los
              enlaces de contacto de tu negocio.
            </p>
            <ul className="space-y-1 pl-4">
              {activeProductCount > 0 && (
                <li className="list-disc">
                  {activeProductCount === 1
                    ? "Tu publicación activa deja de aparecer en las búsquedas. No se borra."
                    : `Tus ${activeProductCount} publicaciones activas dejan de aparecer en las búsquedas. No se borran.`}
                </li>
              )}
              {/* "ni volver a mostrarlas": toggleProductStatus y la policy de
                  UPDATE (20261108190000) lo exigen desde el 8-nov-2026. */}
              <li className="list-disc">
                No podrás publicar ni volver a mostrar tus publicaciones hasta que lo actives otra vez.
              </li>
              <li className="list-disc">Tu perfil deja de mostrar tu categoría y el nombre de tu negocio.</li>
              <li className="list-disc">
                Los enlaces (Instagram, WhatsApp, Google Maps y reseñas) son públicos: se quitan para
                que nadie los vea mientras no vendas, y tendrás que volver a ponerlos.
              </li>
            </ul>
            {/* Cierto desde la migracion 20260826340000: desactivar ya no pone a
                NULL el nombre del negocio, su descripcion ni los metodos de
                pago. Los enlaces son la excepcion deliberada (20261108120000):
                se quitan porque son columnas publicas. */}
            <p className="pt-1">
              El nombre de tu negocio, su descripción y tus métodos de pago se guardan para cuando
              lo actives otra vez.
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
