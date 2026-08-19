"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  ArrowLeft,
  Edit3,
  Flag,
  MoreHorizontal,
  Pause,
  Play,
  Share2,
  Trash2,
} from "lucide-react";
import { FavoriteButton } from "@/components/shared/favorite-button";
import { ReportModal } from "@/components/moderation/report-modal";
import { toggleProductStatus, deleteProduct } from "@/app/(marketplace)/vender/actions";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
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
  const [reportOpen, setReportOpen] = useState(false);

  const isPaused = estatus === "pausado";

  async function handleToggleStatus() {
    const nuevo = isPaused ? "disponible" : "pausado";
    const res = await toggleProductStatus(productId, nuevo);
    if (res && "error" in res && res.error) {
      window.alert(res.error);
      return;
    }
    // El action revalida /seller/listings, no esta ruta: sin este refresh la
    // propia ficha seguiria mostrando el estatus viejo.
    router.refresh();
  }

  async function handleDelete() {
    if (!confirm("¿Eliminar esta publicación? Esta acción no se puede deshacer.")) return;
    // No hay navegacion aqui: deleteProduct termina en redirect(), que en un
    // server action navega solo. Este bloque solo se alcanza cuando el action
    // devuelve { error } antes de llegar al redirect.
    const res = await deleteProduct(productId);
    if (res && "error" in res && res.error) {
      window.alert(res.error);
    }
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
        className="pointer-events-none absolute inset-x-0 top-0 z-20 flex items-center justify-between px-4"
        style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.75rem)" }}
      >
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Volver"
          className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/40 focus:outline-none focus:ring-2 focus:ring-white/40"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>

        <div className="pointer-events-auto flex items-center gap-2">
          <FavoriteButton
            productId={productId}
            initialFavorite={isFavorite}
            size="md"
            variant="overlay"
          />

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                aria-label="Mas opciones"
                className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-black/30 text-white backdrop-blur-sm transition-colors hover:bg-black/40 focus:outline-none focus:ring-2 focus:ring-white/40"
              >
                <MoreHorizontal className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" sideOffset={8}>
              {isOwner ? (
                <>
                  <DropdownMenuItem asChild>
                    <Link
                      href={`/vender/${productId}/editar`}
                      className="flex w-full items-center gap-2"
                    >
                      <Edit3 className="h-4 w-4" />
                      Editar producto
                    </Link>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={() => {
                      void handleToggleStatus();
                    }}
                  >
                    {isPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                    {isPaused ? "Reanudar listado" : "Pausar listado"}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    destructive
                    onSelect={() => {
                      void handleDelete();
                    }}
                  >
                    <Trash2 className="h-4 w-4" />
                    Eliminar
                  </DropdownMenuItem>
                </>
              ) : (
                <>
                  <DropdownMenuItem
                    onSelect={(e: any) => {
                      e.preventDefault();
                      setReportOpen(true);
                    }}
                  >
                    <Flag className="h-4 w-4" />
                    Reportar producto
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    onSelect={(e: any) => {
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
