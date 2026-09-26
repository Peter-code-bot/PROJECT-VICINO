import { AlertCircle } from "lucide-react";

interface ListingStatusBannerProps {
  isOwner: boolean;
  estatus: string | null;
}

const MESSAGES: Record<string, string> = {
  pausado: "Listado pausado · solo tú lo ves",
  borrador: "Listado en borrador · solo tú lo ves",
  agotado: "Listado agotado · solo tú lo ves",
};

const NON_OWNER_MESSAGES: Record<string, string> = {
  pausado: "Esta publicación está pausada por el vendedor · No disponible para compra",
  agotado: "Esta publicación está agotada",
  borrador: "Esta publicación no está disponible",
  eliminado: "Esta publicación fue eliminada",
};

export function getListingStatusBannerMessage(
  estatus: string | null,
  isOwner: boolean
): string | null {
  if (!estatus || estatus === "disponible") return null;
  return (isOwner ? MESSAGES[estatus] : NON_OWNER_MESSAGES[estatus]) ?? null;
}

/**
 * Shown to the real owner whenever their listing is not public (pausado,
 * borrador, agotado), and to visitors/admins when viewing a non-available listing.
 */
export function ListingStatusBanner({
  isOwner,
  estatus,
}: ListingStatusBannerProps) {
  const message = getListingStatusBannerMessage(estatus, isOwner);
  if (!message) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-[color:var(--warning)]/40 bg-[color:var(--warning)]/15 px-4 py-2 text-xs font-semibold text-[color:var(--warning)] backdrop-blur text-center"
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
