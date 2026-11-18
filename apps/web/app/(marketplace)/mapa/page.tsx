import Link from "next/link";
import type { Metadata } from "next";
import { MAP_AREA } from "@vicino/shared";
import { leerZonaGuardada } from "@/lib/geo/ubicacion-servidor";
import { queryFromMapParams } from "@/lib/geo/publication-map";
import { MapExplorer } from "./map-explorer";
import { isPublicationMapEnabled } from "@/lib/publication-map-feature";
import { createClient } from "@/lib/supabase/server";
import { usuarioOInvitado } from "@/lib/session-auth";

export const metadata: Metadata = { title: "Explorar el mapa | VICINO", robots: { index: false, follow: true } };
export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  if (!isPublicationMapEnabled()) return <div className="mx-auto max-w-xl space-y-4 px-5 py-12"><h1 className="text-2xl font-bold">Estamos preparando el mapa</h1><p>Pronto podrás explorar las publicaciones por ubicación.</p><Link href="/buscar" className="text-[color:var(--brand-hi)] underline">Explorar publicaciones</Link></div>;
  // La zona guardada sale del lector unico (lib/geo/ubicacion-servidor.ts), que
  // ya exige MAP_AREA: lo mismo que esta pagina comprobaba a mano.
  const zona = await leerZonaGuardada();
  const params = await searchParams;
  const valid = (location: { lat: number; lng: number } | null) => location && Number.isFinite(location.lat) && Number.isFinite(location.lng) && location.lat >= MAP_AREA.south && location.lat <= MAP_AREA.north && location.lng >= MAP_AREA.west && location.lng <= MAP_AREA.east ? location : null;
  const linked = typeof params.lat === "string" && typeof params.lng === "string" && params.lat.trim() && params.lng.trim() ? valid({ lat: Number(params.lat), lng: Number(params.lng) }) : null;
  const savedCenter = zona.estado === "valida" ? zona.punto : null;
  const center = linked ?? savedCenter;
  const radius = zona.radio;
  const supabase = await createClient();
  const user = await usuarioOInvitado(supabase);
  const initialQuery = queryFromMapParams(params, center, radius);
  return <MapExplorer key={JSON.stringify([user?.id ?? "guest", initialQuery, center])} initialQuery={initialQuery} initialCenter={center} initialSavedCenter={savedCenter} initialHasSavedLocation={savedCenter !== null} viewerScope={user?.id ?? "guest"} />;
}
