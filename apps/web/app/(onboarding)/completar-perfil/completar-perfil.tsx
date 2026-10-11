"use client";

import dynamic from "next/dynamic";
import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CATEGORIES } from "@vicino/shared";
import { Check } from "lucide-react";
import { iconoDeCategoria } from "@/lib/categories/icons";
import { useGeolocation } from "@/hooks/useGeolocation";
import { OnboardingActions, OnboardingShell, onboardingInputClassName } from "@/components/onboarding/onboarding-shell";
import { UsernameStep } from "@/components/onboarding/username-step";
import { Activar, Categoria, Pagos, Tipo } from "@/components/onboarding/seller-steps";
import { esPasoOnboarding, pasoParaReanudar, pasosDelCamino, rutaDePaso, siguientePaso, type CaminoOnboarding, type PasoOnboardingActual } from "@/lib/onboarding/steps";
import { fieldsForOnboardingStep } from "@/lib/onboarding/draft";
import { finishOnboardingNavigation, startOnboardingNavigation } from "@/lib/onboarding/client-metrics";
import { useOnboardingSession } from "./onboarding-session";

const AvatarInlineUpload = dynamic(() => import("@/components/profile/avatar-inline-upload").then((module) => module.AvatarInlineUpload),
  { loading: () => <p role="status" className="text-sm text-fg-muted">Preparando la foto…</p> });
const OnboardingLocationMap = dynamic(() => import("@/components/map/onboarding-location-map"),
  { loading: () => <p role="status" className="text-sm text-fg-muted">Preparando el mapa…</p>, ssr: false });
const PedirPermiso = dynamic(() => import("../activar-notificaciones/pedir-permiso").then((module) => module.PedirPermiso));
const VISIBLE_CATEGORIES = CATEGORIES.filter((category) => !category.hidden_in_form);

/** Mounted once by the shared layout. Only the question body changes between URLs. */
export function CompletarPerfil() {
  const router = useRouter();
  const pathname = usePathname();
  const query = useSearchParams();
  const session = useOnboardingSession();
  const { profile, draft, update } = session;
  const camino: CaminoOnboarding = query.get("camino") === "vender" || profile.onboarding_camino === "vender" ? "vender" : "explorar";
  // Branches and totals use the canonical ACK, never an unconfirmed type selection.
  const tipo = profile.seller_type === "business" ? "business" as const : "casual" as const;
  const context = useMemo(() => ({ camino, tipo, notificacionesResueltas: session.notificacionesResueltas }), [camino, tipo, session.notificacionesResueltas]);
  const steps = pasosDelCamino(context);
  const rawStep = pathname.split("/").at(-1) ?? "";
  const paso: PasoOnboardingActual = session.finalPending || rawStep === "activar" ? "listo"
    : rawStep === "notificaciones" && session.notificacionesResueltas ? "listo"
      : esPasoOnboarding(rawStep) && steps.includes(rawStep) ? rawStep : pasoParaReanudar(profile.onboarding_paso, context);
  const index = steps.indexOf(paso);
  const negocio = camino === "vender" && context.tipo === "business";
  const [error, setError] = useState("");
  const [usuarioDisponible, setUsuarioDisponible] = useState(false);
  const [usernameLookupRevision, setUsernameLookupRevision] = useState(0);
  const [fotoBusy, setFotoBusy] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const running = useRef(false);
  const { state: locationState, setManualPosition } = useGeolocation();
  const [locationDraft, setLocationDraft] = useState<{ lat: number; lng: number; address: string } | null>(null);
  const ocupado = enviando || session.busy || fotoBusy || !session.ready;

  useEffect(() => {
    if (!session.ready) return;
    if (rawStep !== paso) window.history.replaceState(null, "", rutaDePaso(paso, camino));
    startTransition(() => { setError(""); setUsuarioDisponible(false); });
    const cancelMetric = finishOnboardingNavigation(paso);
    const frame = requestAnimationFrame(() => {
      const scroll = document.querySelector<HTMLElement>("[data-onboarding-scroll]");
      if (scroll) scroll.scrollTop = 0;
      const title = scroll?.querySelector<HTMLElement>("h1");
      if (title) { title.tabIndex = -1; title.style.outline = "none"; title.focus({ preventScroll: true }); }
    });
    return () => { cancelMetric(); cancelAnimationFrame(frame); };
  }, [paso, camino, rawStep, session.ready]);

  useEffect(() => {
    if (!session.ready || session.blocked) return;
    const next = siguientePaso(paso, context);
    if (!next) return;
    const connection = (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection;
    if (connection?.saveData || connection?.effectiveType === "2g" || connection?.effectiveType === "slow-2g") return;
    const timer = window.setTimeout(() => {
      router.prefetch(rutaDePaso(next, camino));
      if (next === "foto") void import("@/components/profile/avatar-inline-upload");
      if (next === "ubicacion") void import("@/components/map/onboarding-location-map");
    }, 300);
    return () => window.clearTimeout(timer);
  }, [paso, camino, context, session.ready, session.blocked, router]);

  function navigate(next: PasoOnboardingActual) { window.history.pushState(null, "", rutaDePaso(next, camino)); }

  function run(operation: () => Promise<void>) {
    if (running.current || ocupado) return;
    running.current = true; setError(""); setEnviando(true);
    void (async () => {
      try { await operation(); }
      catch (failure) {
        if (paso === "usuario") { setUsuarioDisponible(false); setUsernameLookupRevision((revision) => revision + 1); }
        setError(failure instanceof Error ? failure.message : "No se pudo guardar. Intenta de nuevo.");
      } finally { running.current = false; setEnviando(false); }
    })();
  }

  const nombreValue = negocio ? draft.nombreNegocio : draft.nombre;
  const bioValue = negocio ? draft.descripcionNegocio : draft.bio;
  const maxBio = negocio ? 1000 : 160;
  const puedeActivar = !!profile.categoria_negocio && (!negocio || (profile.nombre_negocio?.trim().length ?? 0) >= 2);
  const finalVendedor = camino === "vender" && !profile.es_vendedor;
  const canContinue: Record<PasoOnboardingActual, boolean> = {
    categoria: !!draft.categoria, tipo: true, usuario: usuarioDisponible,
    nombre: nombreValue.trim().length >= 2, foto: !!draft.foto,
    descripcion: bioValue.trim().length > 0 && bioValue.length <= maxBio,
    pagos: draft.pagos.length > 0, intereses: draft.intereses.length > 0 && draft.intereses.length <= 5,
    ubicacion: !!locationDraft || locationState.status === "success", notificaciones: true,
    listo: !finalVendedor || puedeActivar || session.finalPending,
  };

  function omit() {
    if (session.blocked || ocupado) return;
    startOnboardingNavigation(paso, paso === "listo" ? "finish" : "skip");
    if (paso === "listo") { run(() => session.finalize("explorar")); return; }
    const next = siguientePaso(paso, context);
    if (!next) return;
    run(async () => {
      session.discardStep(paso, negocio);
      if (paso === "ubicacion") setLocationDraft(null);
      await session.checkpoint(paso, next, camino);
      navigate(next);
    });
  }

  function continueStep() {
    if (!canContinue[paso] || session.blocked || ocupado) return;
    startOnboardingNavigation(paso, paso === "listo" ? "finish" : "continue");
    run(async () => {
      if (paso === "listo") { await session.finalize(finalVendedor ? "activar" : "explorar"); return; }
      const next = siguientePaso(paso, paso === "tipo" ? { ...context, tipo: draft.tipo } : context)!;
      if (paso === "ubicacion" && locationDraft) setManualPosition({ lat: locationDraft.lat, lng: locationDraft.lng, name: locationDraft.address });
      await session.checkpoint(paso, next, camino, fieldsForOnboardingStep(paso, draft, negocio),
        paso === "usuario" || paso === "foto" || paso === "tipo");
      navigate(next);
    });
  }

  function back() {
    if (ocupado || session.finalPending) return;
    startOnboardingNavigation(paso, "back");
    if (index > 0) navigate(steps[index - 1]!);
    else router.push("/bienvenida?elegir=1");
  }

  const status = <div className="space-y-3">
    {session.pending > 0 && <p role="status" className="text-sm text-fg-muted">
      {session.error ? "Hay pasos pendientes de guardar." : "Guardando tu avance…"}
    </p>}
    {session.error && <div className="space-y-3 rounded-xl border border-danger p-3 text-sm">
      <p role="alert">{session.error}</p>
      {!session.conflict && <button type="button" disabled={ocupado} className="min-h-12 rounded-xl border border-border px-4 font-medium" onClick={() => run(() => session.retry())}>Reintentar guardado</button>}
      {session.uncertain ? <><p className="text-fg-muted">Aún no sabemos si este paso se guardó. Conservaremos la misma operación para comprobarlo.</p>
        <button type="button" disabled={ocupado} className="min-h-12 rounded-xl px-4 font-medium underline" onClick={() => window.location.reload()}>Recargar y recuperar</button></>
        : <><p className="text-fg-muted">Volver al avance guardado descarta los pasos y ediciones que siguen pendientes en esta sesión.</p>
          <button type="button" disabled={ocupado || session.finalPending} className="min-h-12 rounded-xl px-4 font-medium underline" onClick={session.recoverConfirmed}>Volver al avance guardado</button></>}
    </div>}
    {session.finalPending && <p role="status" className="text-sm text-fg-muted">Falta confirmar tu entrada. Al reintentar conservaremos tu decisión anterior.</p>}
  </div>;

  if (paso === "notificaciones") return <PedirPermiso siguiente={rutaDePaso("listo", camino)} onBack={back} step={index + 1} totalSteps={steps.length}
    disabled={session.blocked || !session.ready} status={status} onPermissionChange={session.notifyPermission}
    onContinue={async () => { startOnboardingNavigation(paso, "continue"); await session.checkpoint(paso, "listo", camino); navigate("listo"); }} />;

  const titles: Record<PasoOnboardingActual, string> = {
    categoria: "¿Qué vendes?", tipo: "¿Cómo quieres vender?", usuario: "Elige tu ID de usuario",
    nombre: negocio ? "¿Cómo se llama tu negocio?" : "¿Cómo te llamas?",
    foto: negocio ? "Agrega la foto de tu negocio" : "Agrega tu foto",
    descripcion: negocio ? "Cuéntanos de tu negocio" : "Cuéntanos de ti",
    pagos: "¿Cómo aceptas pagos?", intereses: "¿Qué te interesa?", ubicacion: "¿Dónde estás?",
    notificaciones: "Activa tus notificaciones", listo: camino === "vender" ? "Tu perfil para vender" : "Tu perfil está listo",
  };
  const descriptions: Partial<Record<PasoOnboardingActual, string>> = {
    categoria: "Elige la categoría que mejor describa lo que ofreces.", tipo: "Elige la opción que se adapte a ti.",
    usuario: "Así podrán encontrarte tus vecinos en VICINO.", nombre: "Este será el nombre que se verá en tu perfil. Puedes cambiarlo después.",
    foto: "Ayuda a tus vecinos a reconocerte. Puedes agregarla después.",
    descripcion: negocio ? "Escribe una descripción breve de lo que ofreces." : "Qué te gusta, qué buscas o qué vendes.",
    pagos: "Selecciona las opciones que ofreces a tus compradores.", intereses: "Elige hasta 5 categorías que te gusten.",
    ubicacion: "Elige tu zona para ver lo que se ofrece cerca de ti.",
    listo: finalVendedor ? "Revisa lo que se mostrará antes de activar el Modo Vendedor." : "Ya puedes explorar y conectar con tus vecinos.",
  };

  return <OnboardingShell title={titles[paso]} description={descriptions[paso]} onBack={session.finalPending ? undefined : back}
    step={index + 1} totalSteps={steps.length} error={error} busy={ocupado}
    footer={<OnboardingActions type="submit" form="onboarding-question" busy={ocupado} disabled={!canContinue[paso] || session.blocked}
      continueLabel={paso === "listo" ? session.finalPending ? "Reintentar entrada" : finalVendedor ? "Activar y entrar" : "Entrar a VICINO" : "Continuar"}
      onSkip={session.blocked || session.finalPending || (paso === "listo" && !finalVendedor) ? undefined : omit}
      skipLabel={paso === "listo" ? "Entrar por ahora" : "Omitir"} />}>
    <form id="onboarding-question" onSubmit={(event) => { event.preventDefault(); continueStep(); }}>
      <fieldset disabled={ocupado || session.finalPending} className="min-w-0 space-y-5">
        {paso === "categoria" && <Categoria value={draft.categoria} onChange={(value) => update("categoria", value)} />}
        {paso === "tipo" && <Tipo value={draft.tipo} onChange={(value) => update("tipo", value)} />}
        {paso === "usuario" && <UsernameStep value={draft.username} onChange={(value) => update("username", value)} onValidityChange={setUsuarioDisponible} refreshToken={usernameLookupRevision} />}
        {paso === "nombre" && <div><label htmlFor="onboarding-name" className="mb-2 block text-sm font-medium">{negocio ? "Nombre del negocio" : "Tu nombre"}</label>
          <input id="onboarding-name" name={negocio ? "nombre_negocio" : "nombre"} autoComplete={negocio ? "organization" : "name"} value={nombreValue} maxLength={negocio ? 100 : 60}
            className={onboardingInputClassName} onChange={(event) => update(negocio ? "nombreNegocio" : "nombre", event.target.value)} /></div>}
        {paso === "foto" && <AvatarInlineUpload initial={(nombreValue.trim()[0] ?? "?").toUpperCase()} avatarUrl={draft.foto} conRecorte onUploadSuccess={(url) => update("foto", url)} onError={setError} onBusyChange={setFotoBusy} />}
        {paso === "descripcion" && <div><label htmlFor="onboarding-bio" className="mb-2 block text-sm font-medium">{negocio ? "Descripción del negocio" : "Tu descripción"}</label>
          <textarea id="onboarding-bio" name={negocio ? "descripcion_negocio" : "bio"} rows={5} value={bioValue} maxLength={maxBio} aria-describedby="description-count"
            className={`${onboardingInputClassName} resize-y`} onChange={(event) => update(negocio ? "descripcionNegocio" : "bio", event.target.value)} />
          <p id="description-count" className="mt-2 text-right text-sm text-fg-muted">{bioValue.length}/{maxBio}</p></div>}
        {paso === "pagos" && <Pagos value={draft.pagos} onChange={(value) => update("pagos", value)} />}
        {paso === "intereses" && <div className="space-y-3">{VISIBLE_CATEGORIES.map((category) => {
          const Icon = iconoDeCategoria(category.slug); const selected = draft.intereses.includes(category.slug);
          return <button key={category.slug} type="button" aria-pressed={selected} disabled={!selected && draft.intereses.length >= 5}
            onClick={() => update("intereses", selected ? draft.intereses.filter((value) => value !== category.slug) : [...draft.intereses, category.slug])}
            className={`flex min-h-12 w-full items-center gap-3 rounded-xl border px-4 py-3 text-left disabled:opacity-50 ${selected ? "border-brand bg-brand-tint dark:border-brand-hi" : "border-border"}`}>
            <Icon className="h-5 w-5 shrink-0 text-fg-muted" aria-hidden="true" /><span className="min-w-0 flex-1">{category.name}</span>{selected && <Check className="h-5 w-5 text-brand dark:text-brand-hi" aria-hidden="true" />}</button>;
        })}<p role="status" className="text-sm text-fg-muted">{draft.intereses.length} de 5 seleccionados</p></div>}
        {paso === "ubicacion" && <div className="space-y-4"><p className="text-sm text-fg-muted">Tu zona no publica tu dirección exacta. La ubicación de cada publicación la eliges al publicar.</p>
          <OnboardingLocationMap initialSelection={locationDraft} onSelectionChange={(lat, lng, address) => setLocationDraft({ lat, lng, address })} />
          <p className="text-sm text-fg-muted">Si omites este paso, podrás elegir tu zona desde el inicio.</p></div>}
        {paso === "listo" && (camino === "vender" ? <div className="space-y-4">
          <Activar nombre={negocio ? profile.nombre_negocio ?? "" : profile.nombre} categoria={profile.categoria_negocio} tipo={context.tipo}
            username={profile.username} foto={profile.foto} descripcion={negocio ? profile.descripcion_negocio : profile.bio} pagos={profile.metodos_pago_aceptados} activo={!!profile.es_vendedor} />
          {!puedeActivar && !profile.es_vendedor && <p className="text-sm text-fg-muted">Para activar necesitas una categoría{negocio ? " y el nombre de tu negocio" : ""}. Puedes regresar para completarlo o entrar por ahora y seguir explorando.</p>}
        </div> : <div className="space-y-4"><div className="inline-flex h-16 w-16 items-center justify-center rounded-2xl bg-brand-tint text-brand dark:text-brand-hi"><Check className="h-8 w-8" aria-hidden="true" /></div>
          <p className="font-medium">@{profile.username}</p><p className="text-base text-fg-muted">Puedes completar o cambiar tus datos cuando quieras desde tu perfil.</p></div>)}
      </fieldset>
    </form>
    <div className="mt-5">{status}</div>
  </OnboardingShell>;
}
