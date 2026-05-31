import Link from "next/link";
import Image from "next/image";
import { ChevronRight } from "lucide-react";
import { primaryCategorySlug } from "@vicino/shared";
import { cn } from "@/lib/utils";

interface ReviewProductLinkProps {
  product:
    | {
        id: string;
        titulo: string;
        categoria: string;
        slug: string;
        imagen_principal: string | null;
        // MP#08 #4 Fase 1B: embed opcional. Si el caller ya lo trae lo usamos
        // para derivar la primary del pivote; si no, fallback al categoria
        // TEXT. TODO 1B-bis: expandir los 4 SELECTs de reviews para incluir
        // el embed (perfil/page.tsx + vendedor/[id]/page.tsx + dos en cada
        // caso). Quedo fuera de scope 1B porque requiere SELECTs nuevos.
        product_categories?: unknown;
      }
    | null;
  className?: string;
}

export function ReviewProductLink({ product, className }: ReviewProductLinkProps) {
  if (!product) {
    return (
      <span className={cn("text-xs text-muted-foreground italic", className)}>
        Producto no disponible
      </span>
    );
  }
  const hrefSlug = primaryCategorySlug(product.product_categories) ?? product.categoria;
  return (
    <Link
      href={`/${hrefSlug}/${product.slug}`}
      className={cn(
        "flex items-center gap-2 text-xs text-muted-foreground hover:text-primary transition-colors group min-w-0 max-w-full",
        className,
      )}
    >
      {product.imagen_principal ? (
        <Image
          src={product.imagen_principal}
          alt={product.titulo}
          width={40}
          height={40}
          className="rounded-md object-cover bg-muted shrink-0"
          unoptimized
        />
      ) : (
        <div className="w-10 h-10 rounded-md bg-muted shrink-0" aria-hidden="true" />
      )}
      <span className="font-medium truncate min-w-0 flex-1">{product.titulo}</span>
      <ChevronRight className="w-3 h-3 shrink-0 transition-transform group-hover:translate-x-0.5" />
    </Link>
  );
}
