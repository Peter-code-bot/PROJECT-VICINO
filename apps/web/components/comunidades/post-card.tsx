"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Heart,
  ImageOff,
  MessageCircle,
  MoreVertical,
  Flag,
  Send,
  Trash2,
  Lock,
  X,
} from "lucide-react";
import { formatRelativeTime, TRUST_LEVELS, type TrustLevel } from "@vicino/shared";
import { cn } from "@/lib/utils";
import { hapticLight } from "@/lib/haptics";
import { useOptimisticMutation } from "@/hooks/use-optimistic-mutation";
import { UserAvatar } from "@/components/ui/user-avatar";
import { SellerBadge } from "@/components/shared/seller-badge";
import { ReportModal } from "@/components/moderation/report-modal";
import { alternarLike, eliminarPublicacion } from "@/app/(marketplace)/comunidades/actions";
import { createClient } from "@/lib/supabase/client";
import {
  FIRMA_TTL_SEGUNDOS,
  firmarImagenesComunidad,
  leerImagenes,
} from "@/lib/comunidades/media";
import type { PostComunidad } from "@/lib/comunidades/tipos";
import { ConfirmarDialog } from "./confirmar-dialog";

function esTrustLevel(v: string | null | undefined): v is TrustLevel {
  return typeof v === "string" && v in TRUST_LEVELS;
}

/** Identidad estable para el caso sin firmas: evita repintados por un Map nuevo. */
const SIN_FIRMAS: ReadonlyMap<string, string> = new Map<string, string>();

/** Se renueva la firma 5 minutos antes de que caduque la de una hora. */
const MARGEN_FIRMA_MS = 5 * 60 * 1000;

/**
 * Convierte rutas del bucket privado community-media en URLs utilizables.
 *
 * NO se reutiliza useFirmasAdjuntos: ese hook firma contra chat-media, con el
 * bucket escrito dentro de firmarAdjuntos. Pasarle rutas de comunidades
 * devolveria un mapa vacio y la tarjeta pintaria "no disponible" sin que nada
 * fallara a la vista.
 *
 * Todo el setState ocurre DESPUES del await, y `cargando` se deriva de la clave
 * pedida: asi el hueco gris se convierte en la foto —o en el icono de "no
 * disponible" si la firma no llego— y no se queda girando para siempre.
 */
function useFirmasComunidad(rutas: string[]): {
  firmas: ReadonlyMap<string, string>;
  cargando: boolean;
} {
  const [firmado, setFirmado] = useState<{ clave: string; firmas: Map<string, string> } | null>(null);
  const clave = rutas.join("|");

  useEffect(() => {
    if (clave === "") return;
    let cancelado = false;
    let temporizador: ReturnType<typeof setTimeout> | undefined;

    async function pedir(): Promise<void> {
      const nuevas = await firmarImagenesComunidad(createClient(), rutas);
      if (cancelado) return;
      setFirmado({ clave, firmas: nuevas });
      // Una publicacion con fotos puede quedarse en pantalla mas de una hora:
      // sin renovar, la firma caduca mientras se mira y la foto se rompe.
      temporizador = setTimeout(
        () => void pedir(),
        Math.max(MARGEN_FIRMA_MS, FIRMA_TTL_SEGUNDOS * 1000 - MARGEN_FIRMA_MS),
      );
    }

    void pedir();
    return () => {
      cancelado = true;
      if (temporizador) clearTimeout(temporizador);
    };
    // Se compara por CONTENIDO y no por identidad: `rutas` se recalcula en cada
    // render y con el array pelado en las dependencias el efecto se dispararia
    // siempre, pidiendo firmas nuevas en bucle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave]);

  return {
    firmas: firmado?.clave === clave ? firmado.firmas : SIN_FIRMAS,
    cargando: rutas.length > 0 && firmado?.clave !== clave,
  };
}

/**
 * La cuadricula de imagenes de una publicacion o de un comentario.
 *
 * Se exporta porque el hilo pinta los comentarios con su propio marcado (no
 * pasa por PostCard) y las imagenes de un comentario tienen que verse igual.
 *
 * Cada hueco reserva su sitio con aspect-ratio ANTES de tener la URL firmada.
 * La columna solo guarda rutas —no el tamano, como si hace el chat— asi que la
 * proporcion es fija: sin ese hueco reservado, el muro pega un salto cuando
 * cada foto termina de cargar y te saca de donde estabas leyendo.
 */
export function ImagenesPublicacion({
  rutas,
  autorNombre,
  className,
}: {
  rutas: string[];
  /** Para el texto alternativo: lo unico honesto que se sabe de la imagen. */
  autorNombre: string;
  className?: string;
}) {
  const { firmas, cargando } = useFirmasComunidad(rutas);
  const [abierta, setAbierta] = useState<string | null>(null);

  useEffect(() => {
    if (!abierta) return;
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setAbierta(null);
    }
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [abierta]);

  if (rutas.length === 0) return null;
  const sola = rutas.length === 1;

  return (
    <>
      <div
        className={cn(
          "grid gap-1 overflow-hidden rounded-xl",
          sola ? "grid-cols-1" : "grid-cols-2",
          className,
        )}
      >
        {rutas.map((ruta, i) => {
          const url = firmas.get(ruta);
          const alternativo = `Imagen ${i + 1} de ${rutas.length} publicada por ${autorNombre}`;
          return (
            <button
              key={ruta}
              type="button"
              onClick={() => url && setAbierta(url)}
              disabled={!url}
              aria-label={url ? `Ver ${alternativo}` : "Imagen no disponible"}
              className={cn(
                "relative block w-full overflow-hidden bg-[color:var(--card-2)]",
                url ? "cursor-zoom-in" : "cursor-default",
                // Con tres, la ultima ocupa el ancho entero: en una rejilla de
                // dos columnas dejaria un hueco vacio al lado.
                sola ? "aspect-[4/3]" : rutas.length === 3 && i === 2 ? "col-span-2 aspect-[2/1]" : "aspect-square",
              )}
            >
              {url ? (
                // <img> y no next/image: la fuente es una URL FIRMADA de un
                // bucket privado, con su token en la query. El optimizador de
                // Next la volveria a pedir desde el servidor y la cachearia por
                // URL -- o sea, cachearia el token.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={url}
                  alt={alternativo}
                  loading="lazy"
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              ) : cargando ? (
                <span className="block h-full w-full animate-pulse bg-[color:var(--card)]" />
              ) : (
                <span className="flex h-full w-full items-center justify-center">
                  <ImageOff className="h-5 w-5 text-[color:var(--fg-dim)]" aria-hidden="true" />
                </span>
              )}
            </button>
          );
        })}
      </div>

      {abierta && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4"
          onClick={() => setAbierta(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Imagen ampliada"
        >
          <button
            type="button"
            onClick={() => setAbierta(null)}
            aria-label="Cerrar"
            className="absolute right-4 top-[calc(1rem+env(safe-area-inset-top))] rounded-full bg-white/10 p-2 text-white"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
          {/* object-contain declarado: es justo lo que le faltaba al visor de
              producto y hacia que ahi las fotos salieran recortadas. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={abierta}
            alt="Imagen ampliada de la publicación"
            className="max-h-full max-w-full object-contain"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </>
  );
}

/** Copy exacto de la decision 11. No se toca. */
export const COPY_BORRAR_PUBLICACION =
  "Si borras esta publicación se borran también los comentarios que otras personas escribieron en ella. No se puede deshacer.";

interface PostCardProps {
  post: PostComunidad;
  /** Sesion actual, para saber si es propia. */
  currentUserId: string | null;
  /** true si el mando local (owner/moderador) puede borrarla aunque no sea suya. */
  puedoModerar?: boolean;
  /**
   * false para quien no es miembro (o la comunidad no esta viva): el corazon
   * no dispara la RPC -- que responderia 42501 tras un parpadeo optimista --
   * sino un aviso de que hay que unirse.
   */
  puedoReaccionar?: boolean;
  /** Para el aviso de "unete a X": si falta, se dice "la comunidad". */
  nombreComunidad?: string;
  /** Muestra el nombre de la comunidad (muro unificado). */
  conComunidad?: boolean;
  /** Si es la cabecera del hilo, el cuerpo no se recorta y no enlaza a si misma. */
  esCabeceraDeHilo?: boolean;
  onBorrada?: (postId: string) => void;
  /** Reacciones y comentarios actualizados (para que el padre refleje conteos). */
  onCambio?: (post: PostComunidad) => void;
}

export function PostCard({
  post,
  currentUserId,
  puedoModerar = false,
  puedoReaccionar = true,
  nombreComunidad,
  conComunidad = false,
  esCabeceraDeHilo = false,
  onBorrada,
  onCambio,
}: PostCardProps) {
  const [local, setLocal] = useState<PostComunidad>(post);
  const [menuAbierto, setMenuAbierto] = useState(false);
  const [reportar, setReportar] = useState(false);
  const [confirmarBorrar, setConfirmarBorrar] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- resincronizar con la fila fresca del padre
    setLocal(post);
  }, [post]);

  useEffect(() => {
    if (!menuAbierto) return;
    function fuera(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuAbierto(false);
    }
    function esc(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuAbierto(false);
    }
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", esc);
    };
  }, [menuAbierto]);

  function aplicar(siguiente: PostComunidad) {
    setLocal(siguiente);
    onCambio?.(siguiente);
  }

  const like = useOptimisticMutation(() => alternarLike(local.id), {
    onMutate: () => {
      const previo = local;
      aplicar({
        ...previo,
        le_di_like: !previo.le_di_like,
        likes_count: Math.max(0, previo.likes_count + (previo.le_di_like ? -1 : 1)),
      });
      return () => aplicar(previo);
    },
    onSuccess: (r) => {
      if ("data" in r) aplicar({ ...local, le_di_like: r.data.le_di_like, likes_count: r.data.likes_count });
    },
    onError: (err) => toast.error(err instanceof Error ? err.message : "No se pudo reaccionar"),
  });

  const borrar = useOptimisticMutation(() => eliminarPublicacion(local.id), {
    onSuccess: (r) => {
      setConfirmarBorrar(false);
      if ("data" in r && r.data.borrado) {
        toast.success("Publicación borrada");
        onBorrada?.(local.id);
      } else {
        // Idempotente: ya no existia. Se quita igual de la lista.
        onBorrada?.(local.id);
      }
    },
    onError: (err) => {
      setConfirmarBorrar(false);
      toast.error(err instanceof Error ? err.message : "No se pudo borrar");
    },
  });

  const esPropia = currentUserId !== null && currentUserId === local.author_id;
  const puedoBorrar = esPropia || puedoModerar;
  const hrefHilo = `/comunidades/${local.community_id}/publicacion/${local.id}`;
  // La columna llega como unknown hasta que se regeneren los tipos, y ademas es
  // contenido de otra persona: se comprueba la forma antes de pintarla.
  const imagenes = useMemo(() => leerImagenes(local.imagenes), [local.imagenes]);
  // Sin sesion el enlace de chat no lleva a ningun sitio: /chat redirige a
  // login y el destino pierde el ?seller, asi que se acabaria en la bandeja
  // vacia sin entender por que.
  const puedoEscribirle = currentUserId !== null && !esPropia;
  // Con imagenes el texto puede venir vacio (asi lo acepta la RPC): pintar un
  // parrafo vacio dejaria un hueco con su interlineado encima de las fotos.
  const hayTexto = local.cuerpo.trim().length > 0;
  const cuerpo = !hayTexto ? null : esCabeceraDeHilo ? (
    <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[color:var(--fg)]">{local.cuerpo}</p>
  ) : (
    <Link href={hrefHilo} className="block">
      <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed text-[color:var(--fg)] line-clamp-6">
        {local.cuerpo}
      </p>
    </Link>
  );

  return (
    <article className="rounded-2xl bg-[color:var(--sidebar-bg)] p-4">
      <div className="flex items-start gap-3">
        <Link href={`/vendedor/${local.author_id}`} aria-label={local.author_nombre}>
          <UserAvatar src={local.author_foto} name={local.author_nombre} size="md" />
        </Link>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <Link href={`/vendedor/${local.author_id}`} className="truncate text-sm font-semibold text-[color:var(--fg)]">
              {local.author_nombre}
            </Link>
            {esTrustLevel(local.author_trust_level) && (
              <SellerBadge level={local.author_trust_level} size="sm" />
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-1.5 text-xs text-[color:var(--fg-muted)]">
            {conComunidad && (
              <>
                <Link href={`/comunidades/${local.community_id}`} className="inline-flex items-center gap-1 font-medium text-[color:var(--brand-hi)] hover:underline">
                  {local.community_es_privada && <Lock className="h-3 w-3" />}
                  {local.community_nombre}
                </Link>
                <span>·</span>
              </>
            )}
            <time dateTime={local.created_at}>{formatRelativeTime(local.created_at)}</time>
          </div>
        </div>

        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuAbierto((v) => !v)}
            aria-label="Más opciones"
            aria-haspopup="menu"
            aria-expanded={menuAbierto}
            className="-mr-1.5 -mt-1 rounded-full p-1.5 text-[color:var(--fg-muted)] transition-colors hover:bg-[color:var(--card)] hover:text-[color:var(--fg)]"
          >
            <MoreVertical size={18} aria-hidden="true" />
          </button>
          {menuAbierto && (
            <div role="menu" className="absolute right-0 top-full z-50 mt-1 min-w-[190px] overflow-hidden rounded-xl border border-border bg-card shadow-lg">
              {!esPropia && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuAbierto(false);
                    setReportar(true);
                  }}
                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-foreground hover:bg-muted"
                >
                  <Flag size={14} aria-hidden="true" />
                  Reportar publicación
                </button>
              )}
              {puedoBorrar && (
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setMenuAbierto(false);
                    setConfirmarBorrar(true);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-500/10 dark:text-red-400",
                    !esPropia && "border-t border-border/60",
                  )}
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Borrar publicación
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      {cuerpo && <div className="mt-3">{cuerpo}</div>}

      {imagenes.length > 0 && (
        <ImagenesPublicacion rutas={imagenes} autorNombre={local.author_nombre} className="mt-3" />
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={() => {
            void hapticLight();
            if (!puedoReaccionar) {
              // Decision 3: el muro de una publica se ve desde fuera, pero
              // reaccionar exige pertenencia. Sin viaje al servidor ni parpadeo.
              toast.info(`Únete a ${nombreComunidad ?? "la comunidad"} para reaccionar`);
              return;
            }
            void like.mutate(undefined);
          }}
          aria-disabled={!puedoReaccionar || undefined}
          aria-pressed={local.le_di_like}
          aria-label={local.le_di_like ? "Quitar me gusta" : "Me gusta"}
          className={cn(
            "inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold transition-all active:scale-95",
            local.le_di_like
              ? "bg-[color:var(--brand-tint-strong)] text-[color:var(--brand-hi)]"
              : "text-[color:var(--fg-muted)] hover:bg-[color:var(--card)] hover:text-[color:var(--fg)]",
            !puedoReaccionar && "opacity-60",
          )}
        >
          <Heart className={cn("h-4 w-4", local.le_di_like && "fill-current")} />
          {local.likes_count > 0 ? local.likes_count : ""}
        </button>
        {esCabeceraDeHilo ? (
          <span className="inline-flex h-9 items-center gap-1.5 px-3 text-[13px] font-semibold text-[color:var(--fg-muted)]">
            <MessageCircle className="h-4 w-4" />
            {local.comentarios_count} {local.comentarios_count === 1 ? "comentario" : "comentarios"}
          </span>
        ) : (
          <Link
            href={hrefHilo}
            className="inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[color:var(--fg-muted)] transition-colors hover:bg-[color:var(--card)] hover:text-[color:var(--fg)]"
          >
            <MessageCircle className="h-4 w-4" />
            {local.comentarios_count > 0 ? local.comentarios_count : "Comentar"}
          </Link>
        )}

        {puedoEscribirle && (
          <Link
            href={`/chat?seller=${local.author_id}`}
            // Esa URL ABRE una conversacion al renderizarse en el servidor: una
            // precarga jamas debe ejecutarla.
            prefetch={false}
            aria-label={`Escribirle a ${local.author_nombre} por chat`}
            className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[color:var(--brand-hi)] transition-colors hover:bg-[color:var(--brand-tint-strong)]"
          >
            <Send className="h-4 w-4" aria-hidden="true" />
            Mensaje
          </Link>
        )}
      </div>

      <ReportModal
        open={reportar}
        onClose={() => setReportar(false)}
        targetType="community_post"
        targetId={local.id}
        // Una publicacion de solo imagenes no tiene texto que ensenarle a quien
        // modera: decirlo es mejor que mandarle una etiqueta vacia.
        targetLabel={hayTexto ? local.cuerpo.slice(0, 60) : "Publicación con imágenes"}
      />
      <ConfirmarDialog
        open={confirmarBorrar}
        onOpenChange={setConfirmarBorrar}
        titulo="Borrar publicación"
        cuerpo={COPY_BORRAR_PUBLICACION}
        confirmar="Borrar"
        peligroso
        pendiente={borrar.isPending}
        onConfirmar={() => void borrar.mutate(undefined)}
      />
    </article>
  );
}
