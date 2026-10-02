"use client";

import Link from "@/components/auth/auth-link";
import { useMuroSesion } from "@/components/auth/muro-sesion";
import { MoreHorizontal } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

export function StorePostOptions({ storeId, href }: { storeId: string; href: string | null }) {
  const { pedirSesion } = useMuroSesion();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" onClick={e => { if (!pedirSesion("Inicia sesión para ver opciones", href ?? `/vendedor/${storeId}`)) { e.preventDefault(); e.stopPropagation(); } }} className="product-card-muted flex items-center justify-center min-h-11 min-w-11 -mr-2" aria-label="Más opciones">
          <MoreHorizontal className="w-5 h-5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem asChild><Link href={`/vendedor/${storeId}`}>Ver vendedor</Link></DropdownMenuItem>
        {href && <DropdownMenuItem asChild><Link href={href}>Ver producto</Link></DropdownMenuItem>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
