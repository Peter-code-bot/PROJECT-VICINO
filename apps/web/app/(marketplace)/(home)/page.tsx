import { Suspense } from "react";
import { HomeSession } from "../home-session";
import { RankingsHomeStripSection } from "@/components/rankings/rankings-home-strip";
export default function HomePage() {
  return <Suspense fallback={<p role="status">Cargando publicaciones…</p>}><HomeSession ranking={<Suspense fallback={<div className="h-32 animate-pulse bg-card" />}><RankingsHomeStripSection /></Suspense>} /></Suspense>;
}
