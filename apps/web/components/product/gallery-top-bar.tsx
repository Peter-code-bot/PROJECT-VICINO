"use client";

import Link from "@/components/auth/auth-link";
import { useRouter, useSearchParams } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import {
  Pencil,
  Eye,
  EyeOff,
  Flag,
  MoreHorizontal,
  Share2,
  Trash2,
} from "lucide-react";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { BotonRegresar } from "@/components/ui/boton-regresar";
import { useMuroSesion } from "@/components/auth/muro-sesion";
import { ReportModal } from "@/components/moderation/report-modal";
import { toggleProductStatus } from "@/app/(marketplace)/vender/actions";
import { DeleteListingDialog } from "./delete-listing-dialog";
import { esNavegacionDeNext } from "@/lib/next-navigation-error";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

interface GalleryTopBarProps {
  productId: string;
  productTitle: string;
  isFavorite: boolean;
  isOwner: boolean;
  estatus: string;
}

export function GalleryTopBar({
  productId,
  productTitle,
  isFavorite,
  isOwner,
  estatus,
}: GalleryTopBarProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [reportOpen, setReportOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [statusPending, startStatusTransition] = useTransition();
  const togglingStatus = useRef(false);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const { pedirSesion } = useMuroSesion();

  const isPaused = estatus === "pausado";

  function handleToggleStatus() {
    if (togglingStatus.current || statusPending) return;
    togglingStatus.current = true;
    startStatusTransition(async () => {
      try {
        const nuevo = isPaused ? "disponible" : "pausado";
        const res = await toggleProductStatus(productId, nuevo);
        if (res && "error" in res && res.error) {
          window.alert(res.error);
          return;
        }
        router.refresh();
      } catch (err) {
        if (esNavegacionDeNext(err)) throw err;
        window.alert("No se pudo cambiar la visibilidad. Intenta de nuevo.");
      } finally {
        togglingStatus.current = false;
      }
    });
  }

  async function handleShare() {
    if (typeof window === "undefined") return;
    const shareUrl = window.location.href;
    if (typeof navigator !== "undefined" && "share" in navigator) {
      try {
        await navigator.share({ title: productTitle, url: shareUrl });
        return;
      } catch {
        // User cancelled or share unavailable -> fall through to clipboard.
      }
    }
    if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(shareUrl);
      } catch {
        // Best effort: ignore.
      }
    }
  }

  return (
    <>
      <div
        // data-cromo-galeria: la app iOS busca AQUI el regreso, el favorito y
        // las opciones para sustituirlos por vidrio nativo (CromoNativo.swift).
        data-cromo-galeria=""
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <BotonRegresar
          variante="flotante"
          onClick={() => {
            if (isOwner && searchParams.get("from") === "publication") {
              router.replace("/perfil?tab=products");
            } else if (typeof window !== "undefined" && window.history.length > 1) {
              router.back();
            } else {
              router.push("/");
            }
          }}
          aria-label="Volver"
          className="pointer-events-auto"
        />

        <div className="pointer-events-auto flex items-center gap-2">
          <FavoriteButton
            productId={productId}
            initialFavorite={isFavorite}
            size="md"
            variant="overlay"
          />

          <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
            <DropdownMenuTrigger asChild>
              <button
                ref={menuTriggerRef}
                type="button"
                aria-label="Mas opciones"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/40 focus:outline-none focus:ring-2 focus:ring-white/40"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8} onCloseAutoFocus={(event) => { if (deleteOpen) event.preventDefault(); }} className="min-w-0 p-1.5 rounded-2xl bg-card border-0 shadow-[0_8px_30px_rgba(0,0,0,0.14)] flex flex-col items-center gap-1">
              {isOwner ? (
                <>
                  <DropdownMenuItem asChild>
                    <Link
                      href={`/vender/${productId}/editar`}
                      className="flex h-9 w-9 items-center justify-center rounded-xl text-foreground hover:bg-[color:var(--bg-elev-2)] transition-colors focus:bg-[color:var(--bg-elev-2)]"
                      title="Editar producto"
                      aria-label="Editar producto"
                    >
                      <Pencil className="h-4 w-4" />
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    disabled={statusPending}
                    onSelect={() => {
                      void handleToggleStatus();
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-foreground hover:bg-[color:var(--bg-elev-2)] transition-colors focus:bg-[color:var(--bg-elev-2)] cursor-pointer"
                    title={isPaused ? "Publicación oculta (clic para mostrar)" : "Publicación visible (clic para ocultar)"}
                    aria-label={isPaused ? "Mostrar publicación" : "Ocultar publicación"}
                  >
                    {isPaused ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    destructive
                    disabled={statusPending}
                    onSelect={(event) => {
                      event.preventDefault();
                      setMenuOpen(false);
                      setDeleteOpen(true);
                    }}
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-danger hover:bg-danger/10 transition-colors focus:bg-danger/10 focus:text-danger cursor-pointer"
                    title="Eliminar publicación"
                    aria-label="Eliminar publicación"
                  >
                    <Trash2 className="h-4 w-4" />
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem
                    onSelect={(e: Event) => {
                      e.preventDefault();
                      // El aviso llega ANTES de escribir, no despues. Sin
                      // sesion, el modal se abria, dejaba elegir motivo y
                      // redactar, y al enviar moria en un toast de 401 sin
                      // salida a login: se pedia el trabajo y luego se
                      // rechazaba. Es el unico de los 6 puntos de reporte que
                      // se pintaba sin sesion, y es el de la ficha movil, que
                      // es la que ve la app.
                      if (!pedirSesion("Inicia sesión para reportar contenido")) return;
                      setReportOpen(true);
                    }}
                  >
                    <Flag className="h-4 w-4" />
                    Reportar producto
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(e: Event) => {
                      e.preventDefault();
                      void handleShare();
                    }}
                  >
                    <Share2 className="h-4 w-4" />
                    Compartir
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {isOwner && <DeleteListingDialog productId={productId} open={deleteOpen} onOpenChange={setDeleteOpen} triggerRef={menuTriggerRef} />}

      {isOwner ? null : (
        <ReportModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          targetType="listing"
          targetId={productId}
          targetLabel={productTitle}
        />
      )}
    </>
  );
}
