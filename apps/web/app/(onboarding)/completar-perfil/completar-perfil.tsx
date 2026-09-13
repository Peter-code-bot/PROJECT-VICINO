"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CATEGORIES } from "@vicino/shared";
import { iconoDeCategoria } from "@/lib/categories/icons";
import { Check, ChevronLeft, Loader2 } from "lucide-react";
import { AvatarInlineUpload } from "@/components/profile/avatar-inline-upload";
import { ChangeLocationSheet } from "@/components/home/change-location-sheet";
import { useGeolocation, STORAGE_KEY } from "@/hooks/useGeolocation";
import { completeOnboarding } from "@/app/(marketplace)/perfil/actions";
import { guardarPasoOnboarding, type PasoOnboarding } from "./actions";
import OnboardingLocationMap from "@/components/map/onboarding-location-map";

/**
 * Los tres pasos que comparten los tres caminos del onboarding.
 *
 * UNA sola ruta con estado interno y no tres rutas, por dos razones. La
 * primera es que es el patron que ya sigue el alta de vendedor en este mismo
 * grupo, y no conviene tener dos formas de hacer lo mismo a dos carpetas de
 * distancia. La segunda es que `(onboarding)/perfil` chocaria con
 * `(marketplace)/perfil`: los grupos entre parentesis no entran en la URL, asi
 * que las dos rutas serian /perfil.
 *
 * REGLAS DEL PLAN, que gobiernan todo lo de abajo:
 *   · Es obligatorio. No hay «saltar», ni «completar despues», ni «x».
 *   · Solo se navega hacia atras, y volver NO pierde lo ya escrito — por eso
 *     el estado vive aqui arriba y no dentro de cada paso.
 *   · Se puede abandonar a mitad y volver: cada paso se guarda al avanzar, y
 *     /bienvenida reenvia aqui leyendo onboarding_paso.
 */

const PASOS: PasoOnboarding[] = ["perfil", "intereses", "ubicacion"];

/** Mismo criterio que el alta de vendedor: las que se ofrecen al publicar. */
const CATEGORIAS_VISIBLES = CATEGORIES.filter((c) => !c.hidden_in_form);

const MAX_INTERESES = 5;
const MAX_BIO = 160;

interface CompletarPerfilProps {
  pasoInicial: PasoOnboarding;
  sellerType?: string;
  nombreInicial: string;
  bioInicial: string;
  fotoInicial: string;
  interesesIniciales: string[];
}

export function CompletarPerfil({
  pasoInicial,
  sellerType,
  nombreInicial,
  bioInicial,
  fotoInicial,
  interesesIniciales,
}: CompletarPerfilProps) {
  const router = useRouter();
  const [paso, setPaso] = useState<PasoOnboarding>(pasoInicial);
  const [nombre, setNombre] = useState(nombreInicial);
  const [bio, setBio] = useState(bioInicial);
  const [foto, setFoto] = useState(fotoInicial);
  const [intereses, setIntereses] = useState<string[]>(interesesIniciales);
  const [error, setError] = useState("");
  const [enviando, startTransition] = useTransition();
  const [hojaZonaAbierta, setHojaZonaAbierta] = useState(false);

  const { state } = useGeolocation();

  /**
   * Si la persona eligio su zona a mano en la hoja.
   *
   * HACE FALTA, y no es defensivo de mas: useGeolocation NO comparte estado
   * entre instancias — cada llamada tiene su propio useState y no hay ningun
   * contexto. La hoja usa su PROPIA instancia, asi que cuando alguien elige su
   * colonia alli, el `state` de aqui no se entera nunca.
   *
   * Sin esto, quien niega el permiso del sistema elige su zona a mano, ve que
   * se guarda... y el boton de continuar sigue apagado. O sea justo el callejon
   * sin salida que esta pantalla venia a evitar, reintroducido por la puerta de
   * atras.
   *
   * Lo unico que comparten las dos instancias es el cache, y la hoja lo escribe
   * ANTES de cerrarse (commit: setManualPosition -> onClose), asi que releerlo
   * al cerrar es fiable.
   */
  const [zonaAMano, setZonaAMano] = useState(false);

  function alCerrarHojaZona() {
    setHojaZonaAbierta(false);
    try {
      if (localStorage.getItem(STORAGE_KEY)) setZonaAMano(true);
    } catch {
      // Modo privado o almacenamiento bloqueado. No se puede confirmar, asi
      // que no se desbloquea nada: mejor que se quede el boton apagado con la
      // hoja a un toque, que dejarle continuar sin ubicacion a un feed vacio.
    }
  }

  const hayUbicacion = state.status === "success" || zonaAMano;

  /**
   * El banner de error se pinta fuera de los pasos, asi que hay que limpiarlo
   * al cambiar de paso o persigue a la persona por todo el flujo. Se hace aqui
   * y no en un efecto sobre `paso`: cambiar de paso es siempre una decision
   * explicita, y reaccionar a ella con un efecto cuesta un render en cascada
   * (react-hooks/set-state-in-effect). Misma correccion que se hizo en el alta.
   */
  function irAPaso(siguiente: PasoOnboarding) {
    setError("");
    setPaso(siguiente);
  }

  function atras() {
    if (sellerType === "business" && paso === "intereses") return;
    const i = PASOS.indexOf(paso);
    if (i > 0) irAPaso(PASOS[i - 1]!);
  }

  /** Guarda lo del paso actual y avanza. Si la escritura falla, NO avanza. */
  function avanzar(
    datos: Parameters<typeof guardarPasoOnboarding>[0],
    siguiente: PasoOnboarding | null,
  ) {
    setError("");
    startTransition(async () => {
      if (siguiente) {
        const r = await guardarPasoOnboarding({
          ...datos,
          // El paso que se guarda es el SIGUIENTE: es donde hay que reanudar si
          // la persona cierra la app justo ahora.
          paso: siguiente,
        });
        if (r.error) {
          setError(r.error);
          return;
        }
        irAPaso(siguiente);
        return;
      }

      // En el ultimo paso NO se llama al RPC. La ubicacion no vive en la base
      // —el feed la lee de la cookie vicino_location, que ya escribio el
      // selector—, asi que la llamada iria con todos los argumentos nulos y el
      // COALESCE la convertiria en un UPDATE que no cambia nada: una ida de red
      // para no hacer nada, justo antes de la que si importa.
      // Ultimo paso. La bandera de onboarding se consume AQUI y no en
      // /bienvenida como antes: es de un solo uso, y gastarla al principio era
      // justo lo que dejaba a la gente entrar con el perfil vacio y sin poder
      // volver a elegir.
      const fin = await completeOnboarding();
      if (fin.error) {
        setError(fin.error);
        return;
      }
      router.push("/");
    });
  }

  const nombreOk = nombre.trim().length >= 2;
  const bioOk = bio.trim().length > 0;
  const fotoOk = foto.trim().length > 0;
  const perfilOk = nombreOk && bioOk && fotoOk;

  function alternarInteres(slug: string) {
    setIntereses((previos) => {
      if (previos.includes(slug)) return previos.filter((s) => s !== slug);
      if (previos.length >= MAX_INTERESES) return previos;
      return [...previos, slug];
    });
  }

  return (
    <div className="w-full max-w-md px-6 py-10">
      {/* Solo la flecha de regresar. Sin «x» y sin «saltar»: el onboarding es
          obligatorio, y una salida aqui devuelve a la app con el perfil vacio,
          que es exactamente el estado que este flujo viene a evitar. */}
      <div className="mb-8 flex items-center">
        {(sellerType === "business" ? paso !== "intereses" && paso !== PASOS[0] : paso !== PASOS[0]) ? (
          <button
            type="button"
            onClick={atras}
            disabled={enviando}
            className="text-muted-foreground hover:text-foreground disabled:opacity-40"
            aria-label="Regresar"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        ) : (
          <span />
        )}
      </div>

      {error && (
        <div
          role="alert"
          className="mb-5 rounded-xl bg-[rgba(255,59,48,0.08)] p-3 text-sm text-[color:var(--danger)]"
        >
          {error}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* P1 — Perfil                                                      */}
      {/* ---------------------------------------------------------------- */}
      {paso === "perfil" && (
        <div className="space-y-5 animate-fade-in">
          <div>
            <h1 className="font-heading text-2xl font-bold">Completa tu perfil</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Así te reconocen tus vecinos cuando compras o vendes.
            </p>
          </div>

          <AvatarInlineUpload
            initial={(nombre.trim()[0] ?? "?").toUpperCase()}
            avatarUrl={foto}
            conRecorte
            onUploadSuccess={(url) => {
              setError("");
              setFoto(url);
            }}
            onError={setError}
          />

          <div className="space-y-1.5">
            <label htmlFor="nombre" className="text-sm font-medium text-foreground/80">
              Tu nombre
            </label>
            <input
              id="nombre"
              type="text"
              value={nombre}
              maxLength={60}
              onChange={(e) => setNombre(e.target.value)}
              placeholder="Tu nombre"
              className="w-full rounded-xl bg-[color:var(--bg-elev-2)] px-3.5 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-[color:var(--brand)]"
            />
          </div>

          <div className="space-y-1.5">
            <label htmlFor="bio" className="text-sm font-medium text-foreground/80">
              Cuéntanos de ti
            </label>
            <textarea
              id="bio"
              value={bio}
              rows={3}
              maxLength={MAX_BIO}
              onChange={(e) => setBio(e.target.value)}
              placeholder="Qué te gusta, qué buscas, o qué vendes."
              className="w-full resize-none rounded-xl bg-[color:var(--bg-elev-2)] px-3.5 py-3 text-sm outline-none ring-1 ring-transparent focus:ring-[color:var(--brand)]"
            />
            <p className="text-right text-[11px] text-muted-foreground">
              {bio.length}/{MAX_BIO}
            </p>
          </div>

          <button
            type="button"
            onClick={() =>
              avanzar(
                { nombre: nombre.trim(), bio: bio.trim(), foto: foto.trim() },
                "intereses",
              )
            }
            disabled={!perfilOk || enviando}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            Continuar
          </button>
          {!perfilOk && (
            <p className="text-center text-xs text-muted-foreground">
              Necesitamos tu foto, tu nombre y una descripción corta.
            </p>
          )}
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* P2 — Intereses                                                   */}
      {/* ---------------------------------------------------------------- */}
      {paso === "intereses" && (
        <div className="space-y-5 animate-fade-in">
          <div>
            <h1 className="font-heading text-2xl font-bold">¿Qué te interesa?</h1>
            {/* El texto NO promete que esto reordene el inicio. Los intereses
                se guardan pero todavia no los lee nadie: el feed ordena por
                cercania y por fecha. Prometer un efecto que no ocurre es una
                mentira que la persona detecta en su primer minuto en la app, y
                el precio de eso es mayor que el de una frase mas modesta.
                Cuando el feed los use de verdad, esta frase se cambia. */}
            <p className="mt-1 text-sm text-muted-foreground">
              Elige hasta {MAX_INTERESES}. Nos sirven para saber qué te falta cerca.
            </p>
          </div>

          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">
              {intereses.length} de {MAX_INTERESES}
            </span>
            {intereses.length >= MAX_INTERESES && (
              <span className="text-[color:var(--brand-hi)]">
                Ya elegiste el máximo
              </span>
            )}
          </div>

          <div className="grid max-h-[46vh] grid-cols-3 gap-2 overflow-y-auto pr-1">
            {CATEGORIAS_VISIBLES.map((c) => {
              const Icono = iconoDeCategoria(c.slug);
              const elegida = intereses.includes(c.slug);
              // Al llegar al tope, las demas dejan de poder seleccionarse. Es
              // deliberado que se apaguen ANTES del toque, en vez de dejar
              // tocar y responder con un error: un error despues del gesto
              // culpa a la persona de una regla que no podia ver.
              const bloqueada = !elegida && intereses.length >= MAX_INTERESES;
              return (
                <button
                  key={c.slug}
                  type="button"
                  onClick={() => alternarInteres(c.slug)}
                  disabled={bloqueada}
                  aria-pressed={elegida}
                  className={`relative flex flex-col items-center gap-1.5 rounded-xl px-2 py-3 text-center transition-colors ${
                    elegida
                      ? "bg-[color:var(--brand)]/10 shadow-[inset_0_0_0_1px_var(--brand)]"
                      : "bg-[color:var(--bg-elev-2)] hover:opacity-90"
                  } ${bloqueada ? "opacity-35" : ""}`}
                >
                  {elegida && (
                    <Check className="absolute right-1.5 top-1.5 h-3.5 w-3.5 text-[color:var(--brand)]" />
                  )}
                  <Icono className="h-5 w-5 text-muted-foreground" />
                  <span className="text-[11px] leading-tight">{c.name}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => avanzar({ intereses }, "ubicacion")}
            disabled={intereses.length === 0 || enviando}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            Continuar
          </button>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      {/* P3 — Ubicacion                                                   */}
      {/* ---------------------------------------------------------------- */}
      {paso === "ubicacion" && (
        <div className="space-y-5 animate-fade-in">
          <div>
            <h1 className="font-heading text-2xl font-bold">¿Dónde estás?</h1>
            {/* El POR QUE va ANTES del dialogo del sistema, no despues. Un
                permiso que aparece sin explicacion se niega, y en iOS negarlo
                puede ser definitivo: la app ya no puede volver a preguntar. */}
            <p className="mt-1 text-sm text-muted-foreground">
              VICINO solo te muestra lo que está cerca. Sin tu zona, tu inicio
              sale vacío.
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              Se publica la colonia, nunca tu dirección exacta.
            </p>
          </div>

          <OnboardingLocationMap
            onLocationConfirmed={() => {
              setZonaAMano(true);
            }}
          />

          <button
            type="button"
            onClick={() => avanzar({}, null)}
            disabled={!hayUbicacion || enviando}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-[color:var(--brand)] py-3 font-semibold text-white transition-transform active:scale-[0.98] disabled:opacity-40"
          >
            {enviando && <Loader2 className="h-4 w-4 animate-spin" />}
            Entrar a VICINO
          </button>
        </div>
      )}

      <ChangeLocationSheet
        open={hojaZonaAbierta}
        onClose={alCerrarHojaZona}
      />
    </div>
  );
}
