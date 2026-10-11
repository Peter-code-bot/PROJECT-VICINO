"use client";

import { useState, useTransition, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { activarModoVendedor } from "./actions";
import { AvatarInlineUpload } from "@/components/profile/avatar-inline-upload";
import { Activar, Categoria, Pagos, Tipo, type SellerType } from "@/components/onboarding/seller-steps";
import { OnboardingActions, OnboardingShell, onboardingInputClassName } from "@/components/onboarding/onboarding-shell";

type Paso = "categoria" | "tipo" | "nombre" | "foto" | "descripcion" | "pagos" | "activar" | "listo";

const TITULOS: Record<Paso, { title: string; description: string }> = {
  categoria: { title: "¿Qué vendes?", description: "Elige la categoría que mejor describa lo que ofreces." },
  tipo: { title: "¿Cómo vas a vender?", description: "Elige cómo quieres presentarte a tus compradores." },
  nombre: { title: "¿Cómo se llama tu negocio?", description: "Este será el nombre que verán tus compradores." },
  foto: { title: "Agrega una foto", description: "Puedes usar el logo o una imagen de tu negocio. Es opcional." },
  descripcion: { title: "Describe tu negocio", description: "Cuenta qué ofreces. Puedes completar esto después." },
  pagos: { title: "¿Cómo aceptas pagos?", description: "Tus compradores podrán ver las opciones que elijas. Es opcional." },
  activar: { title: "Activa tu Modo Vendedor", description: "Revisa cómo se verá tu perfil antes de activarlo." },
  listo: { title: "Tu Modo Vendedor está listo", description: "Ya puedes crear tu primera publicación." },
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
  const ocupado = enviando || fotoBusy;

  const pasos: Paso[] = tipo === "business"
    ? ["categoria", "tipo", "nombre", "foto", "descripcion", "pagos", "activar"]
    : ["categoria", "tipo", "activar"];
  const indice = pasos.indexOf(paso);
  const nombreValido = nombreNegocio.trim().length >= 2 && nombreNegocio.trim().length <= 100;
  const canContinue = paso === "categoria" ? Boolean(categoria)
    : paso === "nombre" ? nombreValido
      : paso === "activar" ? Boolean(categoria) && (tipo !== "business" || nombreValido)
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
    setError("");
    startTransition(async () => {
      try {
        const result = await activarModoVendedor({
          categoria,
          tipo,
          nombreNegocio: tipo === "business" ? nombreNegocio.trim() : undefined,
          descripcionNegocio: tipo === "business" ? descripcionNegocio.trim() : undefined,
          metodosPago: tipo === "business" ? metodosPago.join(", ") : undefined,
          foto: fotoUrl,
        });
        if (result.error) {
          setError(result.error);
          return;
        }
        irAPaso("listo");
      } catch {
        setError("No pudimos activar el Modo Vendedor. Tus datos siguen aquí; intenta de nuevo.");
      }
    });
  }

  function continuar() {
    if (ocupado || !canContinue) return;
    if (paso === "listo") {
      router.replace("/vender");
      return;
    }
    if (paso === "activar") {
      activar();
      return;
    }
    irAPaso(pasos[indice + 1]!);
  }

  function omitir() {
    if (ocupado) return;
    if (paso === "foto") {
      // Uploads only create a storage file. Skip keeps the saved profile photo.
      setFotoUrl(fotoInicial);
      irAPaso("descripcion");
    } else if (paso === "descripcion") {
      setDescripcionNegocio(descripcionNegocioInicial);
      irAPaso("pagos");
    } else if (paso === "pagos") {
      setMetodosPago(metodosPagoIniciales);
      irAPaso("activar");
    } else {
      salir();
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    continuar();
  }

  const opcional = paso === "foto" || paso === "descripcion" || paso === "pagos";
  return (
    <OnboardingShell
      {...TITULOS[paso]}
      onBack={paso === "listo" ? undefined : atras}
      step={paso === "listo" ? undefined : indice + 1}
      totalSteps={paso === "listo" ? undefined : pasos.length}
      error={error}
      busy={ocupado}
      footer={
        <OnboardingActions
          continueLabel={paso === "activar" ? "Activar Modo Vendedor" : paso === "listo" ? "Crear publicación" : "Continuar"}
          type="submit"
          form="alta-vendedor-paso"
          onSkip={omitir}
          skipLabel={paso === "listo" ? "Entrar a VICINO" : opcional ? "Omitir" : "Ahora no"}
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
        {paso === "activar" && <Activar nombre={tipo === "business" ? nombreNegocio : nombre ?? ""} categoria={categoria} tipo={tipo} />}
        {paso === "listo" && (
          <div className="space-y-4">
            <CheckCircle2 className="h-12 w-12 text-primary" aria-hidden="true" />
            <p className="text-muted-foreground">Los compradores podrán encontrarte cuando publiques algo cerca de ellos.</p>
            <p className="text-sm text-muted-foreground">Elige la ubicación de cada publicación al crearla.</p>
          </div>
        )}
      </form>
    </OnboardingShell>
  );
}
