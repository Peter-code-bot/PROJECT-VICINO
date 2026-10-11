"use client";

import Link from "next/link";
import { startTransition as restoreTransition, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@vicino/shared";
import { Check } from "lucide-react";
import { iconoDeCategoria } from "@/lib/categories/icons";
import { AvatarInlineUpload } from "@/components/profile/avatar-inline-upload";
import OnboardingLocationMap from "@/components/map/onboarding-location-map";
import { useGeolocation } from "@/hooks/useGeolocation";
import { OnboardingActions, OnboardingShell, onboardingInputClassName } from "@/components/onboarding/onboarding-shell";
import { UsernameStep } from "@/components/onboarding/username-step";
import { Activar, Categoria, Pagos, Tipo } from "@/components/onboarding/seller-steps";
import { pasosDelCamino, rutaDePaso, siguientePaso, type CaminoOnboarding, type PasoOnboardingActual } from "@/lib/onboarding/steps";
import { completeOnboarding } from "@/app/(marketplace)/perfil/actions";
import { activarModoVendedor } from "../empezar-a-vender/actions";
import { PedirPermiso } from "../activar-notificaciones/pedir-permiso";
import { guardarPasoOnboarding, type GuardarPasoInput } from "./actions";
import type { OnboardingProfile } from "./load-profile";

interface Draft {
  username: string;
  nombre: string;
  foto: string;
  bio: string;
  categoria: string | null;
  tipo: "casual" | "business";
  nombreNegocio: string;
  descripcionNegocio: string;
  pagos: string[];
  intereses: string[];
}

const VISIBLE_CATEGORIES = CATEGORIES.filter((category) => !category.hidden_in_form);

function initialDraft(profile: OnboardingProfile): Draft {
  return {
    username: profile.username, nombre: profile.nombre ?? "", foto: profile.foto ?? "", bio: profile.bio ?? "",
    categoria: profile.categoria_negocio, tipo: profile.seller_type === "business" ? "business" : "casual",
    nombreNegocio: profile.nombre_negocio ?? "", descripcionNegocio: profile.descripcion_negocio ?? "",
    pagos: profile.metodos_pago_aceptados?.split(",").map((value) => value.trim()).filter(Boolean) ?? [],
    intereses: profile.intereses ?? [],
  };
}

export function CompletarPerfil({ profile, paso, camino }: {
  profile: OnboardingProfile;
  paso: PasoOnboardingActual;
  camino: CaminoOnboarding;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => initialDraft(profile));
  const [error, setError] = useState("");
  const [usuarioDisponible, setUsuarioDisponible] = useState(false);
  const [usernameLookupRevision, setUsernameLookupRevision] = useState(0);
  const [fotoBusy, setFotoBusy] = useState(false);
  const [sellerActive, setSellerActive] = useState(!!profile.es_vendedor);
  const [enviando, startTransition] = useTransition();
  const running = useRef(false);
  const { state: locationState, setManualPosition } = useGeolocation();
  const [locationDraft, setLocationDraft] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const draftKey = `vicino_onboarding_draft:${profile.id}`;
  const context = { camino, tipo: profile.seller_type === "business" ? "business" as const : "casual" as const };
  const steps = pasosDelCamino(context);
  const index = steps.indexOf(paso);
  const backHref = index > 0 ? rutaDePaso(steps[index - 1]!, camino) : "/bienvenida?elegir=1";
  const negocio = camino === "vender" && context.tipo === "business";

  // Session-only drafts preserve unsaved edits when returning to another page.
  // Persisted values stay on the server; blocked storage never blocks the flow.
  useEffect(() => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(draftKey) ?? "null") as Record<string, unknown> | null;
      if (!saved || typeof saved !== "object") return;
      const clean = initialDraft(profile);
      for (const key of ["username", "nombre", "foto", "bio", "nombreNegocio", "descripcionNegocio"] as const) {
        if (typeof saved[key] === "string") clean[key] = saved[key];
      }
      if (typeof saved.categoria === "string" || saved.categoria === null) clean.categoria = saved.categoria;
      if (saved.tipo === "business" || saved.tipo === "casual") clean.tipo = saved.tipo;
      for (const key of ["pagos", "intereses"] as const) {
        if (Array.isArray(saved[key]) && saved[key].every((value) => typeof value === "string")) clean[key] = saved[key];
      }
      restoreTransition(() => setDraft(clean));
    } catch { /* Private mode: previously saved server values still work. */ }
  }, [draftKey, profile]);

  function update<K extends keyof Draft>(key: K, value: Draft[K]) {
    setError("");
    setDraft((current) => {
      const next = { ...current, [key]: value };
      try { sessionStorage.setItem(draftKey, JSON.stringify(next)); } catch { /* Optional cache. */ }
      return next;
    });
  }

  async function saveProgress(next: PasoOnboardingActual, input: GuardarPasoInput = {}, nextCamino = camino, navigate = true) {
    const result = await guardarPasoOnboarding({ ...input, camino: nextCamino, paso: next });
    if (result.error) throw new Error(result.error);
    if (navigate) router.push(rutaDePaso(next, nextCamino));
  }

  function run(operation: () => Promise<void>) {
    if (running.current || fotoBusy) return;
    running.current = true;
    setError("");
    startTransition(async () => {
      try { await operation(); }
      catch (failure) {
        if (paso === "usuario") {
          setUsuarioDisponible(false);
          setUsernameLookupRevision((revision) => revision + 1);
        }
        setError(failure instanceof Error ? failure.message : "No se pudo guardar. Intenta de nuevo.");
      }
      finally { running.current = false; }
    });
  }

  const nombreValue = negocio ? draft.nombreNegocio : draft.nombre;
  const bioValue = negocio ? draft.descripcionNegocio : draft.bio;
  const maxBio = negocio ? 1000 : 160;
  const hayUbicacion = !!locationDraft || locationState.status === "success";
  const puedeActivar = !!profile.categoria_negocio && (!negocio || (profile.nombre_negocio?.trim().length ?? 0) >= 2);
  const canContinue: Record<PasoOnboardingActual, boolean> = {
    categoria: !!draft.categoria, tipo: true, usuario: usuarioDisponible,
    nombre: nombreValue.trim().length >= 2, foto: !!draft.foto,
    descripcion: bioValue.trim().length > 0 && bioValue.length <= maxBio,
    pagos: draft.pagos.length > 0, intereses: draft.intereses.length > 0 && draft.intereses.length <= 5,
    ubicacion: hayUbicacion, activar: sellerActive || puedeActivar,
    notificaciones: true, listo: true,
  };

  function omit() {
    if (paso === "activar" && !sellerActive) {
      run(() => saveProgress("notificaciones", {}, "explorar"));
      return;
    }
    const next = siguientePaso(paso, context);
    if (next) run(() => saveProgress(next));
  }

  function continueStep() {
    if (!canContinue[paso]) return;
    run(async () => {
      if (paso === "listo") {
        const result = await completeOnboarding();
        if (result.error) throw new Error(result.error);
        try { sessionStorage.removeItem(draftKey); } catch { /* Optional cache. */ }
        router.push(result.destino ?? "/");
        return;
      }
      const data: GuardarPasoInput = {};
      let next = siguientePaso(paso, context)!;
      switch (paso) {
        case "categoria": data.categoria_negocio = draft.categoria!; break;
        case "tipo":
          data.seller_type = draft.tipo;
          next = siguientePaso(paso, { camino, tipo: draft.tipo })!;
          break;
        case "usuario": data.username = draft.username.trim(); break;
        case "nombre":
          if (negocio) data.nombre_negocio = draft.nombreNegocio.trim();
          else data.nombre = draft.nombre.trim();
          break;
        case "foto": data.foto = draft.foto; break;
        case "descripcion":
          if (negocio) data.descripcion_negocio = draft.descripcionNegocio.trim();
          else data.bio = draft.bio.trim();
          break;
        case "pagos": data.metodos_pago_aceptados = draft.pagos.join(", "); break;
        case "intereses": data.intereses = draft.intereses; break;
        case "ubicacion":
          if (locationDraft) setManualPosition({ lat: locationDraft.lat, lng: locationDraft.lng, name: locationDraft.address });
          break;
        case "activar":
          if (!sellerActive) {
            // Only this explicit CTA activates. Skipped/session-only edits are not sent.
            const result = await activarModoVendedor({ categoria: profile.categoria_negocio, tipo: context.tipo,
              nombreNegocio: profile.nombre_negocio ?? undefined, descripcionNegocio: profile.descripcion_negocio ?? undefined,
              metodosPago: profile.metodos_pago_aceptados ?? undefined, foto: profile.foto ?? undefined });
            if (result.error) throw new Error(result.error);
            setSellerActive(true);
          }
          break;
      }
      await saveProgress(next, data);
    });
  }

  if (paso === "notificaciones") {
    return <PedirPermiso siguiente={rutaDePaso("listo", camino)} backHref={backHref} step={index + 1} totalSteps={steps.length}
      onContinue={() => saveProgress("listo", {}, camino, false)} />;
  }

  const titles: Record<PasoOnboardingActual, string> = {
    categoria: "¿Qué vendes?", tipo: "¿Cómo quieres vender?", usuario: "Elige tu ID de usuario",
    nombre: negocio ? "¿Cómo se llama tu negocio?" : "¿Cómo te llamas?",
    foto: negocio ? "Agrega la foto de tu negocio" : "Agrega tu foto",
    descripcion: negocio ? "Cuéntanos de tu negocio" : "Cuéntanos de ti",
    pagos: "¿Cómo aceptas pagos?", intereses: "¿Qué te interesa?", ubicacion: "¿Dónde estás?",
    activar: sellerActive ? "Tu Modo Vendedor está activo" : "Activa tu Modo Vendedor",
    notificaciones: "Activa tus notificaciones", listo: "Todo listo para empezar",
  };
  const descriptions: Partial<Record<PasoOnboardingActual, string>> = {
    categoria: "Elige la categoría que mejor describa lo que ofreces.",
    tipo: "Elige la opción que se adapte a ti.", usuario: "Así podrán encontrarte tus vecinos en VICINO.",
    nombre: "Este será el nombre que se verá en tu perfil. Puedes cambiarlo después.",
    foto: "Ayuda a tus vecinos a reconocerte. Puedes agregarla después.",
    descripcion: negocio ? "Escribe una descripción breve de lo que ofreces." : "Qué te gusta, qué buscas o qué vendes.",
    pagos: "Selecciona las opciones que ofreces a tus compradores.",
    intereses: "Elige hasta 5 categorías que te gusten.",
    ubicacion: "Elige tu zona para ver lo que se ofrece cerca de ti.",
    listo: profile.es_vendedor ? "Ya puedes explorar tu zona y publicar lo que vendes." : "Ya puedes explorar y conectar con tus vecinos.",
  };

  return (
    <OnboardingShell title={titles[paso]} description={descriptions[paso]} onBack={() => { if (!enviando && !fotoBusy) router.push(backHref); }}
      step={index + 1} totalSteps={steps.length} error={error} busy={enviando || fotoBusy}
      footer={<OnboardingActions type="submit" form="onboarding-question" busy={enviando || fotoBusy} disabled={!canContinue[paso]}
        continueLabel={paso === "activar" && !sellerActive ? "Activar Modo Vendedor" : paso === "listo" ? "Entrar a VICINO" : "Continuar"}
        onSkip={paso === "listo" ? undefined : omit} skipLabel={paso === "activar" && !sellerActive ? "Ahora no" : "Omitir"} />}>
      <form id="onboarding-question" onSubmit={(event) => { event.preventDefault(); continueStep(); }}>
        <fieldset disabled={enviando} className="min-w-0 space-y-5">
          {paso === "categoria" && <Categoria value={draft.categoria} onChange={(value) => update("categoria", value)} />}
          {paso === "tipo" && <Tipo value={draft.tipo} onChange={(value) => update("tipo", value)} />}
          {paso === "usuario" && <UsernameStep value={draft.username} onChange={(value) => update("username", value)}
            onValidityChange={setUsuarioDisponible} refreshToken={usernameLookupRevision} />}
          {paso === "nombre" && <div>
            <label htmlFor="onboarding-name" className="mb-2 block text-sm font-medium">{negocio ? "Nombre del negocio" : "Tu nombre"}</label>
            <input id="onboarding-name" name={negocio ? "nombre_negocio" : "nombre"} autoComplete={negocio ? "organization" : "name"}
              value={nombreValue} maxLength={negocio ? 100 : 60} className={onboardingInputClassName}
              onChange={(event) => update(negocio ? "nombreNegocio" : "nombre", event.target.value)} />
          </div>}
          {paso === "foto" && <AvatarInlineUpload initial={(nombreValue.trim()[0] ?? "?").toUpperCase()}
            avatarUrl={draft.foto} conRecorte onUploadSuccess={(url) => update("foto", url)} onError={setError} onBusyChange={setFotoBusy} />}
          {paso === "descripcion" && <div>
            <label htmlFor="onboarding-bio" className="mb-2 block text-sm font-medium">{negocio ? "Descripción del negocio" : "Tu descripción"}</label>
            <textarea id="onboarding-bio" name={negocio ? "descripcion_negocio" : "bio"} rows={5} value={bioValue} maxLength={maxBio}
              aria-describedby="description-count" className={`${onboardingInputClassName} resize-y`}
              onChange={(event) => update(negocio ? "descripcionNegocio" : "bio", event.target.value)} />
            <p id="description-count" className="mt-2 text-right text-sm text-fg-muted">{bioValue.length}/{maxBio}</p>
          </div>}
          {paso === "pagos" && <Pagos value={draft.pagos} onChange={(value) => update("pagos", value)} />}
          {paso === "intereses" && <div className="space-y-3">
            {VISIBLE_CATEGORIES.map((category) => {
              const Icon = iconoDeCategoria(category.slug);
              const selected = draft.intereses.includes(category.slug);
              return <button key={category.slug} type="button" aria-pressed={selected}
                disabled={!selected && draft.intereses.length >= 5}
                onClick={() => update("intereses", selected ? draft.intereses.filter((value) => value !== category.slug) : [...draft.intereses, category.slug])}
                className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left disabled:opacity-50 ${selected ? "border-brand bg-brand-tint dark:border-brand-hi" : "border-border"}`}>
                <Icon className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden="true" /><span className="min-w-0 flex-1">{category.name}</span>
                {selected && <Check className="h-5 w-5 text-brand dark:text-brand-hi" aria-hidden="true" />}
              </button>;
            })}
            <p role="status" className="text-sm text-fg-muted">{draft.intereses.length} de 5 seleccionados</p>
          </div>}
          {paso === "ubicacion" && <div className="space-y-4">
            <p className="text-sm text-fg-muted">Tu zona no publica tu dirección exacta. La ubicación de cada publicación la eliges al publicar.</p>
            <OnboardingLocationMap initialSelection={locationDraft} onSelectionChange={(lat, lng, address) => setLocationDraft({ lat, lng, address })} />
            <p className="text-sm text-fg-muted">Si omites este paso, podrás elegir tu zona desde el inicio.</p>
          </div>}
          {paso === "activar" && <div className="space-y-5">
            <Activar nombre={negocio ? profile.nombre_negocio ?? "" : profile.nombre} categoria={profile.categoria_negocio} tipo={context.tipo} />
            {!puedeActivar && !sellerActive && <p className="text-sm text-fg-muted">
              Para activar, elige <Link href={rutaDePaso("categoria", camino)} className="font-medium text-brand underline dark:text-fg">tu categoría</Link>
              {negocio && <> y agrega <Link href={rutaDePaso("nombre", camino)} className="font-medium text-brand underline dark:text-fg">el nombre de tu negocio</Link></>}. También puedes elegir Ahora no y seguir explorando.
            </p>}
          </div>}
          {paso === "listo" && <div className="space-y-4">
            <div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-tint text-brand dark:text-brand-hi"><Check className="h-8 w-8" aria-hidden="true" /></div>
            <p className="text-base text-fg-muted">Puedes completar o cambiar tus datos cuando quieras desde tu perfil.</p>
          </div>}
        </fieldset>
      </form>
    </OnboardingShell>
  );
}
