import { cookies } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { MAP_AREA } from "@vicino/shared";
import { parseCoordinates } from "@/lib/geo/location-storage";
import { parseRadiusCookie } from "@/lib/geo/radius";
import { queryFromMapParams } from "@/lib/geo/publication-map";
import { MapExplorer } from "./map-explorer";
import { isPublicationMapEnabled } from "@/lib/publication-map-feature";
import { createClient } from "@/lib/supabase/server";
import { usuarioOInvitado } from "@/lib/session-auth";

export const metadata: Metadata = { title: "Explorar el mapa | VICINO", robots: { index: false, follow: true } };
export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  if (!isPublicationMapEnabled()) return <div className="mx-auto max-w-xl space-y-4 px-5 py-12"><h1 className="text-2xl font-bold">Estamos preparando el mapa</h1><p>Pronto podrás explorar las publicaciones por ubicación.</p><Link href="/buscar" className="text-[color:var(--brand-hi)] underline">Explorar publicaciones</Link></div>;
  const jar = await cookies();
  const saved = parseCoordinates(jar.get("vicino_location")?.value ?? "");
  const params = await searchParams;
  const valid = (location: { lat: number; lng: number } | null) => location && Number.isFinite(location.lat) && Number.isFinite(location.lng) && location.lat >= MAP_AREA.south && location.lat <= MAP_AREA.north && location.lng >= MAP_AREA.west && location.lng <= MAP_AREA.east ? location : null;
  const linked = typeof params.lat === "string" && typeof params.lng === "string" && params.lat.trim() && params.lng.trim() ? valid({ lat: Number(params.lat), lng: Number(params.lng) }) : null;
  const savedCenter = valid(saved);
  const center = linked ?? savedCenter;
  const radius = parseRadiusCookie(jar.get("vicino_radius")?.value);
  const supabase = await createClient();
  const user = await usuarioOInvitado(supabase);
  const initialQuery = queryFromMapParams(params, center, radius);
  return <MapExplorer key={JSON.stringify([user?.id ?? "guest", initialQuery, center])} initialQuery={initialQuery} initialCenter={center} initialSavedCenter={savedCenter} initialHasSavedLocation={savedCenter !== null} viewerScope={user?.id ?? "guest"} />;
}
