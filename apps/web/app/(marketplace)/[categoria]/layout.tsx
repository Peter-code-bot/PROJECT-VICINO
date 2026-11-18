import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { esCategoriaDeFicha } from "@/lib/navigation/ruta-de-ficha";

/**
 * Un primer segmento que no es una categoria no abre ninguna ficha: 404.
 *
 * Por que aqui y no solo en la pagina: [slug]/loading.tsx envuelve la pagina en
 * un Suspense, asi que un notFound() lanzado desde ella llega con la respuesta
 * ya en streaming y sale con estado 200. Este layout queda por encima de ese
 * limite y no consulta nada, asi que su 404 sale como 404 de verdad. La pagina
 * repite la comprobacion porque Next renderiza el layout y la pagina en
 * paralelo: este layout no impide que la pagina corra. Ver
 * lib/navigation/ruta-de-ficha.ts.
 */
export default async function CategoriaLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ categoria: string }>;
}) {
  const { categoria } = await params;
  if (!esCategoriaDeFicha(categoria)) notFound();
  return children;
}
