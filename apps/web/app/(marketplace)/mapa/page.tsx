import { cookies } from "next/headers";
import Link from "next/link";
import type { Metadata } from "next";
import { MAP_AREA } from "@vicino/shared";
import { parseCoordinates } from "@/lib/geo/location-storage";
import { parseRadiusCookie } from "@/lib/geo/radius";
import { DEFAULT_MAP_CENTER, queryFromMapParams } from "@/lib/geo/publication-map";
import { MapExplorer } from "./map-explorer";

export const metadata: Metadata = { title: "Explorar el mapa | VICINO", robots: { index: false, follow: true } };
export default async function MapPage({ searchParams }: { searchParams: Promise<Record<string,string|string[]|undefined>> }) {
  if (process.env.NEXT_PUBLIC_VICINO_MAP_ENABLED !== "true") return <div className="mx-auto max-w-xl space-y-4 px-5 py-12"><h1 className="text-2xl font-bold">Estamos preparando el mapa</h1><p>Pronto podrás explorar las publicaciones por ubicación.</p><Link href="/buscar" className="text-[color:var(--brand-hi)] underline">Explorar publicaciones</Link></div>;
  const jar = await cookies();
  const saved = parseCoordinates(jar.get("vicino_location")?.value ?? "");
  const center = saved && saved.lat>=MAP_AREA.south && saved.lat<=MAP_AREA.north && saved.lng>=MAP_AREA.west && saved.lng<=MAP_AREA.east ? saved : DEFAULT_MAP_CENTER;
  const radius = parseRadiusCookie(jar.get("vicino_radius")?.value);
  return <MapExplorer initialQuery={queryFromMapParams(await searchParams,center,radius)} initialCenter={center} />;
}
