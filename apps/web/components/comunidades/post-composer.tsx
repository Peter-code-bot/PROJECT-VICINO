"use client";

import { useEffect, useRef, useState } from "react";
import { Send, Loader2, ImagePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { COMMUNITY_POST_MAX } from "@vicino/shared";
import { UserAvatar } from "@/components/ui/user-avatar";
import { createClient } from "@/lib/supabase/client";
import {
  admitirImagenes,
  borrarImagenesComunidad,
  MAX_IMAGENES_POR_PUBLICACION,
  subirImagenesComunidad,
} from "@/lib/comunidades/media";

/** Lo que el composer entrega ya resuelto: texto recortado y rutas subidas. */
export interface EnvioDeMuro {
  texto: string;
  /** Rutas del bucket community-media. Vacio si no se eligio ninguna imagen. */
  imagenes: string[];
}

interface PostComposerProps {
  placeholder: string;
  /**
   * uuid de la comunidad donde se publica, y uuid de quien escribe. Los dos
   * hacen falta AQUI y no solo en el servidor porque la ruta del bucket es
   * <comunidad>/<autor>/<archivo> y las policies de storage la comparan contra
   * auth.uid() y contra la pertenencia: construirla mal no da un error de
   * validacion, da un 403 al subir.
   */
  communityId: string;
  autorId: string;
  /** Devuelve un error legible o null si se envio. */
  onEnviar: (envio: EnvioDeMuro) => Promise<string | null>;
  autor?: { nombre: string; foto: string | null } | null;
  /** Compacto: una linea que crece, para el hilo (molde: chat-window). */
  compacto?: boolean;
  etiquetaBoton?: string;
  className?: string;
}

type Fase = "libre" | "subiendo" | "enviando";

/** Lo ya subido para ESTE conjunto de archivos, identificado por referencia. */
interface SubidaHecha {
  files: File[];
  rutas: string[];
}

/**
 * Cuadro de texto + imagenes + boton, comun al muro y al hilo. Mantiene el
 * texto Y las imagenes elegidas si el envio falla, para que reintentar cueste
 * un toque y no volver a escribir ni a buscar las fotos en la galeria.
 */
export function PostComposer({
  placeholder,
  communityId,
  autorId,
  onEnviar,
  autor,
  compacto = false,
  etiquetaBoton = "Publicar",
  className,
}: PostComposerProps) {
  const [texto, setTexto] = useState("");
  const [imagenes, setImagenes] = useState<File[]>([]);
  const [previews, setPreviews] = useState<string[]>([]);
  const [fase, setFase] = useState<Fase>("libre");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Lo que se subio en un intento que luego fallo al publicar. Sin esto, cada
  // reintento sube otra copia de las mismas fotos y deja la anterior huerfana.
  const subidaRef = useRef<SubidaHecha | null>(null);
  const enviandoRef = useRef(false);

  useEffect(() => {
    const urls = imagenes.map((f) => URL.createObjectURL(f));
    // eslint-disable-next-line react-hooks/set-state-in-effect -- los object URL exigen el File en mano y revocarse al desmontar
    setPreviews(urls);
    // Cada objectURL retiene el archivo en memoria hasta que se revoca. Eligiendo
    // y descartando fotos varias veces, no revocarlas es una fuga que crece con
    // el uso.
    return () => urls.forEach((u) => URL.revokeObjectURL(u));
  }, [imagenes]);

  const ocupado = fase !== "libre";
  const recortado = texto.trim();
  const hayAlgo = recortado.length > 0 || imagenes.length > 0;
  const listo = hayAlgo && recortado.length <= COMMUNITY_POST_MAX && !ocupado;
  const huecoDeImagenes = MAX_IMAGENES_POR_PUBLICACION - imagenes.length;

  /**
   * Cambiar la seleccion invalida lo que ya se hubiera subido en un intento
   * anterior: esas rutas ya no las va a referenciar nadie, asi que se borran en
   * el momento en vez de quedarse en el bucket para siempre.
   */
  function fijarImagenes(siguientes: File[], aviso: string) {
    const previa = subidaRef.current;
    subidaRef.current = null;
    setImagenes(siguientes);
    setError(aviso === "" ? null : aviso);
    if (previa) void borrarImagenesComunidad(createClient(), previa.rutas);
  }

  function elegir(nuevas: File[]) {
    const { imagenes: siguientes, aviso } = admitirImagenes(imagenes, nuevas);
    fijarImagenes(siguientes, aviso);
  }

  /**
   * Se quita por IDENTIDAD del archivo y no por indice: los object URL se
   * recalculan en un efecto, asi que durante un frame la tira pintada y la
   * lista real pueden no coincidir, y un indice de esa tira borraria otra foto.
   */
  function quitar(file: File) {
    fijarImagenes(
      imagenes.filter((f) => f !== file),
      "",
    );
  }

  async function enviar() {
    // El cerrojo va en una ref y no en `fase`: dos toques seguidos dentro del
    // mismo lote de React leen el mismo `listo` de antes del repintado, y eso
    // son dos publicaciones -- que ademas gastan dos de las diez de 24 horas.
    if (!listo || enviandoRef.current) return;
    enviandoRef.current = true;
    setError(null);
    const elegidas = imagenes;

    try {
      let rutas: string[] = [];
      if (elegidas.length > 0) {
        const previa = subidaRef.current;
        if (previa && previa.files === elegidas) {
          // Mismo conjunto de archivos que el intento anterior: ya estan arriba.
          rutas = previa.rutas;
        } else {
          setFase("subiendo");
          try {
            rutas = await subirImagenesComunidad(createClient(), communityId, autorId, elegidas);
            subidaRef.current = { files: elegidas, rutas };
          } catch (fallo) {
            setError(
              fallo instanceof Error && fallo.message
                ? `No se pudieron subir las imágenes: ${fallo.message}`
                : "No se pudieron subir las imágenes. Intenta de nuevo.",
            );
            return;
          }
        }
      }

      setFase("enviando");
      const fallo = await onEnviar({ texto: recortado, imagenes: rutas });
      if (fallo) {
        // Ni el texto ni las imagenes se pierden: el siguiente toque reintenta
        // con las mismas rutas, sin volver a subir nada.
        setError(fallo);
        return;
      }
      subidaRef.current = null;
      setTexto("");
      setImagenes([]);
    } finally {
      setFase("libre");
      enviandoRef.current = false;
    }
  }

  const botonImagenes = (
    <>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={ocupado || huecoDeImagenes <= 0}
        aria-label={
          huecoDeImagenes <= 0
            ? `Máximo ${MAX_IMAGENES_POR_PUBLICACION} imágenes`
            : "Añadir imágenes"
        }
        className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[color:var(--fg-muted)] transition-colors hover:bg-[color:var(--card-2)] hover:text-[color:var(--fg)] disabled:opacity-40"
      >
        <ImagePlus className="h-[18px] w-[18px]" aria-hidden="true" />
      </button>
      {/* El input va apilado detras del boton y no en display:none, para que
          siga siendo alcanzable por teclado y por los lectores de pantalla. */}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          const elegidas = Array.from(e.target.files ?? []);
          // Se limpia el valor SIEMPRE: sin esto, volver a elegir exactamente el
          // mismo archivo no dispara onChange y parece que la app se colgo.
          e.target.value = "";
          if (elegidas.length > 0) elegir(elegidas);
        }}
      />
    </>
  );

  const botonEnviar = (icono: React.ReactNode) =>
    ocupado ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : icono;

  return (
    <div className={cn("space-y-2", className)}>
      <div className="rounded-2xl bg-[color:var(--card)] p-3 shadow-[inset_0_0_0_1px_var(--border)] transition-shadow focus-within:shadow-[inset_0_0_0_1px_var(--brand-hi)]">
        <div className={cn("flex gap-3", compacto ? "items-end" : "items-start")}>
          {autor && !compacto && <UserAvatar src={autor.foto} name={autor.nombre} size="sm" />}
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value.slice(0, COMMUNITY_POST_MAX))}
            onKeyDown={(e) => {
              // Enter con Ctrl/Cmd envia; Enter solo hace salto de linea, como
              // en cualquier muro. En el hilo compacto, Enter envia y Shift+Enter
              // hace el salto, como en el chat.
              const enviaConEnter = compacto ? !e.shiftKey : e.ctrlKey || e.metaKey;
              if (e.key === "Enter" && enviaConEnter) {
                e.preventDefault();
                void enviar();
              }
            }}
            placeholder={placeholder}
            rows={compacto ? 1 : 3}
            maxLength={COMMUNITY_POST_MAX}
            disabled={ocupado}
            aria-label={placeholder}
            className={cn(
              "min-w-0 flex-1 resize-none bg-transparent text-sm text-[color:var(--fg)] outline-none placeholder:text-[color:var(--fg-dim)] disabled:opacity-60",
              compacto ? "max-h-32 py-2" : "min-h-[72px]",
            )}
          />
          {compacto ? (
            <>
              {botonImagenes}
              <button
                type="button"
                onClick={() => void enviar()}
                disabled={!listo}
                aria-label={etiquetaBoton}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[color:var(--brand)] text-white transition-all hover:bg-[color:var(--brand-dark)] active:scale-95 disabled:opacity-40"
              >
                {botonEnviar(<Send className="h-4 w-4" aria-hidden="true" />)}
              </button>
            </>
          ) : null}
        </div>

        {imagenes.length > 0 && (
          <ul className="mt-3 flex gap-2 overflow-x-auto">
            {imagenes.map((file, i) => {
              // El hueco se pinta gris hasta que el efecto crea el object URL:
              // asi la tira no cambia de alto al aparecer la miniatura.
              const url = previews[i];
              return (
                <li
                  key={`${file.name}-${file.size}-${file.lastModified}-${i}`}
                  className="relative h-16 w-16 shrink-0 overflow-hidden rounded-lg bg-[color:var(--card-2)]"
                >
                  {/* <img> y no next/image: es un object URL local del navegador,
                      que el optimizador del servidor no puede ni pedir. */}
                  {url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={url}
                      alt={`Imagen ${i + 1} por publicar`}
                      className="h-full w-full object-cover"
                    />
                  )}
                  <button
                    type="button"
                    onClick={() => quitar(file)}
                    disabled={ocupado}
                    aria-label={`Quitar la imagen ${i + 1}`}
                    className="absolute right-0 top-0 rounded-bl-lg bg-[color:var(--fg)]/80 p-1 text-[color:var(--bg)] disabled:opacity-40"
                  >
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {!compacto && (
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-1">
            {botonImagenes}
            <span className="text-xs text-[color:var(--fg-dim)]">
              {texto.length}/{COMMUNITY_POST_MAX}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void enviar()}
            disabled={!listo}
            className="inline-flex h-9 items-center gap-2 rounded-full bg-[color:var(--brand)] px-4 text-[13px] font-semibold text-white shadow-[var(--shadow-glow)] transition-all hover:bg-[color:var(--brand-dark)] active:scale-[0.97] disabled:opacity-40 disabled:shadow-none"
          >
            {botonEnviar(<Send className="h-4 w-4" aria-hidden="true" />)}
            {etiquetaBoton}
          </button>
        </div>
      )}

      {/* Las dos esperas se dicen por separado: "subiendo" puede tardar en un
          dato movil y sin decirlo parece que el boton no hizo nada. */}
      {ocupado && (
        <p role="status" aria-live="polite" className="text-xs text-[color:var(--fg-muted)]">
          {fase === "subiendo" ? "Subiendo imágenes…" : "Publicando…"}
        </p>
      )}
      {error && (
        <p role="status" aria-live="polite" className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
