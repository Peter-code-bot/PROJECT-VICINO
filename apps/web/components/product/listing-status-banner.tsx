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

/**
 * Shown to the real owner whenever their listing is not public (pausado,
 * borrador, agotado). Stays visible even when ?preview=visitor is active so
 * the owner does not lose this critical signal while previewing as visitor
 * (per ajuste 4 of the plan). Renders inline so it stacks naturally with the
 * PreviewBanner inside the shared sticky container at the top of the wrapper.
 */
export function ListingStatusBanner({
  isOwner,
  estatus,
}: ListingStatusBannerProps) {
  if (!isOwner || !estatus) return null;
  const message = MESSAGES[estatus];
  if (!message) return null;

  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-[color:var(--warning)]/40 bg-[color:var(--warning)]/15 px-4 py-2 text-xs font-semibold text-[color:var(--warning)] backdrop-blur"
    >
      <AlertCircle className="h-4 w-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}
