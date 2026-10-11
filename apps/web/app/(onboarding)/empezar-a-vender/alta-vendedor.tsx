"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { conTope } from "@/lib/auth/con-tope";
import { activarModoVendedor } from "./actions";
import { AvatarInlineUpload } from "@/components/profile/avatar-inline-upload";
import { Activar, Categoria, Pagos, Tipo, type SellerType } from "@/components/onboarding/seller-steps";
import { OnboardingActions, OnboardingShell, onboardingInputClassName } from "@/components/onboarding/onboarding-shell";

type Paso = "categoria" | "tipo" | "nombre" | "foto" | "descripcion" | "pagos" | "listo";

const TITULOS: Record<Paso, { title: string; description: string }> = {
  categoria: { title: "¿Qué vendes?", description: "Elige la categoría que mejor describa lo que ofreces." },
  tipo: { title: "¿Cómo vas a vender?", description: "Elige cómo quieres presentarte a tus compradores." },
  nombre: { title: "¿Cómo se llama tu negocio?", description: "Este será el nombre que verán tus compradores." },
  foto: { title: "Agrega una foto", description: "Puedes usar el logo o una imagen de tu negocio. Es opcional." },
  descripcion: { title: "Describe tu negocio", description: "Cuenta qué ofreces. Puedes completar esto después." },
  pagos: { title: "¿Cómo aceptas pagos?", description: "Tus compradores podrán ver las opciones que elijas. Es opcional." },
  listo: { title: "Tu perfil para vender", description: "Revisa lo que se mostrará antes de entrar." },
};

/** Existing accounts convert here; new accounts use the shared onboarding. */
export function AltaVendedor({
  nombre,
  categoriaInicial = null,
  tipoInicial = "casual",
  nombreNegocioInicial = "",
  descripcionNegocioInicial = "",
  metodosPagoIniciales = [],
  fotoInicial = "",
  yaEsVendedor = false,
}: {
  nombre: string | null;
  categoriaInicial?: string | null;
  tipoInicial?: SellerType;
  nombreNegocioInicial?: string;
  descripcionNegocioInicial?: string;
  metodosPagoIniciales?: string[];
  fotoInicial?: string;
  yaEsVendedor?: boolean;
}) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>(yaEsVendedor ? "listo" : "categoria");
  const [categoria, setCategoria] = useState(categoriaInicial);
  const [tipo, setTipo] = useState<SellerType>(tipoInicial);
  const [nombreNegocio, setNombreNegocio] = useState(nombreNegocioInicial);
  const [descripcionNegocio, setDescripcionNegocio] = useState(descripcionNegocioInicial);
  const [metodosPago, setMetodosPago] = useState(metodosPagoIniciales);
  const [fotoUrl, setFotoUrl] = useState(fotoInicial);
  const [fotoBusy, setFotoBusy] = useState(false);
  const [error, setError] = useState("");
  const [enviando, startTransition] = useTransition();
  const activating = useRef(false);
  const [accepted, setAccepted] = useState({ categoria: categoriaInicial, tipo: tipoInicial, nombre: nombreNegocioInicial,
    descripcion: descripcionNegocioInicial, pagos: metodosPagoIniciales, foto: fotoInicial });
  const ocupado = enviando || fotoBusy;

  const pasos: Paso[] = accepted.tipo === "business"
    ? ["categoria", "tipo", "nombre", "foto", "descripcion", "pagos", "listo"]
    : ["categoria", "tipo", "listo"];
  const indice = pasos.indexOf(paso);
  const nombreValido = nombreNegocio.trim().length >= 2 && nombreNegocio.trim().length <= 100;
  const canContinue = paso === "categoria" ? Boolean(categoria)
    : paso === "nombre" ? nombreValido
      : paso === "foto" ? !!fotoUrl : paso === "descripcion" ? descripcionNegocio.trim().length > 0
        : paso === "pagos" ? metodosPago.length > 0
          : paso === "listo" ? yaEsVendedor || Boolean(accepted.categoria) && (accepted.tipo !== "business" || accepted.nombre.trim().length >= 2)
        : true;

  function irAPaso(next: Paso) {
    setError("");
    setPaso(next);
  }

  function salir() {
    // Choosing to postpone never calls the activation action.
    router.replace("/");
  }

  function atras() {
    if (ocupado) return;
    if (indice > 0) irAPaso(pasos[indice - 1]!);
    else salir();
  }

  function activar() {
    if (activating.current) return;
    activating.current = true;
    setError("");
    startTransition(async () => {
      try {
        const result = await conTope(activarModoVendedor({
          categoria: accepted.categoria,
          tipo: accepted.tipo,
          nombreNegocio: accepted.tipo === "business" ? accepted.nombre : undefined,
          descripcionNegocio: accepted.tipo === "business" ? accepted.descripcion : undefined,
          metodosPago: accepted.tipo === "business" ? accepted.pagos.join(", ") : undefined,
          foto: accepted.foto,
        }));
        if (result.error) {
          setError(result.error);
          return;
        }
        router.replace("/vender");
      } catch {
        setError("No pudimos activar el Modo Vendedor. Tus datos siguen aquí; intenta de nuevo.");
      } finally { activating.current = false; }
    });
  }

  function continuar() {
    if (ocupado || !canContinue) return;
    if (paso === "listo") {
      if (yaEsVendedor) router.replace("/vender");
      else activar();
      return;
    }
    const nextAccepted = { ...accepted };
    if (paso === "categoria") nextAccepted.categoria = categoria;
    if (paso === "tipo") nextAccepted.tipo = tipo;
    if (paso === "nombre") nextAccepted.nombre = nombreNegocio.trim();
    if (paso === "foto") nextAccepted.foto = fotoUrl;
    if (paso === "descripcion") nextAccepted.descripcion = descripcionNegocio.trim();
    if (paso === "pagos") nextAccepted.pagos = [...metodosPago];
    setAccepted(nextAccepted);
    const nextSteps: Paso[] = nextAccepted.tipo === "business" ? ["categoria", "tipo", "nombre", "foto", "descripcion", "pagos", "listo"] : ["categoria", "tipo", "listo"];
    irAPaso(nextSteps[nextSteps.indexOf(paso) + 1]!);
  }

  function omitir() {
    if (ocupado) return;
    if (paso === "categoria") {
      setCategoria(accepted.categoria); irAPaso("tipo");
    } else if (paso === "tipo") {
      setTipo(accepted.tipo); irAPaso(accepted.tipo === "business" ? "nombre" : "listo");
    } else if (paso === "nombre") {
      setNombreNegocio(accepted.nombre); irAPaso("foto");
    } else if (paso === "foto") {
      // Uploads only create a storage file. Skip keeps the saved profile photo.
      setFotoUrl(accepted.foto);
      irAPaso("descripcion");
    } else if (paso === "descripcion") {
      setDescripcionNegocio(accepted.descripcion);
      irAPaso("pagos");
    } else if (paso === "pagos") {
      setMetodosPago(accepted.pagos);
      irAPaso("listo");
    } else {
      salir();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    continuar();
  }

  return (
    <OnboardingShell
      {...TITULOS[paso]}
      onBack={yaEsVendedor ? undefined : atras}
      step={yaEsVendedor ? undefined : indice + 1}
      totalSteps={yaEsVendedor ? undefined : pasos.length}
      error={error}
      busy={ocupado}
      footer={
        <OnboardingActions
          continueLabel={paso === "listo" ? yaEsVendedor ? "Crear publicación" : "Activar y entrar" : "Continuar"}
          type="submit"
          form="alta-vendedor-paso"
          onSkip={omitir}
          skipLabel={paso === "listo" ? yaEsVendedor ? "Entrar a VICINO" : "Entrar por ahora" : "Omitir"}
          disabled={!canContinue}
          busy={ocupado}
        />
      }
    >
      <form id="alta-vendedor-paso" onSubmit={submit} className="space-y-4">
        {paso === "categoria" && <Categoria value={categoria} onChange={setCategoria} />}
        {paso === "tipo" && <Tipo value={tipo} onChange={setTipo} />}
        {paso === "nombre" && (
          <div className="space-y-2">
            <label htmlFor="nombre-negocio" className="block text-sm font-medium">Nombre del negocio</label>
            <input
              id="nombre-negocio"
              name="nombre_negocio"
              type="text"
              autoComplete="organization"
              value={nombreNegocio}
              onChange={(event) => setNombreNegocio(event.target.value)}
              minLength={2}
              maxLength={100}
              placeholder="El nombre de tu tienda"
              className={onboardingInputClassName}
              disabled={enviando}
            />
            <p className="text-sm text-muted-foreground">Si lo completas después, puedes seguir explorando por ahora.</p>
          </div>
        )}
        {paso === "foto" && (
          <div className="flex justify-center py-4">
            <AvatarInlineUpload
              conRecorte
              initial={nombreNegocio.trim().charAt(0).toUpperCase() || nombre?.charAt(0).toUpperCase() || "?"}
              avatarUrl={fotoUrl}
              onUploadSuccess={setFotoUrl}
              onError={setError}
              onBusyChange={setFotoBusy}
            />
          </div>
        )}
        {paso === "descripcion" && (
          <div className="space-y-2">
            <label htmlFor="descripcion-negocio" className="block text-sm font-medium">Descripción del negocio</label>
            <textarea
              id="descripcion-negocio"
              name="descripcion_negocio"
              value={descripcionNegocio}
              onChange={(event) => setDescripcionNegocio(event.target.value)}
              maxLength={1000}
              rows={5}
              placeholder="Qué ofreces y qué hace especial a tu negocio"
              className={onboardingInputClassName + " resize-none"}
              disabled={enviando}
              aria-describedby="descripcion-negocio-contador"
            />
            <p id="descripcion-negocio-contador" className="text-right text-sm text-muted-foreground">{descripcionNegocio.length}/1000</p>
          </div>
        )}
        {paso === "pagos" && <Pagos value={metodosPago} onChange={setMetodosPago} />}
        {paso === "listo" && <div className="space-y-4">
          <Activar nombre={accepted.tipo === "business" ? accepted.nombre : nombre ?? ""} categoria={accepted.categoria} tipo={accepted.tipo}
            foto={accepted.foto} descripcion={accepted.descripcion} pagos={accepted.pagos.join(", ")} activo={yaEsVendedor} />
          {!canContinue && <p className="text-sm text-fg-muted">Completa tu categoría{accepted.tipo === "business" ? " y el nombre del negocio" : ""} para activar. También puedes entrar por ahora y explorar.</p>}
          <p className="text-sm text-fg-muted">La ubicación de cada publicación la eliges al publicar.</p>
        </div>}
      </form>
    </OnboardingShell>
  );
}
