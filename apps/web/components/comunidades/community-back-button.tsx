"use client";

import { useRouter } from "next/navigation";
import { BotonRegresar } from "@/components/ui/boton-regresar";
import { currentCommunityReturn } from "@/lib/navigation/retorno-comunidad";

export function CommunityBackButton({ id, admin = false }: { id: string; admin?: boolean }) {
  const router = useRouter();
  return <BotonRegresar aria-label={admin ? "Volver a la comunidad" : "Volver"} onClick={() => {
    const destination = currentCommunityReturn(id, admin);
    if (destination.back) router.back();
    else router.replace(destination.href);
  }} />;
}
